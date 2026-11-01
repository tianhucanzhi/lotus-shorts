/**
 * OpenAI 兼容视频生成 Adapter（Real-API /v1/videos/generations）
 * 创建: POST /v1/videos/generations/jobs -> { job_id }
 * 轮询: GET  /v1/videos/generations/jobs/{job_id} -> status + data[].url
 *
 * 统一入口覆盖 Seedance 2.5 / MiniMax-H3 / Wan 3.0 等模型，按 model 做分辨率与参考字段归一。
 */
import type {
  VideoProviderAdapter,
  ProviderRequest,
  AIConfig,
  VideoGenerationRecord,
  VideoGenResponse,
  VideoPollResponse,
} from './types'
import { joinProviderUrl } from './url'

function parseUrlArray(raw?: string | null): string[] {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter((u) => typeof u === 'string' && u.trim()) : []
  } catch {
    return []
  }
}

function modelFamily(model: string): 'seedance' | 'minimax' | 'wan' | 'other' {
  const m = model.toLowerCase()
  if (m.includes('seedance') || m.startsWith('doubao-seedance')) return 'seedance'
  if (m.includes('minimax-h3') || m === 'minimax-h3') return 'minimax'
  if (m.startsWith('wan3') || m.includes('wan-3') || m.includes('wan3.0')) return 'wan'
  return 'other'
}

export class OpenAIVideoAdapter implements VideoProviderAdapter {
  provider = 'openai'

  buildGenerateRequest(config: AIConfig, record: VideoGenerationRecord): ProviderRequest {
    const model = record.model || config.model || 'doubao-seedance-2.5'
    const family = modelFamily(model)
    const prompt = (record.prompt || '').trim()
    const refImages = parseUrlArray(record.referenceImageUrls)
    const refVideos = parseUrlArray(record.referenceVideoUrls)
    const refAudios = parseUrlArray(record.referenceAudioUrls)
    const firstFrame = (record.firstFrameUrl || record.imageUrl || '').trim()
    const lastFrame = (record.lastFrameUrl || '').trim()
    const fileUrl = (record.referenceFileUrl || '').trim()
    const linkUrl = (record.referenceLinkUrl || '').trim()

    if (!prompt && !refImages.length && !refVideos.length && !refAudios.length && !firstFrame && !lastFrame && !fileUrl && !linkUrl) {
      throw new Error('视频生成需要提示词或至少一个参考素材')
    }

    const body: Record<string, unknown> = {
      model,
      prompt: prompt || undefined,
      duration: this.normalizeDuration(family, record.duration),
      resolution: this.normalizeResolution(family, record.resolution),
      watermark: record.watermark === 1 || record.watermark === true,
    }

    if (typeof record.seed === 'number' && record.seed > 0) {
      body.seed = record.seed
    }

    const hasFirstLast = !!(firstFrame || lastFrame)
    const hasMultiRef = !!(refImages.length || refVideos.length || refAudios.length || fileUrl || linkUrl)

    if (family === 'minimax' && hasFirstLast && hasMultiRef) {
      throw new Error('MiniMax-H3 图生字段与多模态参考字段不能同时使用')
    }

    if (hasFirstLast) {
      const roles: Array<{ url: string; role: string }> = []
      if (firstFrame) roles.push({ url: firstFrame, role: 'first_frame' })
      if (lastFrame) roles.push({ url: lastFrame, role: 'last_frame' })
      if (family === 'minimax') {
        if (firstFrame) body.first_frame_image = firstFrame
        if (lastFrame) body.last_frame_image = lastFrame
      } else {
        body.image_with_roles = roles
        body.size = 'adaptive'
      }
    } else if (hasMultiRef) {
      if (refImages.length) body.image_urls = refImages
      if (refVideos.length) body.video_urls = refVideos
      if (refAudios.length) body.audio_urls = refAudios
      if (fileUrl) body.file_url = fileUrl
      if (linkUrl) body.link_url = linkUrl
      if (family === 'wan' && (refImages.length || refVideos.length || refAudios.length || fileUrl || linkUrl)) {
        body.generation_type = 'reference'
      }
      const ratio = (record.aspectRatio || '').trim()
      body.size = ratio || 'adaptive'
      if (family === 'minimax' && ratio) body.aspect_ratio = ratio
    } else {
      // 文生视频
      const ratio = (record.aspectRatio || '').trim() || '16:9'
      body.size = ratio === 'adaptive' ? '16:9' : ratio
      if (family === 'minimax') {
        body.aspect_ratio = body.size
      }
    }

    // Seedance / Wan 音轨开关；MiniMax H3 默认带音轨，字段可兼容传
    const generateAudio = record.generateAudio !== 0 && record.generateAudio !== false
    body.generate_audio = generateAudio
    if (family === 'wan') body.audio = generateAudio

    return {
      url: joinProviderUrl(config.baseUrl, '/v1', '/videos/generations/jobs'),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body,
    }
  }

  parseGenerateResponse(result: any): VideoGenResponse {
    const jobId = result.job_id ?? result.id ?? result.task_id
    const videoUrl = result.data?.[0]?.url || result.video_url || result.url
    if (videoUrl && (result.status === 'success' || result.status === 'succeeded' || !jobId)) {
      return { isAsync: false, videoUrl, taskId: jobId == null ? undefined : String(jobId), duration: result.duration }
    }
    if (jobId != null) return { isAsync: true, taskId: String(jobId) }
    throw new Error('No job_id or video url in response')
  }

  buildPollRequest(config: AIConfig, taskId: string): ProviderRequest {
    return {
      url: joinProviderUrl(config.baseUrl, '/v1', `/videos/generations/jobs/${taskId}`),
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: undefined,
    }
  }

  parsePollResponse(result: any): VideoPollResponse {
    const status = String(result.status || '').toLowerCase()
    if (status === 'success' || status === 'succeeded' || status === 'completed') {
      return {
        status: 'completed',
        videoUrl: result.data?.[0]?.url || result.video_url || result.url,
        duration: result.duration ?? result.data?.[0]?.duration,
      }
    }
    if (status === 'failed' || status === 'error' || status === 'cancelled') {
      const err = result.error
      const msg = typeof err === 'string' ? err : (err?.message || result.msg || 'Video generation failed')
      return { status: 'failed', error: String(msg) }
    }
    return { status: 'processing' }
  }

  extractVideoUrl(result: any): string | null {
    return result.data?.[0]?.url || result.video_url || result.url || null
  }

  private normalizeDuration(family: ReturnType<typeof modelFamily>, duration?: number | null): number {
    const parsed = Math.round(Number(duration ?? 5))
    if (!Number.isFinite(parsed) || parsed === -1) {
      return family === 'wan' ? -1 : 5
    }
    if (family === 'minimax') return Math.min(15, Math.max(4, parsed))
    if (family === 'wan') return Math.min(30, Math.max(2, parsed))
    // seedance / other: 4~30
    return Math.min(30, Math.max(4, parsed))
  }

  private normalizeResolution(family: ReturnType<typeof modelFamily>, resolution?: string | null): string {
    const r = String(resolution || '').trim().toLowerCase()
    if (family === 'minimax') {
      if (r === '1080p' || r === '2k') return '2K'
      return '768P'
    }
    if (family === 'wan') {
      if (r === '480p') return '480P'
      if (r === '1080p') return '1080P'
      return '720P'
    }
    // seedance 2.5: 仅 480p / 720p
    return r === '480p' ? '480p' : '720p'
  }
}
