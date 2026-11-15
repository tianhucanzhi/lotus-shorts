/**
 * ComfyUI 工作流管理 — 按 kind 读写 workspace/comfyui/<kind>.json
 * - t2i：文生图
 * - i2i：图片编辑 / 图生图（造型变体）
 * - i2v：参考生视频
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Hono } from 'hono'
import { success, badRequest } from '../utils/response.js'
import { skillsManagerWorkspace } from '../agents/skills.js'
import {
  normalizeWorkflow,
  resolveT2INodes,
} from '../services/adapters/comfyui/resolve-nodes.js'
import { resolveI2INodes, toI2IDisplayNodes } from '../services/adapters/comfyui/resolve-i2i-nodes.js'
import { resolveI2VNodes, toDisplayNodes } from '../services/adapters/comfyui/resolve-i2v-nodes.js'
import bundledT2I from '../services/adapters/comfyui/t2i.json'
import bundledI2I from '../services/adapters/comfyui/i2i.json'
import bundledI2V from '../services/adapters/comfyui/i2v.json'

const app = new Hono()
const fsm = () => skillsManagerWorkspace.filesystem!

export const COMFYUI_KINDS = ['t2i', 'i2i', 'i2v'] as const
export type ComfyuiKind = (typeof COMFYUI_KINDS)[number]

const KIND_META: Record<ComfyuiKind, { label: string; file: string; validateNodes: boolean; hasBundled: boolean }> = {
  t2i: { label: '文生图', file: 'comfyui/t2i.json', validateNodes: true, hasBundled: true },
  i2i: { label: '图片编辑', file: 'comfyui/i2i.json', validateNodes: true, hasBundled: true },
  i2v: { label: '参考生视频', file: 'comfyui/i2v.json', validateNodes: true, hasBundled: true },
}

const KIND_HINT = 't2i / i2i / i2v'
const __dirname = path.dirname(fileURLToPath(import.meta.url))

function normalizeKind(raw?: string | null): ComfyuiKind | null {
  const k = String(raw || 't2i').toLowerCase()
  return (COMFYUI_KINDS as readonly string[]).includes(k) ? (k as ComfyuiKind) : null
}

function workspaceAbsoluteHint(kind: ComfyuiKind) {
  const root = process.env.WORKSPACE_PATH
    ? path.resolve(process.env.WORKSPACE_PATH)
    : path.resolve(__dirname, '../../workspace')
  return path.join(root, KIND_META[kind].file.replace(/\//g, path.sep))
}

function bundledRaw(kind: ComfyuiKind): string | null {
  if (kind === 't2i') return `${JSON.stringify(bundledT2I, null, 2)}\n`
  if (kind === 'i2i') return `${JSON.stringify(bundledI2I, null, 2)}\n`
  if (kind === 'i2v') return `${JSON.stringify(bundledI2V, null, 2)}\n`
  return null
}

async function readOverrideRaw(kind: ComfyuiKind): Promise<string | null> {
  const rel = KIND_META[kind].file
  if (!(await fsm().exists(rel))) return null
  return String(await fsm().readFile(rel, { encoding: 'utf-8' }))
}

function tryResolve(kind: ComfyuiKind, raw: string) {
  const parsed = JSON.parse(raw)
  const wf = normalizeWorkflow(parsed)
  if (kind === 't2i') {
    return { workflow: wf, nodes: resolveT2INodes(wf) as unknown as Record<string, string> }
  }
  if (kind === 'i2i') {
    return { workflow: wf, nodes: toI2IDisplayNodes(resolveI2INodes(wf)) }
  }
  if (kind === 'i2v') {
    return { workflow: wf, nodes: toDisplayNodes(resolveI2VNodes(wf)) }
  }
  return { workflow: wf, nodes: null as Record<string, string> | null }
}

app.get('/kinds', async (c) => {
  const list = await Promise.all(COMFYUI_KINDS.map(async (kind) => {
    const override = await readOverrideRaw(kind)
    return {
      kind,
      label: KIND_META[kind].label,
      path: KIND_META[kind].file,
      absolute_path: workspaceAbsoluteHint(kind),
      is_default: !override,
      has_content: !!(override || bundledRaw(kind)),
      available: true,
      runtime_ready: true,
    }
  }))
  return success(c, list)
})

app.get('/', async (c) => {
  const kind = normalizeKind(c.req.query('kind'))
  if (!kind) return badRequest(c, `无效的 kind，可选：${KIND_HINT}`)
  const meta = KIND_META[kind]
  const override = await readOverrideRaw(kind)
  const bundled = bundledRaw(kind)
  const content = override ?? bundled ?? ''
  let nodes: Record<string, string> | null = null
  let parseError: string | null = null
  if (content) {
    try {
      nodes = tryResolve(kind, content).nodes
    } catch (err: any) {
      parseError = err?.message || String(err)
    }
  }
  return success(c, {
    kind,
    label: meta.label,
    path: meta.file,
    absolute_path: workspaceAbsoluteHint(kind),
    is_default: !override,
    runtime_ready: true,
    content,
    nodes,
    parse_error: parseError,
  })
})

app.put('/', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const kind = normalizeKind(body.kind ?? c.req.query('kind'))
  if (!kind) return badRequest(c, `无效的 kind，可选：${KIND_HINT}`)
  const content = String(body.content ?? '').trim()
  if (!content) return badRequest(c, 'content 必填')

  let nodes: Record<string, string> | null
  try {
    nodes = tryResolve(kind, content).nodes
  } catch (err: any) {
    return badRequest(c, err?.message || '工作流校验失败')
  }

  const pretty = `${JSON.stringify(JSON.parse(content), null, 2)}\n`
  await fsm().writeFile(KIND_META[kind].file, pretty, { recursive: true })
  return success(c, {
    kind,
    path: KIND_META[kind].file,
    absolute_path: workspaceAbsoluteHint(kind),
    is_default: false,
    runtime_ready: true,
    nodes,
  })
})

app.post('/reset', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const kind = normalizeKind(body.kind ?? c.req.query('kind'))
  if (!kind) return badRequest(c, `无效的 kind，可选：${KIND_HINT}`)
  const rel = KIND_META[kind].file
  if (await fsm().exists(rel)) {
    await fsm().deleteFile(rel)
  }
  try {
    fs.mkdirSync(path.dirname(workspaceAbsoluteHint(kind)), { recursive: true })
  } catch {
    /* ignore */
  }
  const content = bundledRaw(kind) ?? ''
  let nodes: Record<string, string> | null = null
  let parseError: string | null = null
  if (content) {
    try {
      nodes = tryResolve(kind, content).nodes
    } catch (err: any) {
      parseError = err?.message || String(err)
    }
  }
  return success(c, {
    kind,
    path: rel,
    absolute_path: workspaceAbsoluteHint(kind),
    is_default: true,
    runtime_ready: true,
    content,
    nodes,
    parse_error: parseError,
  })
})

app.post('/validate', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const kind = normalizeKind(body.kind ?? c.req.query('kind'))
  if (!kind) return badRequest(c, `无效的 kind，可选：${KIND_HINT}`)
  const content = String(body.content ?? '').trim()
  if (!content) return badRequest(c, 'content 必填')
  try {
    const { nodes } = tryResolve(kind, content)
    return success(c, { ok: true, kind, nodes })
  } catch (err: any) {
    return success(c, { ok: false, kind, error: err?.message || String(err) })
  }
})

export default app
