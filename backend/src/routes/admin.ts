import { Hono } from 'hono'
import type { AuthVariables } from '../middleware/auth.js'
import { adminCreateUser, adminPatchUser } from '../services/auth.js'
import {
  adminCancelTask,
  adminCreateStyle,
  adminDeleteStyle,
  adminGetTask,
  adminListAiConfigs,
  adminListDramas,
  adminListStyles,
  adminListTasks,
  adminListUsers,
  adminOverview,
  adminRestoreDefaultStyles,
  adminSoftDeleteDrama,
  adminSystemInfo,
  adminTransferDrama,
  adminUpdateStyle,
} from '../services/admin.js'
import { badRequest, forbidden, success } from '../utils/response.js'

const app = new Hono<{ Variables: AuthVariables }>()

/** 管理后台一律要求管理员登录（独立版 / SaaS 相同） */
app.use('*', async (c, next) => {
  if (c.get('userId') && c.get('role') === 'admin') return next()
  return forbidden(c, '需要管理员权限')
})

app.get('/overview', async (c) => success(c, await adminOverview()))

app.get('/users', async (c) => success(c, { items: await adminListUsers(c.req.query('q')) }))

app.post('/users', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  try {
    const user = await adminCreateUser({
      username: body.username,
      password: body.password,
      displayName: body.display_name ?? body.displayName,
      role: body.role,
    })
    return success(c, user)
  } catch (err: any) {
    return badRequest(c, err?.message || '创建失败')
  }
})

app.put('/users/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const actorId = c.get('userId')
  if (!actorId || !Number.isFinite(id)) return badRequest(c, '参数错误')
  const body = await c.req.json().catch(() => ({}))
  try {
    const user = await adminPatchUser(actorId, id, {
      role: body.role,
      status: body.status,
      displayName: body.display_name ?? body.displayName,
      password: body.password,
    })
    return success(c, user)
  } catch (err: any) {
    return badRequest(c, err?.message || '更新失败')
  }
})

app.get('/dramas', async (c) => {
  return success(c, {
    items: await adminListDramas(c.req.query('q'), c.req.query('status')),
  })
})

app.delete('/dramas/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return badRequest(c, '参数错误')
  try {
    await adminSoftDeleteDrama(id)
    return success(c, { ok: true })
  } catch (err: any) {
    return badRequest(c, err?.message || '删除失败')
  }
})

app.put('/dramas/:id/owner', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return badRequest(c, '参数错误')
  const body = await c.req.json().catch(() => ({}))
  const raw = body.user_id ?? body.userId
  const userId = raw === null || raw === '' || raw === undefined ? null : Number(raw)
  if (userId != null && !Number.isFinite(userId)) return badRequest(c, '目标用户无效')
  try {
    await adminTransferDrama(id, userId)
    return success(c, { ok: true })
  } catch (err: any) {
    return badRequest(c, err?.message || '转让失败')
  }
})

app.get('/tasks', async (c) => {
  return success(c, {
    items: await adminListTasks({
      status: c.req.query('status'),
      type: c.req.query('type'),
      q: c.req.query('q'),
    }),
  })
})

app.get('/tasks/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return badRequest(c, '参数错误')
  try {
    return success(c, await adminGetTask(id))
  } catch (err: any) {
    return badRequest(c, err?.message || '任务不存在')
  }
})

app.post('/tasks/:id/cancel', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return badRequest(c, '参数错误')
  try {
    return success(c, await adminCancelTask(id))
  } catch (err: any) {
    return badRequest(c, err?.message || '取消失败')
  }
})

app.get('/styles', async (c) => success(c, { items: await adminListStyles() }))

app.post('/styles/restore-defaults', async (c) => {
  try {
    return success(c, await adminRestoreDefaultStyles())
  } catch (err: any) {
    return badRequest(c, err?.message || '还原失败')
  }
})

app.post('/styles', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  try {
    const item = await adminCreateStyle({
      name: body.name,
      value: body.value,
      prompt: body.prompt,
      description: body.description,
      sort_order: body.sort_order ?? body.sortOrder,
      is_active: body.is_active ?? body.isActive,
    })
    return success(c, item)
  } catch (err: any) {
    return badRequest(c, err?.message || '创建失败')
  }
})

app.put('/styles/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return badRequest(c, '参数错误')
  const body = await c.req.json().catch(() => ({}))
  try {
    const item = await adminUpdateStyle(id, {
      name: body.name,
      prompt: body.prompt,
      description: body.description,
      sort_order: body.sort_order ?? body.sortOrder,
      is_active: body.is_active ?? body.isActive,
    })
    return success(c, item)
  } catch (err: any) {
    return badRequest(c, err?.message || '更新失败')
  }
})

app.delete('/styles/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return badRequest(c, '参数错误')
  try {
    await adminDeleteStyle(id)
    return success(c, { ok: true })
  } catch (err: any) {
    return badRequest(c, err?.message || '删除失败')
  }
})

app.get('/ai-configs', async (c) => success(c, await adminListAiConfigs()))

app.get('/system', async (c) => success(c, await adminSystemInfo()))

export default app
