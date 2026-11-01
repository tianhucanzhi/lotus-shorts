/**
 * 将本地参考素材上传到 Real-API（OpenAI 兼容网关）公网 OSS，
 * 供上游视频/图片 API 拉取。对应 POST {gateway}/api/utils/uploadOss。
 */
import fs from 'node:fs'
import path from 'node:path'
import { getAbsolutePath, parseDataUrl } from '../utils/storage.js'

const EXT_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
}

function gatewayOrigin(baseUrl: string): string {
  const raw = (baseUrl || '').trim().replace(/\/+$/, '')
  try {
    const u = new URL(raw)
    return `${u.protocol}//${u.host}`
  } catch {
    return raw.replace(/\/v1(?:\/.*)?$/i, '')
  }
}

export async function uploadBytesToGatewayOss(
  gatewayBaseUrl: string,
  bytes: Buffer,
  filename: string,
  mime: string,
): Promise<string> {
  const origin = gatewayOrigin(gatewayBaseUrl)
  if (!origin) throw new Error('网关 Base URL 无效，无法上传参考素材')

  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(bytes)], { type: mime }), filename)

  const resp = await fetch(`${origin}/api/utils/uploadOss`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(120_000),
  })
  const text = await resp.text()
  let json: any
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`参考素材上传失败 HTTP ${resp.status}: ${text.slice(0, 200)}`)
  }
  if (!resp.ok || json?.code !== 1 || !json?.data?.url) {
    throw new Error(json?.msg || `参考素材上传失败 HTTP ${resp.status}`)
  }
  return String(json.data.url)
}

async function uploadLocalStatic(gatewayBaseUrl: string, relativePath: string): Promise<string> {
  const localPath = relativePath.startsWith('/static/') ? relativePath.slice(1) : relativePath
  const abs = getAbsolutePath(localPath)
  if (!fs.existsSync(abs)) throw new Error(`参考素材不存在: ${relativePath}`)
  const bytes = fs.readFileSync(abs)
  const ext = path.extname(abs).toLowerCase()
  const mime = EXT_MIME[ext] || 'application/octet-stream'
  const filename = path.basename(abs) || `ref${ext || '.bin'}`
  return uploadBytesToGatewayOss(gatewayBaseUrl, bytes, filename, mime)
}

async function uploadDataUrl(gatewayBaseUrl: string, dataUrl: string): Promise<string> {
  const parsed = parseDataUrl(dataUrl)
  if (!parsed) throw new Error('参考素材 data URL 无法解析')
  const ext = parsed.mimeType === 'image/png' ? '.png'
    : parsed.mimeType === 'image/webp' ? '.webp'
    : parsed.mimeType === 'image/gif' ? '.gif'
    : parsed.mimeType.startsWith('video/') ? '.mp4'
    : parsed.mimeType.startsWith('audio/') ? '.mp3'
    : '.jpg'
  return uploadBytesToGatewayOss(
    gatewayBaseUrl,
    Buffer.from(parsed.data, 'base64'),
    `ref${ext}`,
    parsed.mimeType,
  )
}

/**
 * 解析为上游可拉取的公网 URL。
 * 优先 PUBLIC_BASE_URL；否则对本地/static 与 data URL 走网关 OSS 上传。
 */
export async function resolveGatewayPublicUrl(
  value: string | null | undefined,
  kind: 'video' | 'audio' | 'file',
  gatewayBaseUrl?: string | null,
): Promise<string | null> {
  const raw = String(value || '').trim()
  if (!raw) return null
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw

  const publicBase = (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '')
  if ((raw.startsWith('static/') || raw.startsWith('/static/')) && publicBase) {
    const p = raw.startsWith('/') ? raw : `/${raw}`
    return `${publicBase}${p}`
  }

  if (gatewayBaseUrl) {
    if (raw.startsWith('data:')) return uploadDataUrl(gatewayBaseUrl, raw)
    if (raw.startsWith('static/') || raw.startsWith('/static/')) {
      return uploadLocalStatic(gatewayBaseUrl, raw)
    }
  }

  if (raw.startsWith('data:')) {
    throw new Error(
      '参考素材为 data URL，上游无法直接访问。请配置 PUBLIC_BASE_URL，或使用 Real-API 等支持素材中转上传的网关。',
    )
  }
  if (raw.startsWith('static/') || raw.startsWith('/static/')) {
    const label = kind === 'video' ? '视频' : kind === 'audio' ? '音频' : '文件'
    throw new Error(
      `参考${label}为本地路径 ${raw}，但后端未配置 PUBLIC_BASE_URL，上游无法访问内网地址。` +
      `请在 backend/.env 配置 PUBLIC_BASE_URL，或改用公网 URL / Real-API 网关配置。`,
    )
  }
  return raw
}

export async function resolveGatewayPublicUrls(
  refs: string[] | null | undefined,
  kind: 'video' | 'audio' | 'file',
  gatewayBaseUrl?: string | null,
): Promise<string[]> {
  if (!Array.isArray(refs) || !refs.length) return []
  const items = Array.from(new Set(refs.map((item) => String(item || '').trim()).filter(Boolean)))
  const out = await Promise.all(items.map((item) => resolveGatewayPublicUrl(item, kind, gatewayBaseUrl)))
  return out.filter((item): item is string => !!item)
}
