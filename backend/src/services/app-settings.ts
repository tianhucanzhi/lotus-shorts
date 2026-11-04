/**
 * 应用级设置（app_settings key-value 表）
 * AI 内容语言：所有 Agent 产出（剧本/提取/分镜/提示词）统一使用的目标语言
 * 层次约束：本模块只依赖 db，严禁反向 import agents/*（agents/context.ts 会引用本模块）
 *
 * SaaS：通过 settingsKeyForUser 按用户隔离 key；独立版保持原 key，兼容旧数据。
 *
 * 注意：刻意做成同步 API（better-sqlite3 驱动的 .get()/.run()），
 * 供 agents/context.ts 的同步 buildAgentRequestContext 内部直接调用
 */
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { settingsKeyForUser } from './auth.js'
import { getRequestUserId } from './request-context.js'
import { now } from '../utils/response.js'

export const CONTENT_LANGUAGES = ['zh', 'en', 'ja', 'ko'] as const
export type ContentLanguage = typeof CONTENT_LANGUAGES[number]

const CONTENT_LANGUAGE_KEY = 'content_language'

function scopedKey(base: string): string {
  return settingsKeyForUser(base, getRequestUserId())
}

function isContentLanguage(v: unknown): v is ContentLanguage {
  return typeof v === 'string' && (CONTENT_LANGUAGES as readonly string[]).includes(v)
}

/** 读取全局内容语言；未设置或值非法时回退 'zh'（保持历史默认行为） */
export function getContentLanguage(): ContentLanguage {
  const key = scopedKey(CONTENT_LANGUAGE_KEY)
  const row = db.select().from(schema.appSettings)
    .where(eq(schema.appSettings.key, key))
    .get()
  // SaaS 用户无个人设置时，回退独立版全局 key，避免空白体验
  if (!row && key !== CONTENT_LANGUAGE_KEY) {
    const fallback = db.select().from(schema.appSettings)
      .where(eq(schema.appSettings.key, CONTENT_LANGUAGE_KEY))
      .get()
    return isContentLanguage(fallback?.value) ? fallback.value : 'zh'
  }
  return isContentLanguage(row?.value) ? row.value : 'zh'
}

/** 写入全局内容语言（upsert） */
export function setContentLanguage(lang: ContentLanguage): ContentLanguage {
  if (!isContentLanguage(lang)) throw new Error(`Invalid content language: ${lang}`)
  const key = scopedKey(CONTENT_LANGUAGE_KEY)
  db.insert(schema.appSettings)
    .values({ key, value: lang, updatedAt: now() })
    .onConflictDoUpdate({
      target: schema.appSettings.key,
      set: { value: lang, updatedAt: now() },
    })
    .run()
  return lang
}

const TOURS_SEEN_KEY = 'tours_seen'
const MAX_TOURS_SEEN = 64

function sanitizeTourIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return []
  return [...new Set(ids.filter(v => typeof v === 'string' && v.length > 0 && v.length <= 100))].slice(0, MAX_TOURS_SEEN)
}

/** 已看过的引导漫游 id 列表（JSON 数组存储）；桌面端端口随启动变化，localStorage 不可靠，故落库 */
export function getToursSeen(): string[] {
  const key = scopedKey(TOURS_SEEN_KEY)
  const row = db.select().from(schema.appSettings)
    .where(eq(schema.appSettings.key, key))
    .get()
  try { return sanitizeTourIds(JSON.parse(row?.value || '[]')) } catch { return [] }
}

/** 写入已看过的引导漫游 id 列表（upsert） */
export function setToursSeen(ids: unknown): string[] {
  const clean = sanitizeTourIds(ids)
  const value = JSON.stringify(clean)
  const key = scopedKey(TOURS_SEEN_KEY)
  db.insert(schema.appSettings)
    .values({ key, value, updatedAt: now() })
    .onConflictDoUpdate({
      target: schema.appSettings.key,
      set: { value, updatedAt: now() },
    })
    .run()
  return clean
}

const REAL_API_ACCOUNT_KEY = 'real_api_account'

export type StoredRealApiAccount = {
  username: string
  password: string
  api_key: string
  site_url?: string | null
  user_id?: number | null
  activation_code?: string | null
  user_invite_code?: string | null
  balance_usd?: number | null
}

function sanitizeRealApiAccount(raw: unknown): StoredRealApiAccount | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const username = String(o.username || '').trim()
  const apiKey = String(o.api_key || '').trim()
  if (!username && !apiKey && !o.activation_code) return null
  const userId = Number(o.user_id)
  const bal = o.balance_usd == null || o.balance_usd === '' ? null : Number(o.balance_usd)
  return {
    username,
    password: String(o.password || '123456'),
    api_key: apiKey,
    site_url: o.site_url ? String(o.site_url) : null,
    user_id: Number.isFinite(userId) && userId > 0 ? userId : null,
    activation_code: o.activation_code ? String(o.activation_code) : null,
    user_invite_code: o.user_invite_code ? String(o.user_invite_code) : null,
    balance_usd: bal != null && Number.isFinite(bal) ? bal : null,
  }
}

/** 读取当前用户（SaaS）/ 全局（独立版）绑定的 Real-API 开户信息 */
export function getRealApiAccount(): StoredRealApiAccount | null {
  const key = scopedKey(REAL_API_ACCOUNT_KEY)
  const row = db.select().from(schema.appSettings)
    .where(eq(schema.appSettings.key, key))
    .get()
  if (!row?.value) return null
  try { return sanitizeRealApiAccount(JSON.parse(row.value)) } catch { return null }
}

/** 持久化 Real-API 开户信息到 SQLite（跨浏览器/设备同源后端可恢复） */
export function setRealApiAccount(account: unknown): StoredRealApiAccount {
  const clean = sanitizeRealApiAccount(account)
  if (!clean) throw new Error('账号信息不完整')
  const value = JSON.stringify(clean)
  const key = scopedKey(REAL_API_ACCOUNT_KEY)
  db.insert(schema.appSettings)
    .values({ key, value, updatedAt: now() })
    .onConflictDoUpdate({
      target: schema.appSettings.key,
      set: { value, updatedAt: now() },
    })
    .run()
  return clean
}
