import fs from 'fs'
import { Hono } from 'hono'
import type { AuthVariables } from '../middleware/auth.js'
import { denyUnlessEpisodeOwner } from '../services/access.js'
import { and, eq, isNull, desc } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { success, badRequest, notFound, now } from '../utils/response.js'
import { mergeEpisodeVideos } from '../services/ffmpeg-merge.js'
import { toSnakeCase } from '../utils/transform.js'
import { logTaskError, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'
import { getAbsolutePath } from '../utils/storage.js'
import { posterPathFor } from '../utils/video-poster.js'

const app = new Hono<{ Variables: AuthVariables }>()

function safeUnlink(relativePath?: string | null) {
  if (!relativePath) return
  try {
    const abs = getAbsolutePath(relativePath)
    if (fs.existsSync(abs)) fs.unlinkSync(abs)
  } catch { /* 静默：文件可能已被清理 */ }
}

// POST /episodes/:id/merge — 拼接镜头视频(body.storyboard_ids 可选,只拼所选)
app.post('/episodes/:id/merge', async (c) => {
  const episodeId = Number(c.req.param('id'))
  const denied = await denyUnlessEpisodeOwner(c, episodeId)
  if (denied) return denied
  const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeId))
  if (!ep) return badRequest(c, '剧集不存在')

  let storyboardIds: number[] | undefined
  try {
    const body = await c.req.json()
    if (Array.isArray(body?.storyboard_ids)) {
      storyboardIds = body.storyboard_ids.map(Number).filter(Boolean)
    }
  } catch { /* 无 body 时拼接全部 */ }

  try {
    logTaskStart('MergeAPI', 'episode-merge', { episodeId, dramaId: ep.dramaId, storyboardIds })
    const mergeId = await mergeEpisodeVideos(episodeId, ep.dramaId, storyboardIds)
    logTaskSuccess('MergeAPI', 'episode-merge', { episodeId, mergeId })
    return success(c, { merge_id: mergeId, status: 'processing' })
  } catch (err: any) {
    logTaskError('MergeAPI', 'episode-merge', { episodeId, error: err.message })
    return badRequest(c, err.message)
  }
})

// GET /episodes/:id/merge — 查询最新拼接状态
app.get('/episodes/:id/merge', async (c) => {
  const episodeId = Number(c.req.param('id'))
  const denied = await denyUnlessEpisodeOwner(c, episodeId)
  if (denied) return denied
  const merges = await db.select().from(schema.videoMerges)
    .where(and(eq(schema.videoMerges.episodeId, episodeId), isNull(schema.videoMerges.deletedAt)))
  merges.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
  const latest = merges[0]
  if (!latest) return success(c, null)

  return success(c, toSnakeCase(latest))
})

// GET /episodes/:id/merges — 成片列表(全部拼接记录,新的在前)
app.get('/episodes/:id/merges', async (c) => {
  const episodeId = Number(c.req.param('id'))
  const denied = await denyUnlessEpisodeOwner(c, episodeId)
  if (denied) return denied
  const merges = await db.select().from(schema.videoMerges)
    .where(and(eq(schema.videoMerges.episodeId, episodeId), isNull(schema.videoMerges.deletedAt)))
  merges.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
  return success(c, merges.slice(0, 30).map(toSnakeCase))
})

// DELETE /episodes/:id/merges/:mergeId — 删除成片（软删 + 清理本地文件）
app.delete('/episodes/:id/merges/:mergeId', async (c) => {
  const episodeId = Number(c.req.param('id'))
  const mergeId = Number(c.req.param('mergeId'))
  const denied = await denyUnlessEpisodeOwner(c, episodeId)
  if (denied) return denied

  const [merge] = await db.select().from(schema.videoMerges)
    .where(and(
      eq(schema.videoMerges.id, mergeId),
      eq(schema.videoMerges.episodeId, episodeId),
      isNull(schema.videoMerges.deletedAt),
    ))
  if (!merge) return notFound(c, '成片不存在或已删除')

  const ts = now()
  await db.update(schema.videoMerges)
    .set({ deletedAt: ts })
    .where(eq(schema.videoMerges.id, mergeId))

  // 清理成片与海报帧文件
  if (merge.mergedUrl) {
    safeUnlink(merge.mergedUrl)
    try { safeUnlink(posterPathFor(merge.mergedUrl)) } catch { /* ignore */ }
  }

  // 若本集 video_url 指向该成片，回退到仍有效的最新成片，否则清空
  const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeId))
  if (ep?.videoUrl && merge.mergedUrl && ep.videoUrl === merge.mergedUrl) {
    const [latest] = await db.select().from(schema.videoMerges)
      .where(and(
        eq(schema.videoMerges.episodeId, episodeId),
        isNull(schema.videoMerges.deletedAt),
        eq(schema.videoMerges.status, 'completed'),
      ))
      .orderBy(desc(schema.videoMerges.createdAt))
      .limit(1)
    await db.update(schema.episodes)
      .set({ videoUrl: latest?.mergedUrl || null, updatedAt: ts })
      .where(eq(schema.episodes.id, episodeId))
  }

  return success(c, { id: mergeId, deleted: true })
})

export default app
