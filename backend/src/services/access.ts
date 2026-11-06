import { and, eq, isNull } from 'drizzle-orm'
import type { Context } from 'hono'
import { isSaas } from '../config/mode.js'
import { db, schema } from '../db/index.js'
import type { AuthVariables } from '../middleware/auth.js'
import { forbidden, notFound } from '../utils/response.js'

type AppContext = Context<{ Variables: AuthVariables }>

export function currentUserId(c: AppContext): number | null {
  return c.get('userId') ?? null
}

/** SaaS：校验项目归属；独立版直接放行。返回 Response 表示拒绝，null 表示通过。 */
export async function denyUnlessDramaOwner(c: AppContext, dramaId: number) {
  if (!isSaas()) return null
  const userId = currentUserId(c)
  if (!userId) return forbidden(c, '请先登录')
  const [drama] = await db.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId))
  if (!drama || drama.deletedAt) return notFound(c, '剧本不存在')
  if (drama.userId != null && drama.userId !== userId && c.get('role') !== 'admin') {
    return forbidden(c, '无权访问该项目')
  }
  // 无主项目仅 admin 可访问
  if (drama.userId == null && c.get('role') !== 'admin') {
    return forbidden(c, '无权访问该项目')
  }
  return null
}

export async function denyUnlessEpisodeOwner(c: AppContext, episodeId: number) {
  const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeId))
  if (!ep || ep.deletedAt) return notFound(c, '剧集不存在')
  return denyUnlessDramaOwner(c, ep.dramaId)
}

export async function denyUnlessCharacterOwner(c: AppContext, characterId: number) {
  const [row] = await db.select().from(schema.characters).where(eq(schema.characters.id, characterId))
  if (!row || row.deletedAt) return notFound(c, '角色不存在')
  return denyUnlessDramaOwner(c, row.dramaId)
}

export async function denyUnlessSceneOwner(c: AppContext, sceneId: number) {
  const [row] = await db.select().from(schema.scenes).where(eq(schema.scenes.id, sceneId))
  if (!row || row.deletedAt) return notFound(c, '场景不存在')
  return denyUnlessDramaOwner(c, row.dramaId)
}

export async function denyUnlessPropOwner(c: AppContext, propId: number) {
  const [row] = await db.select().from(schema.props).where(eq(schema.props.id, propId))
  if (!row || row.deletedAt) return notFound(c, '道具不存在')
  return denyUnlessDramaOwner(c, row.dramaId)
}

export async function denyUnlessStoryboardOwner(c: AppContext, storyboardId: number) {
  const [sb] = await db.select().from(schema.storyboards).where(eq(schema.storyboards.id, storyboardId))
  if (!sb || sb.deletedAt) return notFound(c, '分镜不存在')
  return denyUnlessEpisodeOwner(c, sb.episodeId)
}

export async function denyUnlessAiConfigOwner(c: AppContext, configId: number) {
  if (!isSaas()) return null
  const userId = currentUserId(c)
  if (!userId) return forbidden(c, '请先登录')
  const [row] = await db.select().from(schema.aiServiceConfigs).where(eq(schema.aiServiceConfigs.id, configId))
  if (!row) return notFound(c, '配置不存在')
  if (row.userId != null && row.userId !== userId && c.get('role') !== 'admin') {
    return forbidden(c, '无权操作该配置')
  }
  if (row.userId == null && c.get('role') !== 'admin') {
    return forbidden(c, '无权操作该配置')
  }
  return null
}

/**
 * 列表过滤：独立版看全部未删；SaaS 默认只看自己的。
 * 全站项目列表请用 /admin/dramas，不要在启动台对 admin 放开。
 */
export function dramaOwnerFilter(userId: number | null, role?: string | null) {
  if (!isSaas()) return isNull(schema.dramas.deletedAt)
  if (role === 'admin') return isNull(schema.dramas.deletedAt)
  if (!userId) return and(isNull(schema.dramas.deletedAt), eq(schema.dramas.id, -1))
  return and(isNull(schema.dramas.deletedAt), eq(schema.dramas.userId, userId))
}
