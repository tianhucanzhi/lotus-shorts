/**
 * 简单文生图工作流节点自动识别
 * 策略：以 KSampler 连线为主，标题 / class_type 为辅
 * 复杂工作流（多采样器、自定义节点）识别失败时抛明确错误
 */

export type Workflow = Record<string, any>

export type ComfyNodeMap = {
  positive: string
  negative?: string
  sampler: string
  latent: string
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

/** 接受 API 格式；拒绝 ComfyUI 画布 UI 导出 */
export function normalizeWorkflow(raw: unknown): Workflow {
  if (!raw || typeof raw !== 'object') {
    throw new Error('工作流 JSON 无效')
  }
  const obj = raw as Record<string, any>
  if (Array.isArray(obj.nodes)) {
    throw new Error(
      '请使用 ComfyUI「Save (API Format)」导出的工作流，不要使用带 nodes 数组的画布格式',
    )
  }
  if (obj.prompt && typeof obj.prompt === 'object' && !Array.isArray(obj.prompt)) {
    return obj.prompt as Workflow
  }
  return obj as Workflow
}

/**
 * 从简单 SDXL/SD 文生图图自动解析写入节点
 * 必需：sampler + positive + latent；negative 可选
 */
export function resolveT2INodes(wf: Workflow): ComfyNodeMap {
  const entries = Object.entries(wf).filter(
    ([, n]) => n && typeof n === 'object' && typeof n.class_type === 'string',
  )

  const samplerEntry = entries.find(([, n]) => /^KSampler/i.test(n.class_type))
  if (!samplerEntry) {
    throw new Error(
      '自动识别失败：未找到 KSampler 节点。请使用简单文生图工作流，或保留内置 t2i 模板结构。',
    )
  }
  const [samplerId, sampler] = samplerEntry

  let positive = linkTarget(sampler.inputs?.positive)
  let negative = linkTarget(sampler.inputs?.negative)
  let latent = linkTarget(sampler.inputs?.latent_image)

  if (positive && !wf[positive]) positive = null
  if (negative && !wf[negative]) negative = null
  if (latent && !wf[latent]) latent = null

  if (!latent) {
    const lat = entries.find(([, n]) =>
      /EmptyLatentImage|EmptySD3LatentImage/i.test(n.class_type),
    )
    latent = lat?.[0] || null
  }

  const clips = entries.filter(([, n]) => n.class_type === 'CLIPTextEncode')
  if (!positive) {
    positive =
      clips.find(([, n]) => /positive|正面|正向/i.test(titleOf(n)))?.[0]
      || clips[0]?.[0]
      || null
  }
  if (!negative) {
    negative =
      clips.find(([, n]) => /negative|负面|负向/i.test(titleOf(n)))?.[0]
      || clips.find(([id]) => id !== positive)?.[0]
      || null
  }

  if (!positive || !latent) {
    throw new Error(
      `自动识别失败：positive=${positive || '?'} latent=${latent || '?'} sampler=${samplerId}。` +
        '复杂工作流暂不支持，请使用「CLIPTextEncode + KSampler + EmptyLatentImage」的简单结构。',
    )
  }

  // 校验写入字段存在，避免改到无对应 inputs 的节点
  if (wf[positive]?.inputs?.text === undefined) {
    throw new Error(`节点 ${positive} 无 text 输入，无法写入正向提示词`)
  }
  if (wf[latent]?.inputs?.width === undefined || wf[latent]?.inputs?.height === undefined) {
    throw new Error(`节点 ${latent} 无 width/height，无法写入尺寸`)
  }
  if (wf[samplerId]?.inputs?.steps === undefined) {
    throw new Error(`节点 ${samplerId} 无 steps，无法写入采样参数`)
  }

  return {
    positive,
    negative: negative || undefined,
    sampler: samplerId,
    latent,
  }
}
