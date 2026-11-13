import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { isSaas } from '../config/mode.js'
import { db, getInsertId, schema } from '../db/index.js'
import type { AuthVariables } from '../middleware/auth.js'
import { currentUserId, denyUnlessAiConfigOwner } from '../services/access.js'
import { success, notFound, created, badRequest, now } from '../utils/response.js'
import { toSnakeCase } from '../utils/transform.js'
import { joinProviderUrl } from '../services/adapters/url.js'
import { isOfficialProvider, parseConfigTemperature } from '../services/ai.js'
import { getRealApiAccount, setRealApiAccount } from '../services/app-settings.js'
import { createRealApiLoginTicket, fetchRealApiBalanceUsd, provisionRealApiAccount, resolveRealApiAccountByApiKey, sanitizeRealApiUsername } from '../services/real-api-provision.js'
import { redactUrl, logTaskError, logTaskProgress, logTaskSuccess } from '../utils/task-logger.js'

const app = new Hono<{ Variables: AuthVariables }>()

/** 归一化 temperature 入参：null=未设置；合法值 0~2；非法抛错 */
function normalizeTemperature(v: any): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0 || n > 2) throw new Error('invalid temperature')
  return n
}

/** 把 settings JSON 中的 temperature 透出为顶层字段，便于前端直接读写 */
function withParsedFields(r: any) {
  return {
    ...toSnakeCase(r),
    model: r.model ? JSON.parse(r.model) : [],
    temperature: parseConfigTemperature(r.settings),
  }
}

function bearerHeaders(apiKey?: string, withJson = false) {
  const headers: Record<string, string> = {}
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  if (withJson) headers['Content-Type'] = 'application/json'
  return headers
}

function geminiHeaders(apiKey?: string, withJson = false) {
  const headers: Record<string, string> = {}
  if (apiKey) {
    headers['x-goog-api-key'] = apiKey
  }
  if (withJson) headers['Content-Type'] = 'application/json'
  return headers
}

function buildProbe(serviceType: string, provider: string, baseUrl: string, model?: string, apiKey?: string) {
  const p = provider.toLowerCase()
  const m = model || ''

  if (p === 'gemini') {
    // 探针统一走 generateContent:文本运行时(AI SDK)走的就是它,官方与中转站都支持;
    // interactions 端点很多中转站未配置,探它会误报 500。
    // 用最小合法请求体而非空体——空体在部分中转站会触发上游认证失败的误报
    const modelName = m || 'gemini-3.1-pro-preview'
    const url = new URL(joinProviderUrl(baseUrl, '/v1beta', `/models/${modelName}:generateContent`))
    if (apiKey) url.searchParams.set('key', apiKey)
    return {
      method: 'POST',
      url: url.toString(),
      headers: geminiHeaders(apiKey, true),
      body: { contents: [{ parts: [{ text: 'hi' }] }] },
    }
  }

  if (p === 'openai') {
    return {
      method: 'GET',
      url: joinProviderUrl(baseUrl, '/v1', '/models'),
      headers: bearerHeaders(apiKey),
      body: undefined,
    }
  }

  if (p === 'volcengine') {
    const path = serviceType === 'video'
      ? '/contents/generations/tasks'
      : serviceType === 'text'
        ? '/chat/completions'
        : '/images/generations'
    return {
      method: 'POST',
      url: joinProviderUrl(baseUrl, '/api/v3', path),
      headers: bearerHeaders(apiKey, true),
      body: {},
    }
  }

  if (p === 'minimax') {
    // MiniMax 仅提供视频服务，空请求体探测鉴权/端点连通性
    return {
      method: 'POST',
      url: joinProviderUrl(baseUrl, '/v2', '/video_generation'),
      headers: bearerHeaders(apiKey, true),
      body: {},
    }
  }

  if (p === 'aliyun') {
    // Wan 3.0 仅支持异步提交；空请求体不会创建计费任务，仅用于验证地域端点与鉴权是否可达。
    return {
      method: 'POST',
      url: joinProviderUrl(baseUrl, '/api/v1', '/services/aigc/video-generation/video-synthesis'),
      headers: {
        ...bearerHeaders(apiKey, true),
        'X-DashScope-Async': 'enable',
      },
      body: {},
    }
  }

  return {
    method: 'GET',
    url: joinProviderUrl(baseUrl, '', m ? `/${m}` : '/'),
    headers: bearerHeaders(apiKey),
    body: undefined,
  }
}

// GET /ai-configs?service_type=text
app.get('/', async (c) => {
  const serviceType = c.req.query('service_type')
  const userId = currentUserId(c)
  let rows = await db.select().from(schema.aiServiceConfigs)
  if (isSaas() && userId) rows = rows.filter(r => r.userId === userId)
  if (serviceType) rows = rows.filter(r => r.serviceType === serviceType)

  const parsed = rows.map(withParsedFields)
  return success(c, parsed)
})

// POST /ai-configs
app.post('/', async (c) => {
  const body = await c.req.json()
  const ts = now()
  const userId = currentUserId(c)

  // 验证必填字段
  if (!body.service_type || !body.provider) {
    return badRequest(c, '需要 service_type 与 provider')
  }
  if (!isOfficialProvider(body.service_type, body.provider)) {
    return badRequest(c, '不支持的 service_type/provider')
  }

  let temperature: number | null = null
  if ('temperature' in body) {
    try {
      temperature = normalizeTemperature(body.temperature)
    } catch {
      return badRequest(c, 'temperature 须为 0 到 2 之间的数字')
    }
  }

  const res = await db.insert(schema.aiServiceConfigs).values({
    userId: isSaas() ? userId : null,
    serviceType: body.service_type,
    provider: body.provider,
    name: body.name || `${body.provider}-${body.service_type}`,
    baseUrl: body.base_url || '',
    apiKey: body.api_key || '',
    model: JSON.stringify(body.model || []),
    priority: body.priority || 0,
    isActive: true,
    settings: temperature !== null ? JSON.stringify({ temperature }) : null,
    createdAt: ts,
    updatedAt: ts,
  })

  const [row] = await db.select().from(schema.aiServiceConfigs)
    .where(eq(schema.aiServiceConfigs.id, getInsertId(res)))

  return created(c, withParsedFields(row))
})

/** 从已启用的 AI 配置中找一条 Real-API Key（base_url 含 real-api / yunfm） */
function findRealApiKeyFromConfigs(userId: number | null): string | null {
  const rows = db.select({
    apiKey: schema.aiServiceConfigs.apiKey,
    baseUrl: schema.aiServiceConfigs.baseUrl,
    userId: schema.aiServiceConfigs.userId,
    isActive: schema.aiServiceConfigs.isActive,
  }).from(schema.aiServiceConfigs).all()

  for (const r of rows) {
    if (!r.isActive) continue
    if (isSaas() && userId != null && r.userId != null && r.userId !== userId) continue
    const base = String(r.baseUrl || '').toLowerCase()
    if (!/real-api\.yunfm\.cn|yunfm\.cn\/api|real-api/.test(base)) continue
    const key = String(r.apiKey || '').trim()
    if (key) return key
  }
  return null
}

async function ensureRealApiAccountResolved(userId: number | null) {
  const existing = getRealApiAccount()
  if (existing?.username && existing?.user_id) return existing

  const apiKey = String(existing?.api_key || '').trim() || findRealApiKeyFromConfigs(userId)
  if (!apiKey) return existing

  try {
    const resolved = await resolveRealApiAccountByApiKey(apiKey)
    // 已有明文密码则保留（一键开户），Key 反查通常无密码
    const password = existing?.password || resolved.password || ''
    return setRealApiAccount({
      ...resolved,
      password,
      activation_code: resolved.activation_code || existing?.activation_code || null,
      user_invite_code: resolved.user_invite_code || existing?.user_invite_code || null,
    })
  } catch {
    return existing
  }
}

// GET /ai-configs/real-api/account — 读取本系统已落库的 Real-API 开户信息（跨浏览器）
// 若仅有 Key 配置、尚无账号缓存，则按 Key 向 Real-API 反查并落库
app.get('/real-api/account', async (c) => {
  const account = await ensureRealApiAccountResolved(currentUserId(c))
  return success(c, account)
})

// POST /ai-configs/real-api/account — 落库/覆盖 Real-API 开户信息（用于旧版 localStorage 迁移）
app.post('/real-api/account', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  try {
    const saved = setRealApiAccount(body)
    return success(c, saved)
  } catch (err: any) {
    return badRequest(c, err?.message || '保存账号失败')
  }
})

// POST /ai-configs/real-api/resolve-by-key — 按 API Key 反查并落库账号/余额
app.post('/real-api/resolve-by-key', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const apiKey = String(body.api_key || body.apiKey || '').trim()
  if (!apiKey) return badRequest(c, '缺少 api_key')
  try {
    const existing = getRealApiAccount()
    const resolved = await resolveRealApiAccountByApiKey(apiKey)
    const saved = setRealApiAccount({
      ...resolved,
      password: existing?.password || resolved.password || '',
      activation_code: resolved.activation_code || existing?.activation_code || null,
      user_invite_code: resolved.user_invite_code || existing?.user_invite_code || null,
    })
    return success(c, saved)
  } catch (err: any) {
    return badRequest(c, err?.message || '按 Key 查询账号失败')
  }
})

// POST /ai-configs/real-api/auto-register — 一键开通 Real-API 账号并返回 Key（Token 仅后端持有）
app.post('/real-api/auto-register', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const userId = currentUserId(c)
  // 已开通过则直接返回落库记录，避免重复开户
  const existing = getRealApiAccount()
  if (existing?.username && existing?.api_key && !body.force) {
    return success(c, existing)
  }
  // SaaS 优先用当前登录用户名；独立版可用 body.username，缺省 lotus
  let preferred = String(body.username || '').trim()
  if (!preferred && isSaas()) {
    preferred = String(c.get('username') || '').trim()
  }
  if (!preferred) preferred = 'lotus'
  preferred = sanitizeRealApiUsername(preferred)

  try {
    const account = await provisionRealApiAccount(preferred)
    const saved = setRealApiAccount(account)
    logTaskSuccess('AIConfig', 'real-api-auto-register', {
      userId,
      username: saved.username,
    })
    return success(c, saved)
  } catch (err: any) {
    logTaskError('AIConfig', 'real-api-auto-register', {
      userId,
      preferred,
      error: err?.message,
    })
    return badRequest(c, err?.message || '自动注册 Real-API 失败')
  }
})

// POST /ai-configs/real-api/balance — 查询 Real-API 账户余额
app.post('/real-api/balance', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  try {
    const stored = getRealApiAccount()
    const balance = await fetchRealApiBalanceUsd({
      userId: body.user_id ?? body.userId ?? stored?.user_id,
      username: body.username || stored?.username,
      password: body.password || stored?.password,
    })
    if (stored) {
      try { setRealApiAccount({ ...stored, balance_usd: balance }) } catch { /* ignore */ }
    }
    return success(c, { balance_usd: balance })
  } catch (err: any) {
    return badRequest(c, err?.message || '查询余额失败')
  }
})

// POST /ai-configs/real-api/login-ticket — 按激活码签发 Real-API 自动登录 URL
app.post('/real-api/login-ticket', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const code = String(body.activation_code || body.code || '').trim()
  if (!code) return badRequest(c, '缺少 activation_code')
  try {
    const ticket = await createRealApiLoginTicket(code, body.redirect)
    return success(c, ticket)
  } catch (err: any) {
    return badRequest(c, err?.message || '签发登录票失败')
  }
})

// POST /ai-configs/test
app.post('/test', async (c) => {
  const body = await c.req.json()
  if (!body.service_type || !body.provider || !body.base_url) {
    return badRequest(c, '需要 service_type、provider 与 base_url')
  }
  if (!isOfficialProvider(body.service_type, body.provider)) {
    return badRequest(c, '不支持的 service_type/provider')
  }

  const model = Array.isArray(body.model) ? body.model[0] : body.model
  const probe = buildProbe(body.service_type, body.provider, body.base_url, model, body.api_key)
  const probeUrl = redactUrl(probe.url)

  logTaskProgress('AIConfig', 'probe-start', {
    serviceType: body.service_type,
    provider: body.provider,
    method: probe.method,
    url: probeUrl,
  })

  try {
    const resp = await fetch(probe.url, {
      method: probe.method,
      headers: probe.headers,
      body: probe.body ? JSON.stringify(probe.body) : undefined,
    })
    const text = await resp.text()
    const reachable = [200, 204, 400, 401, 403].includes(resp.status)
    const payload = {
      ok: resp.ok,
      reachable,
      status: resp.status,
      status_text: resp.statusText,
      method: probe.method,
      url: probeUrl,
      message: reachable
        ? (resp.ok ? '端点可访问，认证与路径基本正常' : '端点已响应，请根据状态码判断认证或路径是否正确')
        : '端点未按预期响应，请检查 Base URL 和代理前缀',
      response_preview: text.slice(0, 240),
    }
    if (reachable) {
      logTaskSuccess('AIConfig', 'probe-done', {
        provider: body.provider,
        status: resp.status,
        url: probeUrl,
      })
    } else {
      logTaskError('AIConfig', 'probe-unexpected', {
        provider: body.provider,
        status: resp.status,
        url: probeUrl,
      })
    }
    return success(c, payload)
  } catch (error: any) {
    logTaskError('AIConfig', 'probe-failed', {
      provider: body.provider,
      url: probeUrl,
      error: error.message,
    })
    return success(c, {
      ok: false,
      reachable: false,
      method: probe.method,
      url: probeUrl,
      message: error.message || '请求失败',
      response_preview: '',
    })
  }
})

// GET /ai-configs/:id
app.get('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const denied = await denyUnlessAiConfigOwner(c, id)
  if (denied) return denied
  const [row] = await db.select().from(schema.aiServiceConfigs).where(eq(schema.aiServiceConfigs.id, id))
  if (!row) return notFound(c)
  return success(c, withParsedFields(row))
})

// PUT /ai-configs/:id
app.put('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const denied = await denyUnlessAiConfigOwner(c, id)
  if (denied) return denied
  const body = await c.req.json()
  const [existing] = await db.select().from(schema.aiServiceConfigs).where(eq(schema.aiServiceConfigs.id, id))
  if (!existing) return notFound(c)

  const serviceType = 'service_type' in body ? body.service_type : existing.serviceType
  const provider = 'provider' in body ? body.provider : existing.provider
  if (!isOfficialProvider(serviceType, provider)) {
    return badRequest(c, '不支持的 service_type/provider')
  }

  const updates: Record<string, any> = { updatedAt: now() }

  if ('service_type' in body) updates.serviceType = body.service_type
  if ('provider' in body) updates.provider = body.provider
  if ('name' in body) updates.name = body.name
  if ('base_url' in body) updates.baseUrl = body.base_url
  if ('api_key' in body) updates.apiKey = body.api_key
  if ('model' in body) updates.model = JSON.stringify(body.model)
  if ('priority' in body) updates.priority = body.priority
  if ('is_active' in body) updates.isActive = body.is_active
  if ('temperature' in body) {
    let temperature: number | null
    try {
      temperature = normalizeTemperature(body.temperature)
    } catch {
      return badRequest(c, 'temperature 须为 0 到 2 之间的数字')
    }
    // 与已有 settings 合并，清空的 temperature 从 JSON 中移除
    let settings: Record<string, any> = {}
    try { settings = existing.settings ? JSON.parse(existing.settings) : {} } catch { settings = {} }
    if (temperature === null) delete settings.temperature
    else settings.temperature = temperature
    updates.settings = Object.keys(settings).length ? JSON.stringify(settings) : null
  }

  await db.update(schema.aiServiceConfigs).set(updates).where(eq(schema.aiServiceConfigs.id, id))
  return success(c)
})

// DELETE /ai-configs/:id
app.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const denied = await denyUnlessAiConfigOwner(c, id)
  if (denied) return denied
  await db.delete(schema.aiServiceConfigs).where(eq(schema.aiServiceConfigs.id, id))
  return success(c)
})

// GET /ai-providers
export const aiProviders = new Hono()
aiProviders.get('/', async (c) => {
  const rows = await db.select().from(schema.aiServiceProviders)
  const parsed = rows.map(r => ({
    ...toSnakeCase(r),
    preset_models: r.presetModels ? JSON.parse(r.presetModels) : [],
  }))
  return success(c, parsed)
})

export default app
