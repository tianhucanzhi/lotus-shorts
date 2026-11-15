/**
 * 视频工作流节点自动识别
 * - R2V：MiniMaxH3ReferenceToVideo + 多 LoadImage（ref_images.ref_image_N）
 * - I2V：MiniMaxH3ImageToVideo + 单 LoadImage（first_frame）
 * 可选：duration Primitive / RandomNoise seed / ResolutionSelector / Prompt Primitive
 */
import { normalizeWorkflow, type Workflow } from './resolve-nodes.js'

export type ComfyVideoMode = 'r2v' | 'i2v'

export type ComfyI2VNodeMap = {
  mode: ComfyVideoMode
  /** 主视频节点（ReferenceToVideo / ImageToVideo） */
  videoNode: string
  /** @deprecated 兼容设置页旧字段，等同 videoNode */
  imageToVideo: string
  /** 模板里已挂到参考/首帧的 LoadImage 节点（按序号） */
  loadImageIds: string[]
  /** @deprecated 兼容设置页：首张 LoadImage */
  loadImage: string
  /** 提示词写入节点（PrimitiveString* 或主节点自身） */
  promptNode?: string
  duration?: string
  seed?: string
  resolution?: string
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

/** 从链路回溯到 LoadImage */
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

/** 从 length / values 链路回溯到可写 value 的 PrimitiveFloat/Int */
function findDurationPrimitive(wf: Workflow, startId: string | null, entries: ReturnType<typeof entriesOf>): string | null {
  if (startId) {
    const visited = new Set<string>()
    const queue = [startId]
    while (queue.length) {
      const id = queue.shift()!
      if (visited.has(id) || !wf[id]) continue
      visited.add(id)
      const ct = wf[id].class_type
      if (/Primitive(Float|Int)/i.test(ct) && wf[id].inputs?.value !== undefined) {
        return id
      }
      for (const v of Object.values(wf[id].inputs || {})) {
        const t = linkTarget(v)
        if (t) queue.push(t)
      }
    }
  }
  return (
    entries.find(([, n]) =>
      /Primitive(Float|Int)/i.test(n.class_type) && /duration|时长|秒/i.test(titleOf(n)),
    )?.[0] || null
  )
}

/** prompt 若是连线，找到 PrimitiveString*；否则主节点自身可写 */
function resolvePromptNode(wf: Workflow, videoNodeId: string, videoNode: any): string | undefined {
  const promptLink = linkTarget(videoNode.inputs?.prompt) || linkTarget(videoNode.inputs?.text)
  if (promptLink && wf[promptLink]) {
    const ct = wf[promptLink].class_type || ''
    if (/PrimitiveString/i.test(ct) && wf[promptLink].inputs?.value !== undefined) {
      return promptLink
    }
    // 再往上找一层
    for (const v of Object.values(wf[promptLink].inputs || {})) {
      const t = linkTarget(v)
      if (t && /PrimitiveString/i.test(wf[t]?.class_type || '') && wf[t]?.inputs?.value !== undefined) {
        return t
      }
    }
  }
  if (videoNode.inputs?.prompt !== undefined || videoNode.inputs?.text !== undefined) {
    // 直接写主节点（非连线）
    if (!promptLink) return videoNodeId
  }
  // 标题提示 Prompt 的 Primitive
  const byTitle = Object.entries(wf).find(
    ([, n]) =>
      n && /PrimitiveString/i.test(n.class_type || '')
      && /prompt|提示|input\s*text/i.test(titleOf(n))
      && n.inputs?.value !== undefined,
  )
  return byTitle?.[0]
}

function collectRefLoadImages(wf: Workflow, videoNode: any): string[] {
  const keyed: Array<{ index: number; id: string }> = []
  for (const [key, val] of Object.entries(videoNode.inputs || {})) {
    const m = /^ref_images\.ref_image_(\d+)$/i.exec(key)
    if (!m) continue
    const loadId = findLoadImageUpstream(wf, linkTarget(val))
    if (loadId && wf[loadId]?.inputs?.image !== undefined) {
      keyed.push({ index: Number(m[1]), id: loadId })
    }
  }
  keyed.sort((a, b) => a.index - b.index)
  const ids = keyed.map((k) => k.id)
  if (ids.length) return ids

  // 无 ref_images.* 时退回所有 LoadImage（按节点 id 排序）
  return Object.entries(wf)
    .filter(([, n]) => n?.class_type === 'LoadImage' && n.inputs?.image !== undefined)
    .map(([id]) => id)
    .sort((a, b) => Number(a) - Number(b) || a.localeCompare(b))
}

export function resolveI2VNodes(wf: Workflow): ComfyI2VNodeMap {
  const entries = entriesOf(wf)

  const r2vEntry = entries.find(([, n]) =>
    /ReferenceToVideo/i.test(n.class_type)
    || /参考转视频|Reference.?to.?Video/i.test(titleOf(n)),
  )
  const i2vEntry = entries.find(([, n]) =>
    /ImageToVideo/i.test(n.class_type)
    || /图像转视频|Image.?to.?Video/i.test(titleOf(n)),
  )

  if (r2vEntry) {
    const [videoNodeId, videoNode] = r2vEntry
    const loadImageIds = collectRefLoadImages(wf, videoNode)
    if (!loadImageIds.length) {
      throw new Error(
        '自动识别失败：ReferenceToVideo 未找到可用 LoadImage（需 ref_images.ref_image_N 或图中 LoadImage）',
      )
    }
    const promptNode = resolvePromptNode(wf, videoNodeId, videoNode)
    if (!promptNode) {
      throw new Error(`节点 ${videoNodeId} 无法写入提示词（需 prompt 连 PrimitiveString 或直接可写）`)
    }

    const durationId = findDurationPrimitive(wf, linkTarget(videoNode.inputs?.length), entries)
    const seedId =
      entries.find(([, n]) => n.class_type === 'RandomNoise' && n.inputs?.noise_seed !== undefined)?.[0]
      || entries.find(([, n]) => /KSampler/i.test(n.class_type) && n.inputs?.seed !== undefined)?.[0]
      || null
    const resolutionId = entries.find(([, n]) => n.class_type === 'ResolutionSelector')?.[0] || null

    return {
      mode: 'r2v',
      videoNode: videoNodeId,
      imageToVideo: videoNodeId,
      loadImageIds,
      loadImage: loadImageIds[0],
      promptNode,
      duration: durationId || undefined,
      seed: seedId || undefined,
      resolution: resolutionId || undefined,
    }
  }

  if (!i2vEntry) {
    throw new Error(
      '自动识别失败：未找到 MiniMaxH3ReferenceToVideo / MiniMaxH3ImageToVideo。请导入参考生视频或图生视频 API 工作流。',
    )
  }

  const [imageToVideoId, i2vNode] = i2vEntry
  let loadImageId = findLoadImageUpstream(
    wf,
    linkTarget(i2vNode.inputs?.first_frame)
      || linkTarget(i2vNode.inputs?.image)
      || linkTarget(i2vNode.inputs?.start_image),
  )
  if (!loadImageId) {
    loadImageId = entries.find(([, n]) => n.class_type === 'LoadImage')?.[0] || null
  }
  if (!loadImageId || wf[loadImageId]?.inputs?.image === undefined) {
    throw new Error('自动识别失败：未找到可用的 LoadImage 节点（需有 image 文件名字段）')
  }

  const promptNode = resolvePromptNode(wf, imageToVideoId, i2vNode)
  if (!promptNode) {
    throw new Error(`节点 ${imageToVideoId} 无 prompt/text 输入，无法写入视频提示词`)
  }

  const durationId = findDurationPrimitive(wf, linkTarget(i2vNode.inputs?.length), entries)
  const seedId =
    entries.find(([, n]) => n.class_type === 'RandomNoise' && n.inputs?.noise_seed !== undefined)?.[0]
    || entries.find(([, n]) => /KSampler/i.test(n.class_type) && n.inputs?.seed !== undefined)?.[0]
    || null
  const resolutionId = entries.find(([, n]) => n.class_type === 'ResolutionSelector')?.[0] || null

  return {
    mode: 'i2v',
    videoNode: imageToVideoId,
    imageToVideo: imageToVideoId,
    loadImageIds: [loadImageId],
    loadImage: loadImageId,
    promptNode,
    duration: durationId || undefined,
    seed: seedId || undefined,
    resolution: resolutionId || undefined,
  }
}

export function resolveI2VNodesFromRaw(raw: unknown): ComfyI2VNodeMap {
  return resolveI2VNodes(normalizeWorkflow(raw))
}

/** 供设置页 / API 展示（全为字符串） */
export function toDisplayNodes(nodes: ComfyI2VNodeMap): Record<string, string> {
  const out: Record<string, string> = {
    mode: nodes.mode,
    videoNode: nodes.videoNode,
    imageToVideo: nodes.imageToVideo,
    loadImage: nodes.loadImage,
    loadImages: nodes.loadImageIds.join(','),
  }
  if (nodes.promptNode) out.prompt = nodes.promptNode
  if (nodes.duration) out.duration = nodes.duration
  if (nodes.seed) out.seed = nodes.seed
  if (nodes.resolution) out.resolution = nodes.resolution
  return out
}
