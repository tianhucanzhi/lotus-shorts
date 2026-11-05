import { Hono } from 'hono'
import { isSaas } from '../config/mode.js'
import type { AuthVariables } from '../middleware/auth.js'
import { adminCreateUser, adminPatchUser } from '../services/auth.js'
import { adminListDramas, adminListTasks, adminListUsers, adminOverview } from '../services/admin.js'
import { badRequest, forbidden, success } from '../utils/response.js'

const app = new Hono<{ Variables: AuthVariables }>()

app.use('*', async (c, next) => {
  if (!isSaas()) return next()
  if (c.get('userId') && c.get('role') === 'admin') return next()
  return forbidden(c, '需要管理员权限')
})

app.get('/overview', async (c) => success(c, await adminOverview()))

app.get('/users', async (c) => {
  if (!isSaas()) return badRequest(c, '独立版没有用户账号')
  return success(c, { items: await adminListUsers(c.req.query('q')) })
})

app.post('/users', async (c) => {
  if (!isSaas()) return badRequest(c, '独立版没有用户账号')
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
  if (!isSaas()) return badRequest(c, '独立版没有用户账号')
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

app.get('/dramas', async (c) => success(c, { items: await adminListDramas(c.req.query('q')) }))

app.get('/tasks', async (c) => success(c, { items: await adminListTasks(c.req.query('status')) }))

export default app
