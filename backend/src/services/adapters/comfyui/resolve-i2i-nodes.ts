/**
 * 图片编辑（I2I）工作流节点识别
 * 默认：Qwen Image Edit — LoadImage + TextEncodeQwenImageEditPlus + KSampler
 */
import { normalizeWorkflow, type Workflow } from './resolve-nodes.js'

export type ComfyI2INodeMap = {
  loadImage: string
  positive: string
  negative?: string
  sampler: string
}

function linkTarget(input: unknown): string | null {
  if (Array.isArray(input) && input.length >= 1 && input[0] != null) {
    return String(input[0])
  }
  return null
}

function titleOf(node: any): string {
  return String(node?._meta?.title || node?.title || '')
}

function entriesOf(wf: Workflow) {
  return Object.entries(wf).filter(
    ([, n]) => n && typeof n === 'object' && typeof n.class_type === 'string',
  )
}

function isEditEncode(n: any): boolean {
  const ct = String(n?.class_type || '')
  return /TextEncodeQwenImageEdit/i.test(ct)
    || /QwenImageEdit/i.test(ct)
    || (/CLIPTextEncode/i.test(ct) && /edit|编辑/i.test(titleOf(n)))
}

function hasPromptField(n: any): boolean {
  return n?.inputs?.prompt !== undefined || n?.inputs?.text !== undefined
}

function findLoadImageUpstream(wf: Workflow, startId: string | null): string | null {
  if (!startId) return null
  if (wf[startId]?.class_type === 'LoadImage') return startId
  const visited = new Set<string>()
  const queue = [startId]
  while (queue.length) {
    const id = queue.shift()!
    if (visited.has(id) || !wf[id]) continue
    visited.add(id)
    if (wf[id].class_type === 'LoadImage') return id
    for (const v of Object.values(wf[id].inputs || {})) {
      const t = linkTarget(v)
      if (t) queue.push(t)
    }
  }
  return null
}

export function resolveI2INodes(wf: Workflow): ComfyI2INodeMap {
  const entries = entriesOf(wf)

  const samplerEntry = entries.find(([, n]) => /^KSampler/i.test(n.class_type))
  if (!samplerEntry) {
    throw new Error('自动识别失败：图片编辑工作流未找到 KSampler')
  }
  const [samplerId, sampler] = samplerEntry

  let positive = linkTarget(sampler.inputs?.positive)
  let negative = linkTarget(sampler.inputs?.negative)
  if (positive && !wf[positive]) positive = null
  if (negative && !wf[negative]) negative = null

  const encoders = entries.filter(([, n]) => isEditEncode(n) && hasPromptField(n))
  if (!positive) {
    positive =
      encoders.find(([, n]) => {
        const p = n.inputs?.prompt ?? n.inputs?.text
        return typeof p === 'string' && p.trim().length > 0
      })?.[0]
      || encoders[0]?.[0]
      || null
  }
  if (!negative) {
    negative = encoders.find(([id]) => id !== positive)?.[0] || null
  }

  if (!positive || !hasPromptField(wf[positive])) {
    throw new Error(
      '自动识别失败：未找到可写提示词的 TextEncodeQwenImageEditPlus / 编辑编码节点',
    )
  }

  // 优先从 positive 的 image1 / image 回溯 LoadImage
  let loadImageId =
    findLoadImageUpstream(wf, linkTarget(wf[positive].inputs?.image1))
    || findLoadImageUpstream(wf, linkTarget(wf[positive].inputs?.image))
    || findLoadImageUpstream(wf, linkTarget(sampler.inputs?.latent_image))

  if (!loadImageId) {
    loadImageId = entries.find(([, n]) => n.class_type === 'LoadImage')?.[0] || null
  }
  if (!loadImageId || wf[loadImageId]?.inputs?.image === undefined) {
    throw new Error('自动识别失败：未找到可用的 LoadImage 节点')
  }

  return {
    loadImage: loadImageId,
    positive,
    negative: negative || undefined,
    sampler: samplerId,
  }
}

export function resolveI2INodesFromRaw(raw: unknown): ComfyI2INodeMap {
  return resolveI2INodes(normalizeWorkflow(raw))
}

export function toI2IDisplayNodes(nodes: ComfyI2INodeMap): Record<string, string> {
  const out: Record<string, string> = {
    loadImage: nodes.loadImage,
    positive: nodes.positive,
    sampler: nodes.sampler,
  }
  if (nodes.negative) out.negative = nodes.negative
  return out
}
