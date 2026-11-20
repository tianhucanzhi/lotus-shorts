import { Hono } from 'hono'
import { allowRegister, APP_MODE, isSaas } from '../config/mode.js'
import { authModePayload, type AuthVariables } from '../middleware/auth.js'
import {
  findUserById,
  loginUser,
  registerUser,
  signToken,
  toPublicUser,
} from '../services/auth.js'
import { badRequest, success, unauthorized } from '../utils/response.js'

const app = new Hono<{ Variables: AuthVariables }>()

app.get('/mode', (c) => success(c, authModePayload()))

app.post('/register', async (c) => {
  if (!isSaas()) return badRequest(c, '当前为独立版，无需注册')
  if (!allowRegister()) return badRequest(c, '已关闭注册，请联系管理员')
  const body = await c.req.json().catch(() => ({}))
  try {
    const user = await registerUser({
      username: body.username,
      password: body.password,
      email: body.email,
      displayName: body.display_name || body.displayName,
    })
    const token = await signToken(user)
    const row = await findUserById(user.id)
    return success(c, { token, user: row ? toPublicUser(row) : { ...user, display_name: user.displayName } })
  } catch (err: any) {
    return badRequest(c, err.message || '注册失败')
  }
})

/** SaaS 与独立版均可登录（独立版主要用于 /admin） */
app.post('/login', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  try {
    const user = await loginUser(body.username, body.password)
    const token = await signToken(user)
    const row = await findUserById(user.id)
    return success(c, {
      token,
      user: row ? toPublicUser(row) : {
        id: user.id,
        username: user.username,
        email: user.email,
        display_name: user.displayName,
        role: user.role,
        status: user.status,
        admin_menus: [],
        is_super_admin: false,
      },
    })
  } catch (err: any) {
    return unauthorized(c, err.message || '登录失败')
  }
})

app.get('/me', async (c) => {
  const userId = c.get('userId')
  if (!userId) return unauthorized(c, '请先登录')
  const row = await findUserById(userId)
  if (!row || row.status !== 'active') return unauthorized(c, '用户不可用')
  return success(c, {
    mode: APP_MODE,
    user: toPublicUser(row),
  })
})

export default app
