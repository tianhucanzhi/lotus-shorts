/**
 * 分镜角色/道具绑定同步（保留造型选择）
 */
import { and, eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'

export type CharacterVariantMap = Record<string, number | null>

function normalizeVariantMap(raw: unknown): CharacterVariantMap | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out: CharacterVariantMap = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value == null || value === '') out[String(key)] = null
    else {
      const n = Number(value)
      out[String(key)] = Number.isFinite(n) && n > 0 ? n : null
    }
  }
  return out
}

export async function syncStoryboardCharacters(
  storyboardId: number,
  characterIds: number[],
  variantMapRaw?: unknown,
) {
  const variantMap = normalizeVariantMap(variantMapRaw)
  const existing = await db.select().from(schema.storyboardCharacters)
    .where(eq(schema.storyboardCharacters.storyboardId, storyboardId))
  const existingMap = new Map(existing.map(link => [link.characterId, link.variantId ?? null]))

  await db.delete(schema.storyboardCharacters)
    .where(eq(schema.storyboardCharacters.storyboardId, storyboardId))

  const uniqueIds = [...new Set((characterIds || []).filter(Boolean).map(Number))]
  for (const characterId of uniqueIds) {
    const key = String(characterId)
    let variantId: number | null = null
    if (variantMap && Object.prototype.hasOwnProperty.call(variantMap, key)) {
      variantId = variantMap[key]
    } else {
      variantId = existingMap.get(characterId) ?? null
    }
    await db.insert(schema.storyboardCharacters).values({
      storyboardId,
      characterId,
      variantId,
    })
  }
}

/** 仅更新已绑定角色的造型，不改绑定列表 */
export async function syncStoryboardCharacterVariants(storyboardId: number, variantMapRaw: unknown) {
  const variantMap = normalizeVariantMap(variantMapRaw)
  if (!variantMap) return
  const links = await db.select().from(schema.storyboardCharacters)
    .where(eq(schema.storyboardCharacters.storyboardId, storyboardId))
  for (const link of links) {
    const key = String(link.characterId)
    if (!Object.prototype.hasOwnProperty.call(variantMap, key)) continue
    await db.update(schema.storyboardCharacters)
      .set({ variantId: variantMap[key] })
      .where(and(
        eq(schema.storyboardCharacters.storyboardId, storyboardId),
        eq(schema.storyboardCharacters.characterId, link.characterId),
      ))
  }
}

export async function getStoryboardCharacterIds(storyboardId: number) {
  const links = await db.select().from(schema.storyboardCharacters)
    .where(eq(schema.storyboardCharacters.storyboardId, storyboardId))
  return links.map(link => link.characterId)
}

export async function getStoryboardCharacterVariantMap(storyboardId: number): Promise<CharacterVariantMap> {
  const links = await db.select().from(schema.storyboardCharacters)
    .where(eq(schema.storyboardCharacters.storyboardId, storyboardId))
  const map: CharacterVariantMap = {}
  for (const link of links) {
    map[String(link.characterId)] = link.variantId ?? null
  }
  return map
}

export function buildCharacterVariantMapFromLinks(
  links: { storyboardId: number; characterId: number; variantId?: number | null }[],
  storyboardId: number,
): CharacterVariantMap {
  const map: CharacterVariantMap = {}
  for (const link of links) {
    if (link.storyboardId !== storyboardId) continue
    map[String(link.characterId)] = link.variantId ?? null
  }
  return map
}
