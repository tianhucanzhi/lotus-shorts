import { Hono } from 'hono'
import { and, eq, isNull, desc } from 'drizzle-orm'
import { isSaas } from '../config/mode.js'
import { db, getInsertId, schema } from '../db/index.js'
import type { AuthVariables } from '../middleware/auth.js'
import { currentUserId, denyUnlessDramaOwner, dramaOwnerFilter } from '../services/access.js'
import { ensureSampleDramaForUser, isSampleDrama, parseDramaMeta } from '../services/sample-drama.js'
import { success, badRequest, notFound, created, now } from '../utils/response.js'
import { toSnakeCase, toSnakeCaseArray } from '../utils/transform.js'
import { generateImage } from '../services/generation.js'
import { getStylePromptByValue } from '../services/style-preset.js'

const app = new Hono<{ Variables: AuthVariables }>()

function coverSizeForAspect(aspectRatio?: string | null): string {
  const r = String(aspectRatio || '16:9').trim()
  if (r === '9:16') return '1080x1920'
  if (r === '1:1') return '1024x1024'
  return '1920x1080'
}

// GET /dramas - List dramas
app.get('/', async (c) => {
  const page = Number(c.req.query('page') || 1)
  const pageSize = Number(c.req.query('page_size') || 20)
  const status = c.req.query('status')
  const keyword = c.req.query('keyword')
  const userId = currentUserId(c)
  // 项目启动台始终只看自己的项目；全站列表走 /admin/dramas，避免管理员看到每个用户的示例副本
  const role = 'user'

  // 存量账号懒预置示例项目（用户删除后不会重复下发）
  if (isSaas() && userId) await ensureSampleDramaForUser(userId)

  const allRows = await db.select().from(schema.dramas)
    .where(dramaOwnerFilter(userId, role))
    .orderBy(desc(schema.dramas.updatedAt))
  let filtered = allRows

  if (status) filtered = filtered.filter(d => d.status === status)
  if (keyword) filtered = filtered.filter(d => d.title.includes(keyword))

  const total = filtered.length
  const items = filtered.slice((page - 1) * pageSize, page * pageSize)

  // Attach episode/character/scene counts
  const enriched = await Promise.all(items.map(async (drama) => {
    const eps = await db.select().from(schema.episodes)
      .where(and(eq(schema.episodes.dramaId, drama.id), isNull(schema.episodes.deletedAt)))
    const chars = await db.select().from(schema.characters)
      .where(eq(schema.characters.dramaId, drama.id))
    const scns = await db.select().from(schema.scenes)
      .where(eq(schema.scenes.dramaId, drama.id))
    const meta = parseDramaMeta(drama.metadata)
    return {
      ...toSnakeCase(drama),
      tags: drama.tags ? JSON.parse(drama.tags) : [],
      metadata: meta,
      is_sample: isSampleDrama(meta),
      total_episodes: eps.length,
      episodes: toSnakeCaseArray(eps),
      characters: toSnakeCaseArray(chars),
      scenes: toSnakeCaseArray(scns),
    }
  }))

  return success(c, {
    items: enriched,
    pagination: { page, page_size: pageSize, total, total_pages: Math.ceil(total / pageSize) },
  })
})

// POST /dramas - Create drama
app.post('/', async (c) => {
  const body = await c.req.json()
  const ts = now()
  const userId = currentUserId(c)
  const res = await db.insert(schema.dramas).values({
    userId: isSaas() ? userId : null,
    title: body.title,
    description: body.description || null,
    genre: body.genre,
    style: body.style,
    aspectRatio: body.aspect_ratio || '16:9',
    thumbnail: body.thumbnail || null,
    tags: body.tags ? JSON.stringify(body.tags) : null,
    metadata: body.metadata,
    status: 'draft',
    createdAt: ts,
    updatedAt: ts,
  })

  const [result] = await db.select().from(schema.dramas)
    .where(eq(schema.dramas.id, getInsertId(res)))

  // 不再预建集 — 用户通过「添加集」流程创建（该流程会锁定图片/视频生成配置）
  return created(c, toSnakeCase(result))
})

// POST /dramas/generate-cover — AI 生成项目封面（异步任务，前端轮询 /tasks/:id）
app.post('/generate-cover', async (c) => {
  const body = await c.req.json()
  const title = String(body.title || '').trim()
  if (!title) return badRequest(c, '请先填写项目名称，再生成封面')

  const description = String(body.description || '').trim()
  const stylePrompt = await getStylePromptByValue(body.style)
  const size = coverSizeForAspect(body.aspect_ratio)
  const promptParts = [
    stylePrompt,
    `cinematic key-art movie poster cover for a short drama titled "${title}"`,
    description ? `story synopsis: ${description}` : '',
    'dramatic composition, polished poster quality, title-safe framing, high detail, no watermark, avoid messy unreadable text overlays',
  ].filter(Boolean)

  try {
    const taskId = await generateImage({
      prompt: promptParts.join(', '),
      size,
      dramaId: body.drama_id ? Number(body.drama_id) : undefined,
      model: body.model,
      configId: body.config_id,
    })
    return created(c, { task_id: taskId })
  } catch (err: any) {
    return badRequest(c, err.message || '封面生成失败')
  }
})

// GET /dramas/stats — must be before /:id
app.get('/stats', async (c) => {
  const userId = currentUserId(c)
  const all = await db.select().from(schema.dramas).where(dramaOwnerFilter(userId, 'user'))
  const byStatus = Object.entries(
    all.reduce((acc, d) => {
      acc[d.status || 'draft'] = (acc[d.status || 'draft'] || 0) + 1
      return acc
    }, {} as Record<string, number>)
  ).map(([status, count]) => ({ status, count }))
  return success(c, { total: all.length, by_status: byStatus })
})

// GET /dramas/:id - Get drama detail
app.get('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const denied = await denyUnlessDramaOwner(c, id)
  if (denied) return denied
  const [drama] = await db.select().from(schema.dramas).where(eq(schema.dramas.id, id))
  if (!drama) return notFound(c, '剧本不存在')

  const eps = await db.select().from(schema.episodes)
    .where(and(eq(schema.episodes.dramaId, id), isNull(schema.episodes.deletedAt)))
  const chars = await db.select().from(schema.characters)
    .where(eq(schema.characters.dramaId, id))
  const scns = await db.select().from(schema.scenes)
    .where(eq(schema.scenes.dramaId, id))
  const prps = await db.select().from(schema.props)
    .where(eq(schema.props.dramaId, id))

  const meta = parseDramaMeta(drama.metadata)
  return success(c, {
    ...toSnakeCase(drama),
    tags: drama.tags ? JSON.parse(drama.tags) : [],
    metadata: meta,
    is_sample: isSampleDrama(meta),
    episodes: toSnakeCaseArray(eps),
    characters: toSnakeCaseArray(chars),
    scenes: toSnakeCaseArray(scns),
    props: toSnakeCaseArray(prps),
  })
})

// PUT /dramas/:id - Update drama
app.put('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const denied = await denyUnlessDramaOwner(c, id)
  if (denied) return denied
  const body = await c.req.json()
  const updates: Record<string, any> = { updatedAt: now() }
  if (body.title !== undefined) updates.title = body.title
  if (body.description !== undefined) updates.description = body.description
  if (body.genre !== undefined) updates.genre = body.genre
  if (body.style !== undefined) updates.style = body.style
  if (body.aspect_ratio !== undefined) updates.aspectRatio = body.aspect_ratio
  if (body.thumbnail !== undefined) updates.thumbnail = body.thumbnail
  if (body.status !== undefined) updates.status = body.status
  if (body.tags !== undefined) updates.tags = JSON.stringify(body.tags)
  if (body.metadata !== undefined) updates.metadata = body.metadata
  await db.update(schema.dramas).set(updates).where(eq(schema.dramas.id, id))
  return success(c)
})

// DELETE /dramas/:id - Soft delete
app.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const denied = await denyUnlessDramaOwner(c, id)
  if (denied) return denied
  await db.update(schema.dramas).set({ deletedAt: now() }).where(eq(schema.dramas.id, id))
  return success(c)
})

// PUT /dramas/:id/characters - Save characters
app.put('/:id/characters', async (c) => {
  const dramaId = Number(c.req.param('id'))
  const denied = await denyUnlessDramaOwner(c, dramaId)
  if (denied) return denied
  const body = await c.req.json()
  const chars = body.characters || []
  const ts = now()

  for (const char of chars) {
    if (char.id) {
      await db.update(schema.characters).set({ ...char, updatedAt: ts }).where(eq(schema.characters.id, char.id))
    } else {
      await db.insert(schema.characters).values({ ...char, dramaId, createdAt: ts, updatedAt: ts })
    }
  }
  return success(c)
})

// PUT /dramas/:id/episodes - Save episodes
app.put('/:id/episodes', async (c) => {
  const dramaId = Number(c.req.param('id'))
  const denied = await denyUnlessDramaOwner(c, dramaId)
  if (denied) return denied
  const body = await c.req.json()
  const episodes = body.episodes || []
  const ts = now()

  for (const ep of episodes) {
    if (ep.id) {
      await db.update(schema.episodes).set({ ...ep, updatedAt: ts }).where(eq(schema.episodes.id, ep.id))
    } else {
      await db.insert(schema.episodes).values({
        ...ep,
        dramaId,
        episodeNumber: ep.episode_number || ep.episodeNumber || 1,
        title: ep.title || '未命名',
        createdAt: ts,
        updatedAt: ts,
      })
    }
  }
  return success(c)
})

export default app
