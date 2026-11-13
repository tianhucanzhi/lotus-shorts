import { Hono } from 'hono'
import type { AuthVariables } from '../middleware/auth.js'
import { denyUnlessCharacterOwner, denyUnlessDramaOwner, denyUnlessEpisodeOwner } from '../services/access.js'
import { and, eq, isNull } from 'drizzle-orm'
import { db, getInsertId, schema } from '../db/index.js'
import { success, created, badRequest, now } from '../utils/response.js'
import { toSnakeCase, toSnakeCaseArray } from '../utils/transform.js'
import { generateImage } from '../services/generation.js'
import { getDramaStylePrompt } from '../services/style-preset.js'
import { ensureCharacterFinalPrompt } from '../services/final-prompt.js'
import { logTaskError, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'
import {
  OUTFIT_PRESETS,
  archivePrimaryImage,
  buildVariantOutfitPrompt,
  createVariantRow,
  listActiveVariants,
} from '../services/character-variants.js'

const app = new Hono<{ Variables: AuthVariables }>()
const CHARACTER_IMAGE_SIZE = '1920x1080'

// POST /characters — 手动新增角色（传入 episode_id 时关联到该集）
app.post('/', async (c) => {
  const body = await c.req.json()
  if (!body.drama_id) return badRequest(c, 'drama_id 必填')
  const deniedDrama = await denyUnlessDramaOwner(c, Number(body.drama_id))
  if (deniedDrama) return deniedDrama
  if (!body.name?.trim()) return badRequest(c, '名称必填')
  const ts = now()
  const res = await db.insert(schema.characters).values({
    name: body.name.trim(),
    role: body.role || '',
    description: body.description || '',
    appearance: body.appearance || '',
    styling: body.styling || '',
    dramaId: body.drama_id,
    createdAt: ts,
    updatedAt: ts,
  })
  const charId = getInsertId(res)
  if (body.episode_id) {
    const existing = await db.select().from(schema.episodeCharacters)
      .where(and(eq(schema.episodeCharacters.episodeId, Number(body.episode_id)), eq(schema.episodeCharacters.characterId, charId)))
    if (!existing.length) {
      await db.insert(schema.episodeCharacters).values({ episodeId: Number(body.episode_id), characterId: charId, createdAt: ts })
    }
  }
  const [row] = await db.select().from(schema.characters).where(eq(schema.characters.id, charId))
  return created(c, toSnakeCase(row))
})

function characterImagePrompt(char: typeof schema.characters.$inferSelect, stylePrompt = '') {
  return [
    stylePrompt || '',
    char.name,
    char.appearance || char.description || '人物立绘',
    char.styling || '',
    '16:9 横版角色定妆照',
    '半身角色海报构图',
    '正面',
    '高质量',
    '白色背景',
  ].filter(Boolean).join(', ')
}

// PUT /characters/:id
app.put('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const denied = await denyUnlessCharacterOwner(c, id)
  if (denied) return denied
  const body = await c.req.json()
  const [char] = await db.select().from(schema.characters).where(eq(schema.characters.id, id))
  if (!char) return badRequest(c, '角色不存在')
  const updates: Record<string, any> = { updatedAt: now() }
  for (const key of ['name', 'role', 'description', 'appearance', 'styling', 'imageUrl', 'localPath']) {
    const snakeKey = key.replace(/[A-Z]/g, m => '_' + m.toLowerCase())
    if (snakeKey in body) updates[key] = body[snakeKey]
    else if (key in body) updates[key] = body[key]
  }
  // 手动编辑最终提示词时以传入值为准；未传入则保留原值（修改信息时不再自动置空）
  if (body.final_prompt !== undefined) updates.finalPrompt = body.final_prompt || null
  else if (body.finalPrompt !== undefined) updates.finalPrompt = body.finalPrompt || null
  const nextImage = updates.imageUrl as string | undefined
  if (nextImage && char.imageUrl && nextImage !== char.imageUrl) {
    await archivePrimaryImage(id, char.imageUrl)
  }
  await db.update(schema.characters).set(updates).where(eq(schema.characters.id, id))
  return success(c)
})

// GET /characters/:id/variants
app.get('/:id/variants', async (c) => {
  const id = Number(c.req.param('id'))
  const denied = await denyUnlessCharacterOwner(c, id)
  if (denied) return denied
  const rows = await listActiveVariants(id)
  return success(c, toSnakeCaseArray(rows))
})

// POST /characters/:id/variants — 上传造型
app.post('/:id/variants', async (c) => {
  const id = Number(c.req.param('id'))
  const denied = await denyUnlessCharacterOwner(c, id)
  if (denied) return denied
  const body = await c.req.json()
  const [char] = await db.select().from(schema.characters).where(eq(schema.characters.id, id))
  if (!char) return badRequest(c, '角色不存在')
  const imageUrl = String(body.image_url || body.imageUrl || '').trim()
  if (!imageUrl) return badRequest(c, 'image_url 必填')
  if (!char.imageUrl) return badRequest(c, '请先生成主形象后再添加造型')
  const row = await createVariantRow({
    characterId: id,
    label: String(body.label || '上传造型').trim() || '上传造型',
    source: 'upload',
    imageUrl,
    localPath: body.local_path || body.localPath || imageUrl,
  })
  return created(c, toSnakeCase(row))
})

// POST /characters/:id/variants/generate — 预设一键换装
app.post('/:id/variants/generate', async (c) => {
  const id = Number(c.req.param('id'))
  const denied = await denyUnlessCharacterOwner(c, id)
  if (denied) return denied
  const body = await c.req.json()
  const [char] = await db.select().from(schema.characters).where(eq(schema.characters.id, id))
  if (!char) return badRequest(c, '角色不存在')
  if (!char.imageUrl) return badRequest(c, '请先生成主形象后再生成造型')
  if (!body.episode_id) return badRequest(c, 'episode_id 必填')
  const presetKey = String(body.preset_key || body.presetKey || '').trim()
  const customOutfit = String(body.outfit || body.custom_outfit || '').trim()
  const customLabel = String(body.label || '').trim()
  let outfitText = ''
  let label = ''
  let source: 'preset' | 'upload' | 'archive' = 'preset'
  if (presetKey === 'custom') {
    if (!customOutfit) return badRequest(c, '请填写自定义造型描述')
    outfitText = customOutfit
    label = customLabel || (customOutfit.length > 12 ? `${customOutfit.slice(0, 12)}…` : customOutfit)
    source = 'preset'
  } else {
    const preset = OUTFIT_PRESETS[presetKey]
    if (!preset) return badRequest(c, '无效的造型预设')
    outfitText = preset.outfit
    label = preset.label
  }

  const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, Number(body.episode_id)))
  if (!ep) return badRequest(c, '剧集不存在')

  const stylePrompt = await getDramaStylePrompt(char.dramaId)
  // 与主形象一致：先确保三视图最终提示词，再注入换装要求
  const baseFinalPrompt = await ensureCharacterFinalPrompt(char, ep.id, false, {
    model: body.text_model,
    configId: body.text_config_id ?? undefined,
  })
  const prompt = buildVariantOutfitPrompt({
    charName: char.name,
    appearance: char.appearance || char.description || '',
    styling: char.styling || '',
    stylePrompt,
    outfit: outfitText,
    baseFinalPrompt: baseFinalPrompt || char.finalPrompt,
  })
  const variant = await createVariantRow({
    characterId: id,
    label,
    source,
    presetKey: presetKey || null,
    finalPrompt: prompt,
  })
  try {
    logTaskStart('CharacterVariant', 'generate', { characterId: id, variantId: variant.id, presetKey })
    const genId = await generateImage({
      characterId: id,
      characterVariantId: variant.id,
      dramaId: char.dramaId,
      prompt,
      model: body.model,
      size: CHARACTER_IMAGE_SIZE,
      referenceImages: [char.imageUrl],
      configId: body.config_id ?? ep.imageConfigId ?? undefined,
    })
    logTaskSuccess('CharacterVariant', 'generate', { characterId: id, variantId: variant.id, generationId: genId })
    const [freshVariant] = await db.select().from(schema.characterVariants).where(eq(schema.characterVariants.id, variant.id))
    return success(c, { image_generation_id: genId, variant: toSnakeCase(freshVariant || variant) })
  } catch (err: any) {
    await db.update(schema.characterVariants).set({ deletedAt: now(), updatedAt: now() })
      .where(eq(schema.characterVariants.id, variant.id))
    logTaskError('CharacterVariant', 'generate', { characterId: id, error: err.message })
    return badRequest(c, err.message)
  }
})

// PUT /characters/:id/variants/:variantId — 设为主形象等
app.put('/:id/variants/:variantId', async (c) => {
  const id = Number(c.req.param('id'))
  const variantId = Number(c.req.param('variantId'))
  const denied = await denyUnlessCharacterOwner(c, id)
  if (denied) return denied
  const body = await c.req.json()
  const [variant] = await db.select().from(schema.characterVariants)
    .where(and(
      eq(schema.characterVariants.id, variantId),
      eq(schema.characterVariants.characterId, id),
      isNull(schema.characterVariants.deletedAt),
    ))
  if (!variant) return badRequest(c, '造型不存在')

  if (body.set_as_primary || body.setAsPrimary) {
    const imageUrl = variant.imageUrl || variant.localPath
    if (!imageUrl) return badRequest(c, '该造型尚无图片，无法设为主形象')
    const [char] = await db.select().from(schema.characters).where(eq(schema.characters.id, id))
    if (char?.imageUrl && char.imageUrl !== imageUrl) {
      await archivePrimaryImage(id, char.imageUrl)
    }
    await db.update(schema.characters).set({ imageUrl, localPath: imageUrl, updatedAt: now() })
      .where(eq(schema.characters.id, id))
    return success(c, { image_url: imageUrl })
  }

  const updates: Record<string, any> = { updatedAt: now() }
  if (body.label !== undefined) updates.label = String(body.label || '').trim() || variant.label
  if (body.image_url !== undefined || body.imageUrl !== undefined) {
    updates.imageUrl = body.image_url ?? body.imageUrl
    updates.localPath = body.local_path ?? body.localPath ?? updates.imageUrl
  }
  await db.update(schema.characterVariants).set(updates).where(eq(schema.characterVariants.id, variantId))
  return success(c)
})

// DELETE /characters/:id/variants/:variantId
app.delete('/:id/variants/:variantId', async (c) => {
  const id = Number(c.req.param('id'))
  const variantId = Number(c.req.param('variantId'))
  const denied = await denyUnlessCharacterOwner(c, id)
  if (denied) return denied
  const [variant] = await db.select().from(schema.characterVariants)
    .where(and(
      eq(schema.characterVariants.id, variantId),
      eq(schema.characterVariants.characterId, id),
      isNull(schema.characterVariants.deletedAt),
    ))
  if (!variant) return badRequest(c, '造型不存在')
  await db.update(schema.characterVariants).set({ deletedAt: now(), updatedAt: now() })
    .where(eq(schema.characterVariants.id, variantId))
  // 清理分镜上对该造型的引用（回退主形象）
  await db.update(schema.storyboardCharacters).set({ variantId: null })
    .where(eq(schema.storyboardCharacters.variantId, variantId))
  return success(c)
})

// DELETE /characters/:id
app.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const denied = await denyUnlessCharacterOwner(c, id)
  if (denied) return denied
  await db.update(schema.characters).set({ deletedAt: now() }).where(eq(schema.characters.id, id))
  return success(c)
})

// POST /characters/:id/generate-image
app.post('/:id/generate-image', async (c) => {
  const id = Number(c.req.param('id'))
  const denied = await denyUnlessCharacterOwner(c, id)
  if (denied) return denied
  const body = await c.req.json()
  const [char] = await db.select().from(schema.characters).where(eq(schema.characters.id, id))
  if (!char) return badRequest(c, '角色不存在')
  if (!body.episode_id) return badRequest(c, 'episode_id 必填')

  const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, Number(body.episode_id)))
  if (!ep) return badRequest(c, '剧集不存在')

  const stylePrompt = await getDramaStylePrompt(char.dramaId)
  const finalPrompt = await ensureCharacterFinalPrompt(char, ep.id, false, { model: body.text_model, configId: body.text_config_id ?? undefined })
  const prompt = finalPrompt || characterImagePrompt(char, stylePrompt)
  try {
    logTaskStart('CharacterImage', 'generate', { characterId: id, episodeId: ep.id, dramaId: char.dramaId })
    const genId = await generateImage({ characterId: id, dramaId: char.dramaId, prompt, model: body.model, size: CHARACTER_IMAGE_SIZE, configId: body.config_id ?? ep.imageConfigId ?? undefined })
    logTaskSuccess('CharacterImage', 'generate', { characterId: id, generationId: genId })
    return success(c, { image_generation_id: genId })
  } catch (err: any) {
    logTaskError('CharacterImage', 'generate', { characterId: id, error: err.message })
    return badRequest(c, err.message)
  }
})

// POST /characters/:id/generate-prompt — 独立生成/重新生成三视图最终提示词（不生图）
app.post('/:id/generate-prompt', async (c) => {
  const id = Number(c.req.param('id'))
  const denied = await denyUnlessCharacterOwner(c, id)
  if (denied) return denied
  const body = await c.req.json()
  const [char] = await db.select().from(schema.characters).where(eq(schema.characters.id, id))
  if (!char) return badRequest(c, '角色不存在')
  if (!body.episode_id) return badRequest(c, 'episode_id 必填')

  const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, Number(body.episode_id)))
  if (!ep) return badRequest(c, '剧集不存在')

  logTaskStart('FinalPrompt', 'character-generate', { characterId: id, episodeId: ep.id, force: !!body.force })
  const finalPrompt = await ensureCharacterFinalPrompt(char, ep.id, !!body.force, { model: body.text_model, configId: body.text_config_id ?? undefined })
  if (!finalPrompt) {
    logTaskError('FinalPrompt', 'character-generate', { characterId: id, error: 'agent returned empty prompt' })
    return badRequest(c, '最终提示词生成失败，请重试')
  }
  logTaskSuccess('FinalPrompt', 'character-generate', { characterId: id })
  return success(c, { final_prompt: finalPrompt })
})

// POST /characters/batch-generate-images
app.post('/batch-generate-images', async (c) => {
  const body = await c.req.json()
  const ids: number[] = body.character_ids || []
  if (!body.episode_id) return badRequest(c, 'episode_id 必填')
  const deniedEp = await denyUnlessEpisodeOwner(c, Number(body.episode_id))
  if (deniedEp) return deniedEp
  const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, Number(body.episode_id)))
  if (!ep) return badRequest(c, '剧集不存在')
  const results: number[] = []
  const stylePrompt = await getDramaStylePrompt(ep.dramaId)
  for (const cid of ids) {
    const [char] = await db.select().from(schema.characters).where(eq(schema.characters.id, cid))
    if (!char) continue
    const finalPrompt = await ensureCharacterFinalPrompt(char, ep.id, false, { model: body.text_model, configId: body.text_config_id ?? undefined })
    const prompt = finalPrompt || characterImagePrompt(char, stylePrompt)
    try {
      const genId = await generateImage({ characterId: cid, dramaId: char.dramaId, prompt, model: body.model, size: CHARACTER_IMAGE_SIZE, configId: body.config_id ?? ep.imageConfigId ?? undefined })
      results.push(genId)
    } catch {}
  }
  logTaskSuccess('CharacterImage', 'batch-generate', { episodeId: ep.id, requested: ids.length, started: results.length })
  return success(c, { count: results.length, ids: results })
})

export default app
