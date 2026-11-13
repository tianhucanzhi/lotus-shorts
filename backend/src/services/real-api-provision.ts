/**
 * Real-API 一键开户（调用 AI-Middle-Platform 开放接口 openRegisterByInvite）
 * Token 只留在后端，前端不可见。
 */
import { isSaas } from '../config/mode.js'

const DEFAULT_BASE = 'https://real-api.yunfm.cn'
/** 与 Real-API config.LOTUS_ACTIVATION_OPEN_TOKEN 一致；可用环境变量覆盖 */
const DEFAULT_OPEN_TOKEN = 'v1_lotus_act_8Km2NpQ9xR4wY7cH3dJ6sU1aV5zE0bF9qM2tX7nP4kY8'
const DEFAULT_INVITE = 'KU54EQ'
const DEFAULT_PASSWORD = '123456'

const USERNAME_RE = /^[a-zA-Z0-9_\u4e00-\u9fff]{3,32}$/

export type RealApiProvisionResult = {
  username: string
  password: string
  api_key: string
  site_url: string
  user_id?: number | null
  activation_code?: string | null
  user_invite_code?: string | null
  balance_usd?: number | null
}

function realApiBase(): string {
  return (process.env.REAL_API_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '')
}

function openToken(): string {
  return (process.env.REAL_API_OPEN_TOKEN || DEFAULT_OPEN_TOKEN).trim()
}

function inviteCode(): string {
  return (process.env.REAL_API_INVITE_CODE || DEFAULT_INVITE).trim().toUpperCase()
}

/** 把本系统用户名规范成 Real-API 允许的格式 */
export function sanitizeRealApiUsername(raw: string | null | undefined): string {
  let name = String(raw || '').trim()
    .replace(/-/g, '_')
    .replace(/[^\w\u4e00-\u9fff]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
  if (!name) name = 'lotus'
  if (name.length < 3) name = `${name}_u`.slice(0, 32)
  if (name.length > 32) name = name.slice(0, 32)
  if (!USERNAME_RE.test(name)) name = `lotus_${Date.now().toString(36).slice(-6)}`
  return name
}

function withSuffix(base: string, n: number): string {
  if (n <= 1) return base.slice(0, 32)
  const suffix = `_${n}`
  return base.slice(0, Math.max(1, 32 - suffix.length)) + suffix
}

async function callOpenRegister(username: string): Promise<{ ok: true; data: any } | { ok: false; msg: string }> {
  const url = `${realApiBase()}/api/lotus/activationCode/openRegisterByInvite`
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openToken()}`,
    },
    body: JSON.stringify({
      invite_code: inviteCode(),
      username,
      // Real-API 用户来源：后台 /admin/users 显示为「莲花短剧」
      source: 'lotus-shorts',
      remark: `lotus-shorts ${isSaas() ? 'saas' : 'standalone'} auto-register`,
    }),
  })
  const json = await resp.json().catch(() => null) as any
  if (!resp.ok) {
    return { ok: false, msg: json?.msg || `Real-API 开户失败 (${resp.status})` }
  }
  if (!json || json.code !== 1) {
    return { ok: false, msg: json?.msg || 'Real-API 开户失败' }
  }
  return { ok: true, data: json.data || {} }
}

/**
 * 用本系统用户名开户；重名则尝试 base_2 / base_3 …
 */
export async function provisionRealApiAccount(preferredUsername: string): Promise<RealApiProvisionResult> {
  const base = sanitizeRealApiUsername(preferredUsername)
  let lastMsg = '开户失败'

  for (let n = 1; n <= 20; n++) {
    const candidate = withSuffix(base, n)
    if (!USERNAME_RE.test(candidate)) continue
    const res = await callOpenRegister(candidate)
    if (res.ok) {
      const data = res.data
      const apiKey = String(data.api_key || '').trim()
      const username = String(data.username || candidate).trim()
      if (!apiKey) throw new Error('开户成功但未返回 API Key，请稍后重试或手动前往 Real-API 创建')
      const userId = Number(data.user_id) || null
      let balanceUsd: number | null = null
      try {
        balanceUsd = await fetchRealApiBalanceUsd({
          userId,
          username,
          password: String(data.password || DEFAULT_PASSWORD),
        })
      } catch { /* 余额查询失败不阻断开户 */ }

      return {
        username,
        password: String(data.password || DEFAULT_PASSWORD),
        api_key: apiKey,
        site_url: String(data.site_url || realApiBase()),
        user_id: userId,
        activation_code: data.activation_code || null,
        user_invite_code: data.user_invite_code || null,
        balance_usd: balanceUsd,
      }
    }
    lastMsg = res.msg
    // 仅用户名冲突时换后缀重试
    if (!/用户名已被使用|已存在|已被占用/.test(res.msg)) {
      throw new Error(res.msg)
    }
  }
  throw new Error(lastMsg || '用户名冲突过多，请换一个用户名后重试')
}

function parseBalance(raw: unknown): number | null {
  if (raw == null || raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

/** 查询 Real-API 账户余额（美元）：优先 uid，失败则用账号密码登录取 user_info */
export async function fetchRealApiBalanceUsd(input: {
  userId?: number | null
  username?: string | null
  password?: string | null
}): Promise<number | null> {
  const uid = Number(input.userId) || 0
  if (uid > 0) {
    const url = `${realApiBase()}/api/user/getUserInfo?uid=${uid}`
    const resp = await fetch(url)
    const json = await resp.json().catch(() => null) as any
    if (resp.ok && json?.code === 1) {
      const bal = parseBalance(json.data?.balance_usd)
      if (bal != null) return bal
    }
  }

  const username = String(input.username || '').trim()
  const password = String(input.password || '').trim() || DEFAULT_PASSWORD
  if (!username) throw new Error('缺少用户信息，无法查询余额')

  const resp = await fetch(`${realApiBase()}/api/user/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: username, password }),
  })
  const json = await resp.json().catch(() => null) as any
  if (!resp.ok || !json || json.code !== 1) {
    throw new Error(json?.msg || '查询余额失败')
  }
  const bal = parseBalance(json.data?.user_info?.balance_usd)
  if (bal == null) throw new Error('未返回余额')
  return bal
}

/**
 * 按 API Key 反查 Real-API 账号与余额（openGetAccountByApiKey）。
 * 仅 Key 场景不知明文密码；password 字段可能为空。
 */
export async function resolveRealApiAccountByApiKey(apiKey: string): Promise<RealApiProvisionResult> {
  const key = String(apiKey || '').trim()
  if (!key) throw new Error('缺少 API Key')

  const url = `${realApiBase()}/api/lotus/activationCode/openGetAccountByApiKey`
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openToken()}`,
    },
    body: JSON.stringify({ api_key: key }),
  })
  const json = await resp.json().catch(() => null) as any
  if (!resp.ok || !json || json.code !== 1) {
    throw new Error(json?.msg || `按 Key 查询账号失败 (${resp.status})`)
  }
  const data = json.data || {}
  const username = String(data.username || '').trim()
  if (!username) throw new Error('未返回用户名')

  const userId = Number(data.user_id) || null
  let balanceUsd = parseBalance(data.balance_usd)
  if (balanceUsd == null && userId) {
    try {
      balanceUsd = await fetchRealApiBalanceUsd({ userId, username })
    } catch { /* 余额失败不阻断 */ }
  }

  const pwd = data.password == null || data.password === '' ? '' : String(data.password)
  return {
    username,
    password: pwd,
    api_key: String(data.api_key || key).trim(),
    site_url: String(data.site_url || realApiBase()),
    user_id: userId,
    activation_code: data.activation_code || null,
    user_invite_code: data.user_invite_code || null,
    balance_usd: balanceUsd,
  }
}

/** 按莲花激活码签发 Real-API 一次性自动登录票，返回可打开的 login_url */
export async function createRealApiLoginTicket(
  activationCode: string,
  redirect?: string | null,
): Promise<{
  login_url: string
  username?: string
  expires_in?: number
}> {
  const code = String(activationCode || '').trim()
  if (!code) throw new Error('缺少激活码，无法自动登录')

  const payload: Record<string, string> = { code }
  const redir = String(redirect || '').trim()
  if (redir.startsWith('/') && !redir.startsWith('//')) payload.redirect = redir

  const url = `${realApiBase()}/api/lotus/activationCode/openCreateLoginTicket`
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openToken()}`,
    },
    body: JSON.stringify(payload),
  })
  const json = await resp.json().catch(() => null) as any
  if (!resp.ok || !json || json.code !== 1) {
    throw new Error(json?.msg || `签发登录票失败 (${resp.status})`)
  }
  const loginUrl = String(json.data?.login_url || '').trim()
  if (!loginUrl) throw new Error('未返回登录地址')
  return {
    login_url: loginUrl,
    username: json.data?.username,
    expires_in: json.data?.expires_in,
  }
}
