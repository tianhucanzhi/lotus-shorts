import { Hono } from 'hono'
import { and, eq, isNull } from 'drizzle-orm'
import { isSaas } from '../config/mode.js'
import { db, getInsertId, schema } from '../db/index.js'
import type { AuthVariables } from '../middleware/auth.js'
import { currentUserId } from '../services/access.js'
import {
  ensurePersonalStylePresets,
  findPersonalStylePresetByValue,
  listVisibleStylePresets,
} from '../services/style-preset.js'
import { success, created, badRequest, notFound, forbidden, now } from '../utils/response.js'
import { toSnakeCase } from '../utils/transform.js'

const app = new Hono<{ Variables: AuthVariables }>()

const VALUE_PATTERN = /^[a-z0-9][a-z0-9-]*$/

function sortPresets<T extends { sortOrder?: number | null; id: number }>(rows: T[]) {
  return [...rows].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || a.id - b.id)
}

async function valueExistsInScope(value: string, userId: number | null) {
  const [dup] = await db.select({ id: schema.stylePresets.id }).from(schema.stylePresets)
    .where(userId == null
      ? and(isNull(schema.stylePresets.userId), eq(schema.stylePresets.value, value))
      : and(eq(schema.stylePresets.userId, userId), eq(schema.stylePresets.value, value)))
  return !!dup
}

// GET /style-presets — 默认只返回启用项，?all=1 返回全部
app.get('/', async (c) => {
  const all = c.req.query('all') === '1'
  const userId = currentUserId(c)
  const rows = await listVisibleStylePresets(userId)
  const filtered = all ? rows : rows.filter(r => r.isActive)
  return success(c, sortPresets(filtered).map(r => toSnakeCase(r)))
})

// POST /style-presets — 新增风格预设（SaaS：首次写入会先 fork 全局副本）
app.post('/', async (c) => {
  const body = await c.req.json()
  if (!body.name?.trim()) return badRequest(c, '风格名称必填')
  if (!body.value?.trim()) return badRequest(c, '风格 key 必填')
  if (!VALUE_PATTERN.test(body.value.trim())) return badRequest(c, '风格 key 仅支持小写字母、数字、中划线')
  if (!body.prompt?.trim()) return badRequest(c, '提示词片段必填')

  const value = body.value.trim()
  const userId = currentUserId(c)
  if (isSaas()) {
    if (!userId) return forbidden(c, '请先登录')
    await ensurePersonalStylePresets(userId)
  }
  const scopeUserId = isSaas() ? userId : null
  if (await valueExistsInScope(value, scopeUserId)) return badRequest(c, '风格 key 已存在')

  const ts = now()
  const res = await db.insert(schema.stylePresets).values({
    userId: scopeUserId,
    name: body.name.trim(),
    value,
    prompt: body.prompt.trim(),
    description: body.description || null,
    sortOrder: Number(body.sort_order ?? body.sortOrder ?? 0),
    isActive: body.is_active === false || body.is_active === 0 ? false : true,
    createdAt: ts,
    updatedAt: ts,
  })
  const [row] = await db.select().from(schema.stylePresets)
    .where(eq(schema.stylePresets.id, getInsertId(res)))
  return created(c, toSnakeCase(row))
})

// PUT /style-presets/:id — 更新（value 创建后不可修改）
app.put('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json()
  const [row] = await db.select().from(schema.stylePresets)
    .where(eq(schema.stylePresets.id, id))
  if (!row) return notFound(c, '风格预设不存在')

  const userId = currentUserId(c)
  let targetId = id

  if (isSaas()) {
    if (!userId) return forbidden(c, '请先登录')
    // 改全局行：先 fork，再改个人副本中同 value 的行
    if (row.userId == null) {
      await ensurePersonalStylePresets(userId)
      const personal = await findPersonalStylePresetByValue(userId, row.value)
      if (!personal) return notFound(c, '风格预设不存在')
      targetId = personal.id
    } else if (row.userId !== userId) {
      return forbidden(c, '无权修改该风格预设')
    }
  } else if (row.userId != null) {
    return notFound(c, '风格预设不存在')
  }

  const updates: Record<string, any> = { updatedAt: now() }
  if (body.name !== undefined) updates.name = String(body.name).trim()
  if (body.prompt !== undefined) updates.prompt = String(body.prompt).trim()
  if (body.description !== undefined) updates.description = body.description || null
  if (body.sort_order !== undefined || body.sortOrder !== undefined) {
    updates.sortOrder = Number(body.sort_order ?? body.sortOrder)
  }
  if (body.is_active !== undefined || body.isActive !== undefined) {
    const v = body.is_active ?? body.isActive
    updates.isActive = !(v === false || v === 0)
  }
  await db.update(schema.stylePresets).set(updates)
    .where(eq(schema.stylePresets.id, targetId))
  return success(c)
})

// DELETE /style-presets/:id — 硬删除（已使用此风格的项目保留 key，无害）
app.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const [row] = await db.select().from(schema.stylePresets)
    .where(eq(schema.stylePresets.id, id))
  if (!row) return notFound(c, '风格预设不存在')

  const userId = currentUserId(c)
  let targetId = id

  if (isSaas()) {
    if (!userId) return forbidden(c, '请先登录')
    if (row.userId == null) {
      await ensurePersonalStylePresets(userId)
      const personal = await findPersonalStylePresetByValue(userId, row.value)
      if (!personal) return notFound(c, '风格预设不存在')
      targetId = personal.id
    } else if (row.userId !== userId) {
      return forbidden(c, '无权删除该风格预设')
    }
  } else if (row.userId != null) {
    return notFound(c, '风格预设不存在')
  }

  await db.delete(schema.stylePresets).where(eq(schema.stylePresets.id, targetId))
  return success(c)
})

export default app
