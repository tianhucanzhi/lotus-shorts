/** 将莲花本地/远端图片上传到 ComfyUI input，供 LoadImage 使用 */
import fs from 'node:fs'
import path from 'node:path'
import { getAbsolutePath } from '../../../utils/storage.js'

function normalizeBase(baseUrl: string) {
  return String(baseUrl || '').replace(/\/+$/, '')
}

async function readImageBytes(urlOrPath: string): Promise<{ buf: Buffer; filename: string }> {
  const raw = String(urlOrPath || '').trim()
  if (!raw) throw new Error('缺少参考图')

  // data URL
  const dataMatch = raw.match(/^data:([^;]+);base64,(.+)$/i)
  if (dataMatch) {
    const ext = (dataMatch[1].split('/')[1] || 'png').replace('jpeg', 'jpg')
    return { buf: Buffer.from(dataMatch[2], 'base64'), filename: `ref.${ext}` }
  }

  // 本地 static 路径
  let rel = raw
  if (rel.startsWith('/static/')) rel = rel.slice(1)
  if (rel.startsWith('static/') || (!/^https?:\/\//i.test(rel) && !path.isAbsolute(rel))) {
    const abs = getAbsolutePath(rel.startsWith('static/') ? rel : rel.replace(/^\//, ''))
    if (fs.existsSync(abs)) {
      return { buf: fs.readFileSync(abs), filename: path.basename(abs) }
    }
  }

  if (path.isAbsolute(raw) && fs.existsSync(raw)) {
    return { buf: fs.readFileSync(raw), filename: path.basename(raw) }
  }

  if (/^https?:\/\//i.test(raw)) {
    const resp = await fetch(raw)
    if (!resp.ok) throw new Error(`下载参考图失败: HTTP ${resp.status}`)
    const buf = Buffer.from(await resp.arrayBuffer())
    const urlPath = new URL(raw).pathname
    const filename = path.basename(urlPath) || 'ref.png'
    return { buf, filename }
  }

  throw new Error(`无法读取参考图: ${raw.slice(0, 120)}`)
}

/** POST /upload/image → 返回 ComfyUI 可用的文件名 */
export async function uploadImageToComfy(baseUrl: string, urlOrPath: string, apiKey?: string): Promise<string> {
  const { buf, filename } = await readImageBytes(urlOrPath)
  const form = new FormData()
  form.append('image', new Blob([new Uint8Array(buf)]), filename)
  form.append('overwrite', 'true')

  const headers: Record<string, string> = {}
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`

  const resp = await fetch(`${normalizeBase(baseUrl)}/upload/image`, {
    method: 'POST',
    headers,
    body: form,
  })
  if (!resp.ok) {
    throw new Error(`上传图片到 ComfyUI 失败: HTTP ${resp.status} ${await resp.text()}`)
  }
  const data = (await resp.json()) as { name?: string; subfolder?: string }
  if (!data?.name) throw new Error(`ComfyUI 上传未返回文件名: ${JSON.stringify(data)}`)
  // LoadImage 通常只要 name；若有 subfolder 则用相对路径
  return data.subfolder ? `${data.subfolder}/${data.name}` : data.name
}
