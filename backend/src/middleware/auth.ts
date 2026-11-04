import type { MiddlewareHandler } from 'hono'
import { allowRegister, APP_MODE, isSaas } from '../config/mode.js'
import { findUserById, verifyToken } from '../services/auth.js'
import { runWithRequestContext } from '../services/request-context.js'
import { unauthorized } from '../utils/response.js'

export type AuthVariables = {
  userId: number | null
  username: string | null
  role: string | null
}

const PUBLIC_PATHS = new Set([
  '/api/v1/health',
  '/api/v1/auth/mode',
  '/api/v1/auth/login',
  '/api/v1/auth/register',
])

function isPublicPath(path: string): boolean {
  if (PUBLIC_PATHS.has(path)) return true
  // 静态资源不走鉴权
  if (path.startsWith('/static/')) return true
  return false
}

/** 解析 Bearer Token，写入 Hono context + AsyncLocalStorage（供 AI 配置等服务层读当前用户） */
export const authContext: MiddlewareHandler<{ Variables: AuthVariables }> = async (c, next) => {
  let userId: number | null = null
  let username: string | null = null
  let role: string | null = null

  const header = c.req.header('Authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (token) {
    const payload = await verifyToken(token)
    if (payload?.sub) {
      const user = await findUserById(Number(payload.sub))
      if (user && user.status === 'active') {
        userId = user.id
        username = user.username
        role = user.role || 'user'
      }
    }
  }

  c.set('userId', userId)
  c.set('username', username)
  c.set('role', role)

  await runWithRequestContext({ userId, username, role }, () => next())
}

/** SaaS 模式下除公开接口外必须登录 */
export const requireAuthIfSaas: MiddlewareHandler<{ Variables: AuthVariables }> = async (c, next) => {
  if (!isSaas()) return next()
  const path = new URL(c.req.url).pathname
  if (isPublicPath(path)) return next()
  if (c.get('userId')) return next()
  return unauthorized(c, '请先登录')
}

export function authModePayload() {
  return {
    mode: APP_MODE,
    saas: isSaas(),
    allow_register: allowRegister(),
  }
}
