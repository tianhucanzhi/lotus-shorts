/**
 * ComfyUI 本地图片 Adapter
 * - 无参考图 → 文生图 t2i.json（Qwen-Image-2512 等）
 * - 有参考图 → 图片编辑 i2i.json（Qwen-Image-Edit-2509 等，造型变体）
 * 直连 ComfyUI Desktop（默认 :8188）：上传图 → POST /prompt → 轮询 /history → /view
 */
import { randomUUID } from 'node:crypto'
import type {
  ImageProviderAdapter,
  ProviderRequest,
  AIConfig,
  ImageGenerationRecord,
  ImageGenResponse,
  ImagePollResponse,
} from './types'
import { joinProviderUrl } from './url'
import { clampForSdxl, qualityToSteps, resolveSize } from './comfyui/size.js'
import { resolveT2INodes, type ComfyNodeMap, type Workflow } from './comfyui/resolve-nodes.js'
import { resolveI2INodes, type ComfyI2INodeMap } from './comfyui/resolve-i2i-nodes.js'
import { loadComfyWorkflow } from './comfyui/workflow-files.js'
import { uploadImageToComfy } from './comfyui/upload.js'

function normalizeBase(baseUrl: string) {
  return String(baseUrl || '').replace(/\/+$/, '')
}

function parseReferenceImages(raw?: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean)
  } catch {
    /* ignore */
  }
  return String(raw).trim() ? [String(raw).trim()] : []
}

function writeEncodePrompt(node: any, prompt: string) {
  if (!node?.inputs) return
  if (node.inputs.prompt !== undefined) node.inputs.prompt = prompt
  else if (node.inputs.text !== undefined) node.inputs.text = prompt
}

function applyT2IParams(
  template: Workflow,
  nodes: ComfyNodeMap,
  params: {
    prompt: string
    negativePrompt?: string
    width: number
    height: number
    steps: number
    seed?: number
  },
): Workflow {
  const wf = structuredClone(template)
  const { positive, negative, sampler, latent } = nodes

  writeEncodePrompt(wf[positive], params.prompt)
  if (params.negativePrompt != null && negative && wf[negative]?.inputs) {
    writeEncodePrompt(wf[negative], params.negativePrompt)
  }

  wf[latent].inputs.width = params.width
  wf[latent].inputs.height = params.height
  if (wf[latent].inputs.batch_size != null) {
    wf[latent].inputs.batch_size = 1
  }

  if (!Array.isArray(wf[sampler].inputs.steps)) {
    wf[sampler].inputs.steps = params.steps
  }
  if (wf[sampler].inputs.seed !== undefined) {
    wf[sampler].inputs.seed =
      params.seed != null && params.seed >= 0
        ? params.seed
        : Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)
  }

  return wf
}

function applyI2IParams(
  template: Workflow,
  nodes: ComfyI2INodeMap,
  params: {
    prompt: string
    negativePrompt?: string
    imageName: string
    seed?: number
  },
): Workflow {
  const wf = structuredClone(template)
  wf[nodes.loadImage].inputs.image = params.imageName
  writeEncodePrompt(wf[nodes.positive], params.prompt)
  if (params.negativePrompt != null && nodes.negative && wf[nodes.negative]?.inputs) {
    writeEncodePrompt(wf[nodes.negative], params.negativePrompt)
  } else if (nodes.negative && wf[nodes.negative]?.inputs) {
    // 编辑工作流负向常为空串
    writeEncodePrompt(wf[nodes.negative], '')
  }

  const sampler = wf[nodes.sampler]
  if (sampler?.inputs?.seed !== undefined) {
    sampler.inputs.seed =
      params.seed != null && params.seed >= 0
        ? params.seed
        : Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)
  }
  return wf
}

function firstHistoryItem(result: any): { promptId: string; item: any } | null {
  if (!result || typeof result !== 'object') return null
  const entries = Object.entries(result)
  if (!entries.length) return null
  const [promptId, item] = entries[0]
  return { promptId: String(promptId), item }
}

function collectHistoryImages(item: any): Array<{ filename: string; subfolder: string; type: string }> {
  const images: Array<{ filename: string; subfolder: string; type: string }> = []
  if (!item?.outputs) return images
  for (const nodeOut of Object.values(item.outputs) as any[]) {
    if (!Array.isArray(nodeOut?.images)) continue
    for (const img of nodeOut.images) {
      if (!img?.filename) continue
      images.push({
        filename: String(img.filename),
        subfolder: String(img.subfolder || ''),
        type: String(img.type || 'output'),
      })
    }
  }
  return images
}

function buildViewUrl(baseUrl: string, img: { filename: string; subfolder: string; type: string }) {
  const qs = new URLSearchParams({
    filename: img.filename,
    subfolder: img.subfolder || '',
    type: img.type || 'output',
  })
  return `${normalizeBase(baseUrl)}/view?${qs}`
}

function authHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  return headers
}

export class ComfyUIImageAdapter implements ImageProviderAdapter {
  provider = 'comfyui'
  private lastBaseUrl = ''

  async buildGenerateRequest(config: AIConfig, record: ImageGenerationRecord): Promise<ProviderRequest> {
    this.lastBaseUrl = normalizeBase(config.baseUrl)
    const refs = parseReferenceImages(record.referenceImages)
    const prompt = String(record.prompt || '').trim()
    if (!prompt) throw new Error('ComfyUI 图片生成需要提示词')

    let workflow: Workflow
    if (refs.length) {
      // 造型变体 / 图生图：走图片编辑工作流
      const imageName = await uploadImageToComfy(config.baseUrl, refs[0], config.apiKey)
      const template = loadComfyWorkflow('i2i')
      const nodes = resolveI2INodes(template)
      workflow = applyI2IParams(template, nodes, {
        prompt,
        imageName,
      })
    } else {
      const template = loadComfyWorkflow('t2i')
      const nodes = resolveT2INodes(template)
      const size = resolveSize(record.size || '1920x1080')
      const clamped = clampForSdxl(size.width, size.height)
      workflow = applyT2IParams(template, nodes, {
        prompt,
        width: clamped.width,
        height: clamped.height,
        steps: qualityToSteps('high'),
      })
    }

    return {
      url: joinProviderUrl(config.baseUrl, '', '/prompt'),
      method: 'POST',
      headers: authHeaders(config.apiKey),
      body: {
        prompt: workflow,
        client_id: randomUUID(),
      },
    }
  }

  parseGenerateResponse(result: any): ImageGenResponse {
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

  parsePollResponse(result: any): ImagePollResponse {
    const hit = firstHistoryItem(result)
    if (!hit) return { status: 'processing' }

    const { item } = hit
    const images = collectHistoryImages(item)
    if (images.length) {
      return {
        status: 'completed',
        imageUrl: buildViewUrl(this.lastBaseUrl, images[0]),
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

  extractImageUrl(result: any): string | null {
    const hit = firstHistoryItem(result)
    if (!hit) return null
    const images = collectHistoryImages(hit.item)
    if (!images.length) return null
    return buildViewUrl(this.lastBaseUrl, images[0])
  }

  extractImageBase64(): { data: string; mimeType: string } | null {
    return null
  }
}
