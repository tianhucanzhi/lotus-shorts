import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { sign, verify } from 'hono/jwt'
import { db, getInsertId, schema } from '../db/index.js'
import { isSaas, jwtExpiresIn, jwtSecret } from '../config/mode.js'
import { now } from '../utils/response.js'

const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEYLEN = 64

export type AuthUser = {
  id: number
  username: string
  email: string | null
  displayName: string | null
  role: string
  status: string
}

export type JwtPayload = {
  sub: number
  username: string
  role: string
  exp: number
  iat: number
}

function hashPassword(password: string, salt?: Buffer): string {
  const s = salt || randomBytes(16)
  const hash = scryptSync(password, s, KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P })
  return `scrypt$${s.toString('hex')}$${hash.toString('hex')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$')
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false
  const salt = Buffer.from(parts[1], 'hex')
  const expected = Buffer.from(parts[2], 'hex')
  const actual = scryptSync(password, salt, expected.length, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P })
  if (actual.length !== expected.length) return false
  return timingSafeEqual(actual, expected)
}

function toAuthUser(row: typeof schema.users.$inferSelect): AuthUser {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    displayName: row.displayName,
    role: row.role || 'user',
    status: row.status || 'active',
  }
}

export async function findUserByUsername(username: string) {
  const [row] = await db.select().from(schema.users).where(eq(schema.users.username, username))
  return row || null
}

export async function findUserById(id: number) {
  const [row] = await db.select().from(schema.users).where(eq(schema.users.id, id))
  return row || null
}

export async function countUsers(): Promise<number> {
  const rows = await db.select({ id: schema.users.id }).from(schema.users)
  return rows.length
}

/** 注册：首个用户自动成为 admin，并认领无主数据（user_id 为空的 dramas / AI 配置） */
export async function registerUser(input: {
  username: string
  password: string
  email?: string | null
  displayName?: string | null
}): Promise<AuthUser> {
  const username = String(input.username || '').trim()
  const password = String(input.password || '')
  if (!/^[a-zA-Z0-9_\u4e00-\u9fa5-]{2,32}$/.test(username)) {
    throw new Error('用户名需为 2–32 位字母/数字/下划线/中文')
  }
  if (password.length < 6) throw new Error('密码至少 6 位')
  if (await findUserByUsername(username)) throw new Error('用户名已存在')

  const isFirst = (await countUsers()) === 0
  const ts = now()
  const res = await db.insert(schema.users).values({
    username,
    email: input.email?.trim() || null,
    passwordHash: hashPassword(password),
    displayName: input.displayName?.trim() || username,
    role: isFirst ? 'admin' : 'user',
    status: 'active',
    createdAt: ts,
    updatedAt: ts,
  })
  const userId = getInsertId(res)

  if (isFirst && isSaas()) {
    // 认领历史无主数据，便于独立版切 SaaS 后不丢项目
    await db.update(schema.dramas).set({ userId }).where(isNull(schema.dramas.userId))
    await db.update(schema.aiServiceConfigs).set({ userId }).where(isNull(schema.aiServiceConfigs.userId))
  }

  const row = await findUserById(userId)
  if (!row) throw new Error('注册失败')
  return toAuthUser(row)
}

export async function loginUser(username: string, password: string): Promise<AuthUser> {
  const row = await findUserByUsername(String(username || '').trim())
  if (!row || row.status !== 'active') throw new Error('用户名或密码错误')
  if (!verifyPassword(password, row.passwordHash)) throw new Error('用户名或密码错误')
  return toAuthUser(row)
}

export async function signToken(user: AuthUser): Promise<string> {
  const iat = Math.floor(Date.now() / 1000)
  const payload: JwtPayload = {
    sub: user.id,
    username: user.username,
    role: user.role,
    iat,
    exp: iat + jwtExpiresIn(),
  }
  return sign(payload, jwtSecret(), 'HS256')
}

export async function verifyToken(token: string): Promise<JwtPayload | null> {
  try {
    const payload = await verify(token, jwtSecret(), 'HS256') as JwtPayload
    if (!payload?.sub) return null
    return payload
  } catch {
    return null
  }
}

/** 设置项按用户隔离时的 key 前缀（独立版不加前缀，保持兼容） */
export function settingsKeyForUser(baseKey: string, userId: number | null): string {
  if (!isSaas() || !userId) return baseKey
  return `u:${userId}:${baseKey}`
}

export function fingerprintSecret(): string {
  return createHash('sha256').update(jwtSecret()).digest('hex').slice(0, 12)
}

export type PublicUser = {
  id: number
  username: string
  email: string | null
  display_name: string | null
  role: string
  status: string
  created_at: string
  updated_at: string
}

export function toPublicUser(row: typeof schema.users.$inferSelect): PublicUser {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    display_name: row.displayName,
    role: row.role || 'user',
    status: row.status || 'active',
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  }
}

function assertUsername(username: string) {
  if (!/^[a-zA-Z0-9_\u4e00-\u9fa5-]{2,32}$/.test(username)) {
    throw new Error('用户名需为 2–32 位字母、数字、下划线或中文')
  }
}

const DEFAULT_ADMIN_USERNAME = 'admin'
const DEFAULT_ADMIN_PASSWORD = 'admin1234'

/** 没有 admin 用户时写入默认管理员。已存在则不改密码。 */
export async function ensureDefaultAdmin(): Promise<void> {
  if (await findUserByUsername(DEFAULT_ADMIN_USERNAME)) return
  const isFirst = (await countUsers()) === 0
  const ts = now()
  const res = await db.insert(schema.users).values({
    username: DEFAULT_ADMIN_USERNAME,
    email: null,
    passwordHash: hashPassword(DEFAULT_ADMIN_PASSWORD),
    displayName: '管理员',
    role: 'admin',
    status: 'active',
    createdAt: ts,
    updatedAt: ts,
  })
  const userId = getInsertId(res)
  if (isFirst && isSaas()) {
    await db.update(schema.dramas).set({ userId }).where(isNull(schema.dramas.userId))
    await db.update(schema.aiServiceConfigs).set({ userId }).where(isNull(schema.aiServiceConfigs.userId))
  }
  console.log(`[auth] 已创建默认管理员 ${DEFAULT_ADMIN_USERNAME}`)
}

/** 管理员开户：不走「首个用户认领数据」逻辑 */
export async function adminCreateUser(input: {
  username: string
  password: string
  displayName?: string | null
  role?: string
}): Promise<PublicUser> {
  const username = String(input.username || '').trim()
  const password = String(input.password || '')
  const role = input.role === 'admin' ? 'admin' : 'user'
  assertUsername(username)
  if (password.length < 6) throw new Error('密码至少 6 位')
  if (await findUserByUsername(username)) throw new Error('用户名已存在')
  const ts = now()
  const res = await db.insert(schema.users).values({
    username,
    email: null,
    passwordHash: hashPassword(password),
    displayName: input.displayName?.trim() || username,
    role,
    status: 'active',
    createdAt: ts,
    updatedAt: ts,
  })
  const row = await findUserById(getInsertId(res))
  if (!row) throw new Error('创建失败')
  return toPublicUser(row)
}

/** 改角色、停用或重置密码。不能停用自己，也不能去掉最后一名可用管理员。 */
export async function adminPatchUser(actorId: number, targetId: number, patch: {
  role?: string
  status?: string
  displayName?: string | null
  password?: string
}): Promise<PublicUser> {
  const target = await findUserById(targetId)
  if (!target) throw new Error('用户不存在')

  const nextRole = patch.role === undefined ? target.role : (patch.role === 'admin' ? 'admin' : 'user')
  const nextStatus = patch.status === undefined
    ? target.status
    : (patch.status === 'disabled' ? 'disabled' : 'active')

  if (actorId === targetId && nextStatus !== 'active') throw new Error('不能停用自己的账号')
  if (actorId === targetId && nextRole !== 'admin') throw new Error('不能取消自己的管理员权限')

  const losingAdmin = target.role === 'admin' && target.status === 'active'
    && (nextRole !== 'admin' || nextStatus !== 'active')
  if (losingAdmin) {
    const admins = await db.select({ id: schema.users.id }).from(schema.users)
      .where(and(eq(schema.users.role, 'admin'), eq(schema.users.status, 'active')))
    if (admins.filter(a => a.id !== target.id).length === 0) {
      throw new Error('至少保留一名可用的管理员')
    }
  }

  const updates: Partial<typeof schema.users.$inferInsert> = { updatedAt: now() }
  if (patch.role !== undefined) updates.role = nextRole
  if (patch.status !== undefined) updates.status = nextStatus
  if (patch.displayName !== undefined) {
    updates.displayName = String(patch.displayName || '').trim() || target.username
  }
  if (patch.password !== undefined && patch.password !== '') {
    if (String(patch.password).length < 6) throw new Error('密码至少 6 位')
    updates.passwordHash = hashPassword(String(patch.password))
  }

  await db.update(schema.users).set(updates).where(eq(schema.users.id, targetId))
  const row = await findUserById(targetId)
  if (!row) throw new Error('用户不存在')
  return toPublicUser(row)
}
