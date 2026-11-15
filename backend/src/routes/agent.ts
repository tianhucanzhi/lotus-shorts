/**
 * Agent 聊天路由 — 非流式版本
 */
import { Hono } from 'hono'
import type { AuthVariables } from '../middleware/auth.js'
import { denyUnlessDramaOwner } from '../services/access.js'
import { validAgentTypes } from '../agents/index.js'
import { buildAgentRequestContext } from '../agents/context.js'
import { persistEpisodeScript } from '../agents/tools/script-tools.js'
import { mastra } from '../mastra/index.js'
import { success, badRequest } from '../utils/response.js'
import { logTaskError, logTaskPayload, logTaskProgress, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'

const app = new Hono<{ Variables: AuthVariables }>()

// Mastra v1.17 的 ToolCallChunk / ToolResultChunk 结构：
// { type: 'tool-call', payload: { toolCallId, toolName, args } }
// { type: 'tool-result', payload: { toolCallId, toolName, result, isError } }
function normalizeToolName(entry: any) {
  return entry?.payload?.toolName
    || entry?.toolName
    || entry?.tool?.toolName
    || entry?.tool?.id
    || entry?.name
    || entry?.type
    || null
}

function normalizeToolResult(entry: any) {
  const result = entry?.payload?.result ?? entry?.result ?? entry?.payload?.output ?? entry?.output ?? entry?.data ?? null
  return typeof result === 'string' ? result : JSON.stringify(result)
}

function toolNameKey(name: string | null | undefined) {
  return String(name || '').replace(/_/g, '').toLowerCase()
}

function hasSaveScriptTool(toolNames: Array<string | null>) {
  return toolNames.some((n) => toolNameKey(n) === 'savescript')
}

/** 小模型常把剧本包在 markdown 代码块里，去掉最外层 fence */
function extractScriptText(raw: string) {
  let text = String(raw || '').trim()
  if (!text) return ''
  const fence = text.match(/^```(?:markdown|md|text|screenplay)?\s*\r?\n?([\s\S]*?)\r?\n?```$/i)
  if (fence) text = fence[1].trim()
  return text
}

/** 汇总 generate 结果里的可读文本（最终 text + 各 step / 助手消息） */
function collectAgentText(result: any) {
  const chunks: string[] = []
  const push = (v: unknown) => {
    const s = String(v || '').trim()
    if (s) chunks.push(s)
  }
  push(result?.text)
  if (Array.isArray(result?.steps)) {
    for (const step of result.steps) push(step?.text)
  }
  const messages = result?.response?.messages || result?.messages
  if (Array.isArray(messages)) {
    for (const msg of messages) {
      if (msg?.role !== 'assistant') continue
      if (typeof msg.content === 'string') push(msg.content)
      else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part?.type === 'text') push(part.text)
        }
      }
    }
  }
  // 去重后取最长一段，避免把多步重复文本拼在一起
  const unique = [...new Set(chunks)]
  if (!unique.length) return ''
  return unique.reduce((a, b) => (b.length > a.length ? b : a), '')
}

// POST /agent/:type/chat — 非流式 Agent 对话
app.post('/:type/chat', async (c) => {
  const agentType = c.req.param('type')
  if (!validAgentTypes.includes(agentType)) {
    return badRequest(c, `无效的 Agent 类型：${agentType}`)
  }

  const body = await c.req.json()
  const { message, drama_id, episode_id } = body

  logTaskStart('Agent', agentType, {
    dramaId: drama_id,
    episodeId: episode_id,
    message,
  })
  logTaskPayload('Agent', `${agentType} input`, body)

  if (!episode_id || !drama_id) {
    logTaskError('Agent', agentType, { reason: 'missing drama_id or episode_id' })
    return badRequest(c, '需要 drama_id 与 episode_id')
  }
  const denied = await denyUnlessDramaOwner(c, Number(drama_id))
  if (denied) return denied


  const agent = mastra.getAgent(agentType)
  if (!agent) {
    logTaskError('Agent', agentType, { reason: 'agent not found' })
    return badRequest(c, 'Agent 不存在')
  }

  const requestContext = buildAgentRequestContext({
    episodeId: episode_id,
    dramaId: drama_id,
    modelOverride: body.model || undefined,
    textConfigId: body.config_id || undefined,
  })

  const startTime = performance.now()

  try {
    const result = await agent.generate(
      [{ role: 'user', content: message }],
      { maxSteps: 20, requestContext },
    )

    const elapsed = ((performance.now() - startTime) / 1000).toFixed(1)
    logTaskSuccess('Agent', agentType, { elapsedSeconds: elapsed })

    // 收集所有 tool calls 和 results
    const toolCalls = result.toolCalls || []
    const toolResults = result.toolResults || []
    const normalizedToolCalls = toolCalls.map((tc: any) => ({
      toolName: normalizeToolName(tc),
      args: tc?.payload?.args ?? tc?.args ?? tc?.input ?? null,
    }))
    const normalizedToolResults = toolResults.map((tr: any) => ({
      toolName: normalizeToolName(tr),
      result: normalizeToolResult(tr),
    }))

    const toolCallNames = normalizedToolCalls.map((tc: any) => tc.toolName as string | null)
    logTaskProgress('Agent', 'tool-summary', {
      agentType,
      toolCalls: toolCallNames,
      toolResults: normalizedToolResults.map((tr: any) => tr.toolName),
    })
    logTaskPayload('Agent', `${agentType} tool-results`, normalizedToolResults)

    // 小模型（如本地 qwen）常读完/改写后忘记 save_script：用返回文本由系统落库
    let savedViaFallback = false
    if (agentType === 'script_rewriter' && !hasSaveScriptTool(toolCallNames)) {
      const scriptText = extractScriptText(collectAgentText(result))
      if (!scriptText) {
        logTaskError('Agent', agentType, {
          reason: 'missing save_script and empty text',
          toolCalls: toolCallNames,
        })
        return badRequest(c, '剧本改写未保存：模型未调用保存工具，且未返回可保存的文本。请换更强模型或重试。')
      }
      await persistEpisodeScript(Number(episode_id), scriptText)
      savedViaFallback = true
      logTaskProgress('Agent', 'script-save-fallback', {
        episodeId: episode_id,
        wordCount: scriptText.length,
      })
    }

    return success(c, {
      type: 'done',
      text: result.text || '',
      toolCalls: normalizedToolCalls,
      toolResults: normalizedToolResults,
      savedViaFallback,
    })
  } catch (err: any) {
    const elapsed = ((performance.now() - startTime) / 1000).toFixed(1)
    logTaskError('Agent', agentType, { elapsedSeconds: elapsed, error: err.message })
    console.error(err.stack || err)
    return badRequest(c, err.message || 'Agent 执行失败')
  }
})

// GET /agent/:type/debug
app.get('/:type/debug', async (c) => {
  const agentType = c.req.param('type')
  if (!validAgentTypes.includes(agentType)) return badRequest(c, '无效的 Agent 类型')
  return success(c, { agent_type: agentType, valid: true })
})

export default app
