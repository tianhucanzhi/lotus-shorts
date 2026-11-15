/**
 * ComfyUI 本地视频 Adapter
 * 工作流：workspace/comfyui/i2v.json（设置页导入）
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
import { loadComfyWorkflow } from './comfyui/workflow-files.js'
import { resolveI2VNodes, type ComfyI2VNodeMap } from './comfyui/resolve-i2v-nodes.js'
import { uploadImageToComfy } from './comfyui/upload.js'
import type { Workflow } from './comfyui/resolve-nodes.js'

function normalizeBase(baseUrl: string) {
  return String(baseUrl || '').replace(/\/+$/, '')
}

/** Comfy ResolutionSelector 常见标签（R2V 模板用 Widescreen） */
const ASPECT_MAP: Record<string, string> = {
  '1:1': '1:1 (Square)',
  '16:9': '16:9 (Widescreen)',
  '9:16': '9:16 (Portrait)',
  '4:3': '4:3 (Landscape)',
  '3:4': '3:4 (Portrait)',
  '3:2': '3:2 (Landscape)',
  '2:3': '2:3 (Portrait)',
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

function writePrompt(wf: Workflow, nodes: ComfyI2VNodeMap, prompt: string) {
  const nodeId = nodes.promptNode || nodes.videoNode
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

function applyCommonParams(
  wf: Workflow,
  nodes: ComfyI2VNodeMap,
  params: { duration?: number | null; seed?: number | null; aspectRatio?: string | null },
) {
  if (nodes.duration && wf[nodes.duration]?.inputs) {
    const sec = Number(params.duration)
    if (Number.isFinite(sec) && sec > 0) {
      wf[nodes.duration].inputs.value = sec
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
  const video = wf[nodes.videoNode]
  if (!video?.inputs) throw new Error('ReferenceToVideo 节点无效')

  writePrompt(wf, nodes, toComfyR2VPrompt(params.prompt))
  applyCommonParams(wf, nodes, params)

  // 清掉旧的 ref_images.*，按实际上传数量重挂
  for (const key of Object.keys(video.inputs)) {
    if (/^ref_images\.ref_image_\d+$/i.test(key)) delete video.inputs[key]
  }

  const templateLoads = [...nodes.loadImageIds]
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
    video.inputs[`ref_images.ref_image_${i}`] = [loadId, 0]
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

    const template = loadComfyWorkflow('i2v')
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
