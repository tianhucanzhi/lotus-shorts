/**
 * ComfyUI 视频 Adapter（本地 comfyui / 云端 comfyui_cloud）
 * 工作流：workspace/comfyui/i2v.json | i2v-cloud.json（设置页可覆盖）
 * 默认：MiniMax H3 参考生视频（R2V）；兼容旧版 ImageToVideo（I2V）
 * 流程：上传参考图 → 注入 prompt/duration/seed → POST /prompt → 轮询 /history → /view 取视频
 */
import { randomUUID } from 'node:crypto'
import type {
  VideoProviderAdapter,
  ProviderRequest,
  AIConfig,
  VideoGenerationRecord,
  VideoGenResponse,
  VideoPollResponse,
} from './types'
import { joinProviderUrl } from './url'
import { loadComfyWorkflow, type ComfyWorkflowKind } from './comfyui/workflow-files.js'
import { resolveI2VNodes, type ComfyI2VNodeMap } from './comfyui/resolve-i2v-nodes.js'
import { uploadImageToComfy } from './comfyui/upload.js'
import type { Workflow } from './comfyui/resolve-nodes.js'

function normalizeBase(baseUrl: string) {
  return String(baseUrl || '').replace(/\/+$/, '')
}

function workflowKindForProvider(provider: string): ComfyWorkflowKind {
  return String(provider || '').toLowerCase() === 'comfyui_cloud' ? 'i2v_cloud' : 'i2v'
}

/** MiniMax H3 length 帧数：与官方表达式一致（5s=124 / 10s=243 / 15s=362） */
function secondsToH3Length(sec: number): number {
  const a = Math.max(1, Number(sec) || 5)
  const base = Math.max(5, Math.round(a * 24))
  return base + (((5 - (base % 17)) % 17) + 17) % 17
}

const SIZE_BY_ASPECT: Record<string, { width: number; height: number }> = {
  '16:9': { width: 608, height: 352 },
  '9:16': { width: 352, height: 608 },
  '1:1': { width: 480, height: 480 },
}

/**
 * Comfy ResolutionSelector 合法枚举（与 MiniMax H3 节点一致）
 * 报错示例：'9:16 (Portrait)' not in ['9:16 (Portrait Widescreen)', ...]
 */
const ASPECT_MAP: Record<string, string> = {
  '1:1': '1:1 (Square)',
  '16:9': '16:9 (Widescreen)',
  '9:16': '9:16 (Portrait Widescreen)',
  '4:3': '4:3 (Standard)',
  '3:4': '3:4 (Portrait Standard)',
  '3:2': '3:2 (Photo)',
  '2:3': '2:3 (Portrait Photo)',
  '21:9': '21:9 (Ultrawide)',
}

const MAX_REF_IMAGES = 9

function parseUrlArray(raw?: string | null): string[] {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter((u) => typeof u === 'string' && u.trim()) : []
  } catch {
    return []
  }
}

/** 莲花前端 @图片N → Comfy MiniMax R2V 的 <Picture N> */
function toComfyR2VPrompt(prompt: string): string {
  return prompt
    .replace(/@图片\s*(\d+)/g, '<Picture $1>')
    .replace(/@Image\s*(\d+)/gi, '<Picture $1>')
}

function collectImageRefs(record: VideoGenerationRecord): string[] {
  const refs = parseUrlArray(record.referenceImageUrls)
  const first = (record.firstFrameUrl || record.imageUrl || '').trim()
  const out: string[] = []
  const push = (u: string) => {
    const s = String(u || '').trim()
    if (!s || out.includes(s) || out.length >= MAX_REF_IMAGES) return
    out.push(s)
  }
  for (const u of refs) push(u)
  // I2V / 显式首帧：若参考列表为空则用 first/image
  if (!out.length && first) push(first)
  return out
}

function writePromptOnNode(wf: Workflow, nodeId: string, prompt: string) {
  const node = wf[nodeId]
  if (!node?.inputs) return
  if (node.inputs.value !== undefined && /PrimitiveString/i.test(node.class_type || '')) {
    node.inputs.value = prompt
    return
  }
  if (node.inputs.prompt !== undefined && !Array.isArray(node.inputs.prompt)) {
    node.inputs.prompt = prompt
    return
  }
  if (node.inputs.text !== undefined && !Array.isArray(node.inputs.text)) {
    node.inputs.text = prompt
  }
}

function writePrompt(wf: Workflow, nodes: ComfyI2VNodeMap, prompt: string) {
  const ids = nodes.promptNodeIds?.length
    ? nodes.promptNodeIds
    : [nodes.promptNode || nodes.videoNode]
  for (const id of ids) {
    if (id) writePromptOnNode(wf, id, prompt)
  }
}

function applyCommonParams(
  wf: Workflow,
  nodes: ComfyI2VNodeMap,
  params: { duration?: number | null; seed?: number | null; aspectRatio?: string | null },
) {
  const sec = Number(params.duration)
  if (nodes.duration && wf[nodes.duration]?.inputs) {
    if (Number.isFinite(sec) && sec > 0) {
      wf[nodes.duration].inputs.value = sec
    }
  } else if (Number.isFinite(sec) && sec > 0) {
    // 云端双 Pass 等：直接写 length 帧数到各 ReferenceToVideo
    const length = secondsToH3Length(sec)
    for (const id of nodes.videoNodeIds || [nodes.videoNode]) {
      if (wf[id]?.inputs && !Array.isArray(wf[id].inputs.length)) {
        wf[id].inputs.length = length
      }
    }
  }

  if (nodes.seed && wf[nodes.seed]?.inputs) {
    const seed =
      params.seed != null && params.seed >= 0
        ? params.seed
        : Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)
    if (wf[nodes.seed].inputs.noise_seed !== undefined) {
      wf[nodes.seed].inputs.noise_seed = seed
    } else if (wf[nodes.seed].inputs.seed !== undefined) {
      wf[nodes.seed].inputs.seed = seed
    }
  }

  if (nodes.resolution && wf[nodes.resolution]?.inputs?.aspect_ratio !== undefined) {
    const ratio = String(params.aspectRatio || '').trim()
    const mapped = ASPECT_MAP[ratio]
    if (mapped) wf[nodes.resolution].inputs.aspect_ratio = mapped
  } else if (nodes.sizeNode && wf[nodes.sizeNode]?.inputs) {
    const size = SIZE_BY_ASPECT[String(params.aspectRatio || '').trim()]
    if (size) {
      wf[nodes.sizeNode].inputs.width = size.width
      wf[nodes.sizeNode].inputs.height = size.height
    }
  }
}

function applyR2VParams(
  template: Workflow,
  nodes: ComfyI2VNodeMap,
  params: {
    prompt: string
    imageNames: string[]
    duration?: number | null
    seed?: number | null
    aspectRatio?: string | null
  },
): Workflow {
  const wf = structuredClone(template)
  const videoIds = nodes.videoNodeIds?.length ? nodes.videoNodeIds : [nodes.videoNode]
  for (const id of videoIds) {
    if (!wf[id]?.inputs) throw new Error(`ReferenceToVideo 节点无效: ${id}`)
  }

  writePrompt(wf, nodes, toComfyR2VPrompt(params.prompt))
  applyCommonParams(wf, nodes, params)

  const templateLoads = [...nodes.loadImageIds]
  const loadIds: string[] = []
  for (let i = 0; i < params.imageNames.length; i++) {
    let loadId = templateLoads[i]
    if (!loadId || !wf[loadId]) {
      loadId = `lotus_ref_${i}`
      wf[loadId] = {
        class_type: 'LoadImage',
        inputs: { image: params.imageNames[i] },
        _meta: { title: `LoadImage ref ${i}` },
      }
    } else {
      wf[loadId].inputs.image = params.imageNames[i]
    }
    loadIds.push(loadId)
  }

  // 各 Pass 同步参考图挂接
  for (const videoId of videoIds) {
    const video = wf[videoId]
    for (const key of Object.keys(video.inputs)) {
      if (/^ref_images\.ref_image_\d+$/i.test(key)) delete video.inputs[key]
    }
    for (let i = 0; i < loadIds.length; i++) {
      video.inputs[`ref_images.ref_image_${i}`] = [loadIds[i], 0]
    }
  }

  return wf
}

function applyI2VParams(
  template: Workflow,
  nodes: ComfyI2VNodeMap,
  params: {
    prompt: string
    imageName: string
    duration?: number | null
    seed?: number | null
    aspectRatio?: string | null
  },
): Workflow {
  const wf = structuredClone(template)
  const loadId = nodes.loadImageIds[0] || nodes.loadImage
  wf[loadId].inputs.image = params.imageName
  writePrompt(wf, nodes, params.prompt)
  applyCommonParams(wf, nodes, params)
  return wf
}

function firstHistoryItem(result: any): { promptId: string; item: any } | null {
  if (!result || typeof result !== 'object') return null
  const entries = Object.entries(result)
  if (!entries.length) return null
  const [promptId, item] = entries[0]
  return { promptId: String(promptId), item }
}

function collectMediaFiles(item: any): Array<{ filename: string; subfolder: string; type: string }> {
  const out: Array<{ filename: string; subfolder: string; type: string }> = []
  if (!item?.outputs) return out
  for (const nodeOut of Object.values(item.outputs) as any[]) {
    for (const key of ['videos', 'gifs', 'images']) {
      if (!Array.isArray(nodeOut?.[key])) continue
      for (const f of nodeOut[key]) {
        if (!f?.filename) continue
        const name = String(f.filename)
        if (key === 'images' && !/\.(mp4|webm|mov|mkv|avi)$/i.test(name)) continue
        out.push({
          filename: name,
          subfolder: String(f.subfolder || ''),
          type: String(f.type || 'output'),
        })
      }
    }
  }
  return out
}

function buildViewUrl(baseUrl: string, f: { filename: string; subfolder: string; type: string }) {
  const qs = new URLSearchParams({
    filename: f.filename,
    subfolder: f.subfolder || '',
    type: f.type || 'output',
  })
  return `${normalizeBase(baseUrl)}/view?${qs}`
}

export class ComfyUIVideoAdapter implements VideoProviderAdapter {
  provider = 'comfyui'
  private lastBaseUrl = ''

  async buildGenerateRequest(config: AIConfig, record: VideoGenerationRecord): Promise<ProviderRequest> {
    this.lastBaseUrl = normalizeBase(config.baseUrl)

    const imageRefs = collectImageRefs(record)
    if (!imageRefs.length) {
      throw new Error('ComfyUI 视频需要至少 1 张参考图（分镜绑定素材或 first_frame）')
    }
    const prompt = (record.prompt || '').trim()
    if (!prompt) throw new Error('ComfyUI 视频需要提示词')

    const template = loadComfyWorkflow(workflowKindForProvider(config.provider))
    const nodes = resolveI2VNodes(template)

    const imageNames: string[] = []
    for (const ref of imageRefs) {
      imageNames.push(await uploadImageToComfy(config.baseUrl, ref, config.apiKey))
    }

    const workflow =
      nodes.mode === 'r2v'
        ? applyR2VParams(template, nodes, {
          prompt,
          imageNames,
          duration: record.duration,
          seed: record.seed,
          aspectRatio: record.aspectRatio,
        })
        : applyI2VParams(template, nodes, {
          prompt,
          imageName: imageNames[0],
          duration: record.duration,
          seed: record.seed,
          aspectRatio: record.aspectRatio,
        })

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`

    return {
      url: joinProviderUrl(config.baseUrl, '', '/prompt'),
      method: 'POST',
      headers,
      body: {
        prompt: workflow,
        client_id: randomUUID(),
      },
    }
  }

  parseGenerateResponse(result: any): VideoGenResponse {
    const promptId = result?.prompt_id || result?.promptId
    if (!promptId) {
      const err = result?.error || result?.node_errors
      throw new Error(
        err ? `ComfyUI 提交失败: ${JSON.stringify(err)}` : 'ComfyUI 未返回 prompt_id',
      )
    }
    return { isAsync: true, taskId: String(promptId) }
  }

  buildPollRequest(config: AIConfig, taskId: string): ProviderRequest {
    this.lastBaseUrl = normalizeBase(config.baseUrl)
    const headers: Record<string, string> = {}
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`
    return {
      url: joinProviderUrl(config.baseUrl, '', `/history/${encodeURIComponent(taskId)}`),
      method: 'GET',
      headers,
      body: undefined,
    }
  }

  parsePollResponse(result: any): VideoPollResponse {
    const hit = firstHistoryItem(result)
    if (!hit) return { status: 'processing' }
    const { item } = hit
    const files = collectMediaFiles(item)
    if (files.length) {
      return {
        status: 'completed',
        videoUrl: buildViewUrl(this.lastBaseUrl, files[0]),
      }
    }
    const statusStr = String(item?.status?.status_str || '').toLowerCase()
    if (statusStr === 'error' || item?.status?.completed === false) {
      return {
        status: 'failed',
        error: `ComfyUI 任务失败: ${JSON.stringify(item.status)}`,
      }
    }
    return { status: 'processing' }
  }

  extractVideoUrl(result: any): string | null {
    const hit = firstHistoryItem(result)
    if (!hit) return null
    const files = collectMediaFiles(hit.item)
    if (!files.length) return null
    return buildViewUrl(this.lastBaseUrl, files[0])
  }
}
