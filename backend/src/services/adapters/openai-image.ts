/**
 * OpenAI / Real-API 图片生成 Adapter
 * - 官方 gpt-image-2 / DALL·E：文生图 /v1/images/generations；参考图 /v1/images/edits（multipart）
 * - gpt-image-2.5-*（flare/sunburst 等）：统一 /v1/images/generations，参考图用 image_urls（公网 URL）
 * 响应: { data: [{ url | b64_json }] }；异步 jobs: job_id + /v1/images/generations/jobs/{id}
 */
import type {
  ImageProviderAdapter,
  ProviderRequest,
  AIConfig,
  ImageGenerationRecord,
  ImageGenResponse,
  ImagePollResponse,
} from './types'
import { joinProviderUrl } from './url'
import { parseDataUrl } from '../../utils/storage.js'

function isGptImage25(model: string): boolean {
  return model.toLowerCase().startsWith('gpt-image-2.5')
}

export class OpenAIImageAdapter implements ImageProviderAdapter {
  provider = 'openai'

  buildGenerateRequest(config: AIConfig, record: ImageGenerationRecord): ProviderRequest {
    const model = record.model || config.model || 'gpt-image-2'
    const refs = this.parseReferenceImages(record.referenceImages)

    if (isGptImage25(model)) {
      return this.buildGptImage25Request(config, model, record, refs)
    }

    const isGptImage = model.startsWith('gpt-image-')
    const isGptImage2 = model === 'gpt-image-2'
    const size = isGptImage2
      ? this.normalizeGptImage2Size(record.size)
      : isGptImage
      ? this.normalizeGptImageSize(record.size)
      : record.size || '1024x1024'

    // 有参考图 → 走 edits（multipart 上传图片文件）；无参考图 → 纯文生图 generations
    if (refs.length) {
      return this.buildEditsRequest(config, model, record.prompt, size, refs)
    }

    const body: any = {
      model,
      prompt: record.prompt,
      size,
      n: 1,
    }

    if (!isGptImage) {
      body.response_format = 'url'
    }

    return {
      url: joinProviderUrl(config.baseUrl, '/v1', '/images/generations'),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body,
    }
  }

  /** Real-API gpt-image-2.5：generations + image_urls */
  private buildGptImage25Request(
    config: AIConfig,
    model: string,
    record: ImageGenerationRecord,
    refs: string[],
  ): ProviderRequest {
    const httpRefs = refs.filter((u) => /^https?:\/\//i.test(u))
    if (refs.length && !httpRefs.length) {
      throw new Error(
        'gpt-image-2.5 参考图须为公网 HTTP(S) URL。请配置 PUBLIC_BASE_URL，或改用已可公网访问的图片地址。',
      )
    }

    const body: Record<string, unknown> = {
      model,
      prompt: record.prompt || '',
      n: 1,
      size: this.normalizeGptImage25Size(record.size),
      resolution: '1K',
      quality: 'high',
    }
    if (httpRefs.length) body.image_urls = httpRefs.slice(0, 16)

    return {
      url: joinProviderUrl(config.baseUrl, '/v1', '/images/generations'),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body,
    }
  }

  private parseReferenceImages(raw?: string | null): string[] {
    if (!raw) return []
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : []
    } catch {
      return []
    }
  }

  /**
   * /v1/images/edits：参考图以 multipart/form-data 的 image[] 文件上传。
   * 参考图在 generation.ts 已归一化为 data URL（本地压缩 / 远程下载），
   * 这里只做 base64 → Blob 的转换；multipart 边界由 fetch 自动设置，不要手填 Content-Type。
   */
  private buildEditsRequest(
    config: AIConfig,
    model: string,
    prompt: string | null | undefined,
    size: string,
    refs: string[],
  ): ProviderRequest {
    const form = new FormData()
    form.append('model', model)
    form.append('prompt', prompt || '')
    form.append('size', size)
    form.append('n', '1')

    let appended = 0
    for (const ref of refs) {
      const parsed = parseDataUrl(ref)
      if (!parsed) continue
      const buffer = Buffer.from(parsed.data, 'base64')
      const ext = parsed.mimeType === 'image/png' ? 'png' : parsed.mimeType === 'image/webp' ? 'webp' : 'jpg'
      form.append('image[]', new Blob([buffer], { type: parsed.mimeType }), `reference-${++appended}.${ext}`)
    }
    if (!appended) {
      throw new Error('参考图片无法解析为可上传的文件（仅支持 data URL 形式的图片）')
    }

    return {
      url: joinProviderUrl(config.baseUrl, '/v1', '/images/edits'),
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: form,
    }
  }

  private normalizeGptImage25Size(size?: string | null): string {
    if (!size) return '1:1'
    const raw = String(size).trim()
    const lower = raw.toLowerCase()
    if (lower === 'auto') return 'auto'
    // 已是比例
    if (/^\d+:\d+$/.test(raw)) return raw

    const [width, height] = lower.split('x').map(Number)
    if (!width || !height) return 'auto'
    const ratio = width / height
    const candidates: Array<[string, number]> = [
      ['1:1', 1],
      ['3:2', 1.5],
      ['2:3', 2 / 3],
      ['4:3', 4 / 3],
      ['3:4', 3 / 4],
      ['16:9', 16 / 9],
      ['9:16', 9 / 16],
      ['2:1', 2],
      ['1:2', 0.5],
    ]
    let best = '1:1'
    let bestDiff = Infinity
    for (const [label, r] of candidates) {
      const d = Math.abs(ratio - r)
      if (d < bestDiff) {
        bestDiff = d
        best = label
      }
    }
    return best
  }

  private normalizeGptImageSize(size?: string | null): string {
    const allowed = ['1024x1024', '1536x1024', '1024x1536', 'auto']
    if (!size) return '1024x1024'

    const normalized = size.toLowerCase()
    if (allowed.includes(normalized)) return normalized

    const [width, height] = normalized.split('x').map(Number)
    if (!width || !height) return 'auto'
    if (width === height) return '1024x1024'
    return width > height ? '1536x1024' : '1024x1536'
  }

  private normalizeGptImage2Size(size?: string | null): string {
    if (!size) return '1024x1024'
    const normalized = size.toLowerCase()
    if (normalized === 'auto') return 'auto'

    const [rawWidth, rawHeight] = normalized.split('x').map(Number)
    if (!rawWidth || !rawHeight) return 'auto'

    const width = this.roundToMultiple(Math.min(4096, Math.max(256, rawWidth)), 16)
    const height = this.roundToMultiple(Math.min(4096, Math.max(256, rawHeight)), 16)
    return `${width}x${height}`
  }

  private roundToMultiple(value: number, multiple: number): number {
    return Math.max(multiple, Math.round(value / multiple) * multiple)
  }

  parseGenerateResponse(result: any): ImageGenResponse {
    const jobId = result.job_id ?? result.task_id
    if (jobId != null) {
      return { isAsync: true, taskId: String(jobId) }
    }
    // 仅当明确是异步任务 id（非图片 url 场景）时才用 result.id；避免误判
    if (result.id != null && result.status && !result.data?.[0]?.url && !result.data?.[0]?.b64_json) {
      return { isAsync: true, taskId: String(result.id) }
    }
    const imageUrl = result.data?.[0]?.url || result.url
    if (imageUrl) {
      return { isAsync: false, imageUrl }
    }
    const b64 = result.data?.[0]?.b64_json
    if (b64) {
      return { isAsync: false, imageUrl: undefined }
    }
    throw new Error('No image URL in response')
  }

  buildPollRequest(config: AIConfig, taskId: string): ProviderRequest {
    // Real-API jobs；旧路径 /images/task 作兼容回退由调用方同一 poll 解析
    return {
      url: joinProviderUrl(config.baseUrl, '/v1', `/images/generations/jobs/${taskId}`),
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: undefined,
    }
  }

  parsePollResponse(result: any): ImagePollResponse {
    const status = String(result.status || '').toLowerCase()
    if (status === 'completed' || status === 'success' || status === 'succeeded') {
      return {
        status: 'completed',
        imageUrl: result.image_url || result.data?.[0]?.url || null,
      }
    }
    if (status === 'failed' || status === 'error') {
      const err = result.error
      const msg = typeof err === 'string' ? err : (err?.message || 'Generation failed')
      return { status: 'failed', error: msg }
    }
    return { status: 'processing' }
  }

  extractImageUrl(result: any): string | null {
    return result.data?.[0]?.url || result.image_url || null
  }

  extractImageBase64(result: any): { data: string; mimeType: string } | null {
    const b64 = result.data?.[0]?.b64_json
    if (b64) {
      return { data: b64, mimeType: 'image/png' }
    }
    return null
  }
}
