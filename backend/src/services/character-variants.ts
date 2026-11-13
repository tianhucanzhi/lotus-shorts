/**
 * 人物造型变体：预设换装、归档主形象、嵌套列表
 */
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { db, getInsertId, schema } from '../db/index.js'
import { now } from '../utils/response.js'
import { toSnakeCase, toSnakeCaseArray } from '../utils/transform.js'

export const OUTFIT_PRESETS: Record<string, { label: string; outfit: string }> = {
  casual: { label: '常服', outfit: '日常常服，简洁得体，符合角色人设的日常穿着' },
  formal: { label: '正装', outfit: '正式正装或礼服，精致整洁' },
  leisure: { label: '休闲', outfit: '休闲装，舒适轻松，如卫衣牛仔裤或便装' },
  sleepwear: { label: '睡衣', outfit: '居家睡衣或睡袍' },
  ancient: { label: '古装', outfit: '古风服饰，华美有层次，符合东方古典气质' },
  school: { label: '校服', outfit: '学生校服或学院风制服' },
  combat: { label: '战斗装', outfit: '战斗装或机能作战服，利落有力量感' },
  injured: { label: '受伤', outfit: '衣物略显破损或带绷带，保持角色可辨识，不过度血腥' },
}

/** 造型变体提示词：与主形象同构图（左正脸特写 + 右三视图），仅换装 */
export function buildVariantOutfitPrompt(input: {
  charName: string
  appearance?: string | null
  styling?: string | null
  stylePrompt?: string | null
  outfit: string
  /** 角色已有三视图最终提示词时优先复用并注入换装 */
  baseFinalPrompt?: string | null
}) {
  const style = String(input.stylePrompt || '').trim()
  const base = String(input.baseFinalPrompt || '').trim()
  if (base) {
    return [
      style,
      base,
      `【换装】服装与配饰改为：${input.outfit}；脸、五官、发型轮廓与体型严格与参考图一致，不得改脸`,
      '输出仍为角色设定参考图：左侧正脸特写，右侧并列正面、90 度侧面、背面三张等高全身视图，正脸特写与三个视图的脸、发型和服装完全一致，纯白背景',
    ].filter(Boolean).join('\n')
  }
  return [
    style,
    '角色设定参考图，左侧为正脸特写，右侧并列展示正面、90 度侧面、背面三张等高全身视图',
    '特写与全身视图都是同一角色，全身入镜，中性 A 字站姿，三张全身视图等高并排、头顶脚底对齐',
    `同一人物「${input.charName}」换装三视图`,
    '严格保持与参考图相同的人脸、五官、发型轮廓与体型，仅更换服装与配饰',
    input.appearance || '',
    input.styling || '',
    input.outfit,
    '正脸特写与三个视图的脸、发型和服装完全一致',
    '纯白背景，柔和均匀的光线，电影质感',
  ].filter(Boolean).join('，')
}

export async function listActiveVariants(characterId: number) {
  return db.select().from(schema.characterVariants)
    .where(and(
      eq(schema.characterVariants.characterId, characterId),
      isNull(schema.characterVariants.deletedAt),
    ))
    .orderBy(asc(schema.characterVariants.sortOrder), asc(schema.characterVariants.id))
}

export async function listActiveVariantsByCharacterIds(characterIds: number[]) {
  const ids = [...new Set(characterIds.filter(Boolean))]
  if (!ids.length) return new Map<number, typeof schema.characterVariants.$inferSelect[]>()
  const rows = await db.select().from(schema.characterVariants)
    .where(and(
      inArray(schema.characterVariants.characterId, ids),
      isNull(schema.characterVariants.deletedAt),
    ))
    .orderBy(asc(schema.characterVariants.sortOrder), asc(schema.characterVariants.id))
  const map = new Map<number, typeof schema.characterVariants.$inferSelect[]>()
  for (const row of rows) {
    const list = map.get(row.characterId) || []
    list.push(row)
    map.set(row.characterId, list)
  }
  return map
}

export async function attachVariantsToCharacters<T extends { id: number }>(chars: T[]) {
  const variantsMap = await listActiveVariantsByCharacterIds(chars.map(c => c.id))
  return chars.map(ch => ({
    ...toSnakeCase(ch),
    variants: toSnakeCaseArray(variantsMap.get(ch.id) || []),
  }))
}

/** 主形象被覆盖前，把旧图归档为变体 */
export async function archivePrimaryImage(characterId: number, imageUrl: string | null | undefined) {
  const url = String(imageUrl || '').trim()
  if (!url) return null
  const existing = await listActiveVariants(characterId)
  const duplicated = existing.some(v => (v.imageUrl || v.localPath) === url)
  if (duplicated) return null
  const ts = now()
  const res = await db.insert(schema.characterVariants).values({
    characterId,
    label: '旧主形象',
    imageUrl: url,
    localPath: url,
    source: 'archive',
    presetKey: null,
    sortOrder: existing.length,
    createdAt: ts,
    updatedAt: ts,
  })
  return getInsertId(res)
}

export async function createVariantRow(input: {
  characterId: number
  label: string
  source: 'preset' | 'upload' | 'archive'
  presetKey?: string | null
  imageUrl?: string | null
  localPath?: string | null
  finalPrompt?: string | null
}) {
  const existing = await listActiveVariants(input.characterId)
  const ts = now()
  const res = await db.insert(schema.characterVariants).values({
    characterId: input.characterId,
    label: input.label,
    imageUrl: input.imageUrl || null,
    localPath: input.localPath || input.imageUrl || null,
    finalPrompt: input.finalPrompt || null,
    source: input.source,
    presetKey: input.presetKey || null,
    sortOrder: existing.length,
    createdAt: ts,
    updatedAt: ts,
  })
  const id = getInsertId(res)
  const [row] = await db.select().from(schema.characterVariants).where(eq(schema.characterVariants.id, id))
  return row
}
