import { Hono } from 'hono'
import { allowRegister, isSaas } from '../config/mode.js'
import { authModePayload, type AuthVariables } from '../middleware/auth.js'
import {
  findUserById,
  loginUser,
  registerUser,
  signToken,
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
    return success(c, { token, user })
  } catch (err: any) {
    return badRequest(c, err.message || '注册失败')
  }
})

app.post('/login', async (c) => {
  if (!isSaas()) return badRequest(c, '当前为独立版，无需登录')
  const body = await c.req.json().catch(() => ({}))
  try {
    const user = await loginUser(body.username, body.password)
    const token = await signToken(user)
    return success(c, { token, user })
  } catch (err: any) {
    return unauthorized(c, err.message || '登录失败')
  }
})

app.get('/me', async (c) => {
  if (!isSaas()) {
    return success(c, { mode: 'standalone', user: null })
  }
  const userId = c.get('userId')
  if (!userId) return unauthorized(c, '请先登录')
  const row = await findUserById(userId)
  if (!row || row.status !== 'active') return unauthorized(c, '用户不可用')
  return success(c, {
    mode: 'saas',
    user: {
      id: row.id,
      username: row.username,
      email: row.email,
      display_name: row.displayName,
      role: row.role,
      status: row.status,
    },
  })
})

export default app
