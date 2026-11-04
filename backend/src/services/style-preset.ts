/**
 * 风格预设服务 — 将项目绑定的视觉风格解析为英文提示词片段
 * dramas.style 存 style_presets.value；查不到/已停用时返回空串（调用方走兜底）
 *
 * SaaS 隔离策略（copy-on-write）：
 * - user_id IS NULL：全局预设（种子 + 未改过的用户所见）
 * - 用户首次增删改时，把当前全局快照复制为自己的个人行，之后只读写个人副本
 * - 独立版始终只用全局行（user_id IS NULL）
 */
import { and, eq, isNull } from 'drizzle-orm'
import { isSaas } from '../config/mode.js'
import { db, schema } from '../db/index.js'
import { getRequestUserId } from './request-context.js'
import { now } from '../utils/response.js'

export async function userHasPersonalStylePresets(userId: number): Promise<boolean> {
  const [row] = await db.select({ id: schema.stylePresets.id })
    .from(schema.stylePresets)
    .where(eq(schema.stylePresets.userId, userId))
    .limit(1)
  return !!row
}

/** 列出对当前用户可见的风格预设：有个人副本用个人，否则用全局 */
export async function listVisibleStylePresets(userId: number | null | undefined) {
  if (isSaas() && userId && await userHasPersonalStylePresets(userId)) {
    return db.select().from(schema.stylePresets).where(eq(schema.stylePresets.userId, userId))
  }
  return db.select().from(schema.stylePresets).where(isNull(schema.stylePresets.userId))
}

/**
 * SaaS：确保用户已有个人副本；若尚无则从全局克隆一份。
 * 独立版 / 无 userId：no-op。
 */
export async function ensurePersonalStylePresets(userId: number | null | undefined): Promise<void> {
  if (!isSaas() || !userId) return
  if (await userHasPersonalStylePresets(userId)) return

  const globals = await db.select().from(schema.stylePresets).where(isNull(schema.stylePresets.userId))
  const ts = now()
  for (const g of globals) {
    await db.insert(schema.stylePresets).values({
      userId,
      name: g.name,
      value: g.value,
      prompt: g.prompt,
      description: g.description,
      sortOrder: g.sortOrder,
      isActive: g.isActive,
      createdAt: ts,
      updatedAt: ts,
    })
  }
}

/** 在用户个人副本中按 value 查找（fork 后全局 id 会映射到新 id） */
export async function findPersonalStylePresetByValue(userId: number, value: string) {
  const [row] = await db.select().from(schema.stylePresets)
    .where(and(eq(schema.stylePresets.userId, userId), eq(schema.stylePresets.value, value)))
  return row || null
}

/** 按风格 key 取英文提示词；优先项目归属用户的个人副本，否则全局 */
export async function getStylePromptByValue(
  styleValue: string | null | undefined,
  ownerUserId?: number | null,
): Promise<string> {
  const value = String(styleValue || '').trim()
  if (!value) return ''

  const userId = ownerUserId ?? (isSaas() ? getRequestUserId() : null)
  if (isSaas() && userId && await userHasPersonalStylePresets(userId)) {
    const [preset] = await db.select().from(schema.stylePresets)
      .where(and(
        eq(schema.stylePresets.userId, userId),
        eq(schema.stylePresets.value, value),
        eq(schema.stylePresets.isActive, true),
      ))
    return preset?.prompt || ''
  }

  const [preset] = await db.select().from(schema.stylePresets)
    .where(and(
      isNull(schema.stylePresets.userId),
      eq(schema.stylePresets.value, value),
      eq(schema.stylePresets.isActive, true),
    ))
  return preset?.prompt || ''
}

/** 查询项目绑定的风格预设英文提示词片段；查不到返回 '' */
export async function getDramaStylePrompt(dramaId: number | null | undefined): Promise<string> {
  if (!dramaId) return ''
  const [drama] = await db.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId))
  if (!drama?.style) return ''
  return getStylePromptByValue(drama.style, drama.userId)
}
