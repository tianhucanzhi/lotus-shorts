import { and, desc, eq, isNull, like, or, sql } from 'drizzle-orm'
import { allowRegister, APP_MODE, isSaas } from '../config/mode.js'
import { stylePresetSeeds } from '../db/sqlite-schema.js'
import { db, dbPath, rawCount, schema } from '../db/index.js'
import { toPublicUser } from './auth.js'
import { DATA_ROOT } from '../utils/paths.js'
import { now } from '../utils/response.js'

/** 内置默认风格 key（代码种子副本，供一键还原） */
const BUILTIN_STYLE_VALUES = new Set(stylePresetSeeds.map(s => s.value))

function num(v: unknown): number {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

function toStatusMap(rows: { status: string | null; n: unknown }[]) {
  const out: Record<string, number> = {}
  for (const row of rows) out[String(row.status || 'unknown')] = num(row.n)
  return out
}

function clip(v: string | null | undefined, max = 120) {
  const s = String(v || '').replace(/\s+/g, ' ').trim()
  if (!s) return ''
  return s.length > max ? `${s.slice(0, max)}…` : s
}

function maskSecret(v: string | null | undefined) {
  const s = String(v || '')
  if (!s) return ''
  if (s.length <= 8) return '****'
  return `${s.slice(0, 4)}…${s.slice(-4)}`
}

function dayKey(iso: string | null | undefined) {
  const s = String(iso || '')
  return s.length >= 10 ? s.slice(0, 10) : ''
}

export async function adminOverview() {
  const [userRows, dramaTotal, episodeTotal] = await Promise.all([
    db.select().from(schema.users),
    db.select({ n: sql<number>`count(*)` }).from(schema.dramas).where(isNull(schema.dramas.deletedAt)),
    db.select({ n: sql<number>`count(*)` }).from(schema.episodes).where(isNull(schema.episodes.deletedAt)),
  ])
  const [taskRows, dramaRows, styleTotal, aiConfigTotal] = await Promise.all([
    db.select({ status: schema.sysTask.status, n: sql<number>`count(*)` })
      .from(schema.sysTask).groupBy(schema.sysTask.status),
    db.select({ status: schema.dramas.status, n: sql<number>`count(*)` })
      .from(schema.dramas).where(isNull(schema.dramas.deletedAt)).groupBy(schema.dramas.status),
    db.select({ n: sql<number>`count(*)` }).from(schema.stylePresets).where(isNull(schema.stylePresets.userId)),
    db.select({ n: sql<number>`count(*)` }).from(schema.aiServiceConfigs),
  ])
  const taskByStatus = toStatusMap(taskRows)
  const dramaByStatus = toStatusMap(dramaRows)

  const users = userRows.map(toPublicUser)
  const recentUsers = [...users].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 8)

  const recentDramas = await db.select({
    id: schema.dramas.id,
    title: schema.dramas.title,
    status: schema.dramas.status,
    userId: schema.dramas.userId,
    updatedAt: schema.dramas.updatedAt,
    username: schema.users.username,
  }).from(schema.dramas)
    .leftJoin(schema.users, eq(schema.dramas.userId, schema.users.id))
    .where(isNull(schema.dramas.deletedAt))
    .orderBy(desc(schema.dramas.updatedAt))
    .limit(8)

  const recentFailures = await db.select({
    id: schema.sysTask.id,
    type: schema.sysTask.type,
    status: schema.sysTask.status,
    model: schema.sysTask.model,
    errorMsg: schema.sysTask.errorMsg,
    dramaId: schema.sysTask.dramaId,
    createdAt: schema.sysTask.createdAt,
    title: schema.dramas.title,
  }).from(schema.sysTask)
    .leftJoin(schema.dramas, eq(schema.sysTask.dramaId, schema.dramas.id))
    .where(eq(schema.sysTask.status, 'failed'))
    .orderBy(desc(schema.sysTask.createdAt))
    .limit(8)

  const since = new Date()
  since.setDate(since.getDate() - 6)
  since.setHours(0, 0, 0, 0)
  const sinceIso = since.toISOString()
  const recentTaskRows = await db.select({
    createdAt: schema.sysTask.createdAt,
    status: schema.sysTask.status,
  }).from(schema.sysTask)
    .where(sql`${schema.sysTask.createdAt} >= ${sinceIso}`)

  const trendMap = new Map<string, { total: number; failed: number; completed: number }>()
  for (let i = 0; i < 7; i++) {
    const d = new Date(since)
    d.setDate(since.getDate() + i)
    const key = d.toISOString().slice(0, 10)
    trendMap.set(key, { total: 0, failed: 0, completed: 0 })
  }
  for (const row of recentTaskRows) {
    const key = dayKey(row.createdAt)
    const bucket = trendMap.get(key)
    if (!bucket) continue
    bucket.total += 1
    if (row.status === 'failed') bucket.failed += 1
    if (row.status === 'completed') bucket.completed += 1
  }
  const taskTrend = [...trendMap.entries()].map(([date, v]) => ({ date, ...v }))

  const taskTotal = Object.values(taskByStatus).reduce((a, b) => a + b, 0)

  return {
    mode: APP_MODE,
    saas: isSaas(),
    allow_register: allowRegister(),
    data_dir: DATA_ROOT,
    sqlite_path: dbPath,
    users: {
      total: users.length,
      active: users.filter(u => u.status === 'active').length,
      disabled: users.filter(u => u.status !== 'active').length,
      admins: users.filter(u => u.role === 'admin' && u.status === 'active').length,
    },
    dramas: {
      total: num(dramaTotal[0]?.n),
      by_status: dramaByStatus,
    },
    episodes: num(episodeTotal[0]?.n),
    styles: num(styleTotal[0]?.n),
    ai_configs: num(aiConfigTotal[0]?.n),
    tasks: {
      total: taskTotal,
      by_status: taskByStatus,
      failed: taskByStatus.failed || 0,
      processing: (taskByStatus.processing || 0) + (taskByStatus.pending || 0),
    },
    task_trend: taskTrend,
    recent_users: recentUsers,
    recent_dramas: recentDramas.map(d => ({
      id: d.id,
      title: d.title,
      status: d.status,
      user_id: d.userId,
      username: d.username,
      updated_at: d.updatedAt,
    })),
    recent_failures: recentFailures.map(t => ({
      id: t.id,
      type: t.type,
      status: t.status,
      model: t.model,
      error: clip(t.errorMsg, 160),
      drama_id: t.dramaId,
      drama_title: t.title,
      created_at: t.createdAt,
    })),
  }
}

export async function adminListUsers(q?: string) {
  const keyword = String(q || '').trim()
  const rows = keyword
    ? await db.select().from(schema.users).where(or(
      like(schema.users.username, `%${keyword}%`),
      like(schema.users.displayName, `%${keyword}%`),
    )).orderBy(desc(schema.users.createdAt))
    : await db.select().from(schema.users).orderBy(desc(schema.users.createdAt))

  const dramaCounts = await db.select({
    userId: schema.dramas.userId,
    n: sql<number>`count(*)`,
  }).from(schema.dramas)
    .where(isNull(schema.dramas.deletedAt))
    .groupBy(schema.dramas.userId)
  const dramaMap = new Map(dramaCounts.map(c => [c.userId, num(c.n)]))

  return rows.map(row => ({
    ...toPublicUser(row),
    drama_count: dramaMap.get(row.id) || 0,
  }))
}

export async function adminListDramas(q?: string, status?: string) {
  const keyword = String(q || '').trim()
  const st = String(status || '').trim()
  const clauses = [isNull(schema.dramas.deletedAt)]
  if (keyword) clauses.push(like(schema.dramas.title, `%${keyword}%`))
  if (st) clauses.push(eq(schema.dramas.status, st))

  const rows = await db.select({
    id: schema.dramas.id,
    title: schema.dramas.title,
    status: schema.dramas.status,
    style: schema.dramas.style,
    userId: schema.dramas.userId,
    createdAt: schema.dramas.createdAt,
    updatedAt: schema.dramas.updatedAt,
    username: schema.users.username,
    displayName: schema.users.displayName,
  }).from(schema.dramas)
    .leftJoin(schema.users, eq(schema.dramas.userId, schema.users.id))
    .where(and(...clauses))
    .orderBy(desc(schema.dramas.updatedAt))
    .limit(300)

  const counts = await db.select({
    dramaId: schema.episodes.dramaId,
    n: sql<number>`count(*)`,
  }).from(schema.episodes)
    .where(isNull(schema.episodes.deletedAt))
    .groupBy(schema.episodes.dramaId)
  const episodeMap = new Map(counts.map(c => [c.dramaId, num(c.n)]))

  return rows.map(d => ({
    id: d.id,
    title: d.title,
    status: d.status,
    style: d.style,
    user_id: d.userId,
    username: d.username,
    display_name: d.displayName,
    episodes: episodeMap.get(d.id) || 0,
    created_at: d.createdAt,
    updated_at: d.updatedAt,
  }))
}

export async function adminSoftDeleteDrama(id: number) {
  const [row] = await db.select({ id: schema.dramas.id })
    .from(schema.dramas)
    .where(and(eq(schema.dramas.id, id), isNull(schema.dramas.deletedAt)))
  if (!row) throw new Error('项目不存在')
  await db.update(schema.dramas).set({ deletedAt: now() }).where(eq(schema.dramas.id, id))
}

export async function adminTransferDrama(id: number, userId: number | null) {
  const [row] = await db.select({ id: schema.dramas.id })
    .from(schema.dramas)
    .where(and(eq(schema.dramas.id, id), isNull(schema.dramas.deletedAt)))
  if (!row) throw new Error('项目不存在')
  if (userId != null) {
    const user = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, userId))
    if (!user[0]) throw new Error('目标用户不存在')
  }
  await db.update(schema.dramas).set({
    userId: userId,
    updatedAt: now(),
  }).where(eq(schema.dramas.id, id))
}

export async function adminListTasks(opts?: { status?: string; type?: string; q?: string }) {
  const st = String(opts?.status || '').trim()
  const typ = String(opts?.type || '').trim()
  const keyword = String(opts?.q || '').trim()
  const clauses = []
  if (st) clauses.push(eq(schema.sysTask.status, st))
  if (typ) clauses.push(eq(schema.sysTask.type, typ))
  if (keyword) {
    clauses.push(or(
      like(schema.sysTask.model, `%${keyword}%`),
      like(schema.sysTask.provider, `%${keyword}%`),
      like(schema.sysTask.errorMsg, `%${keyword}%`),
      like(schema.dramas.title, `%${keyword}%`),
    )!)
  }

  const base = db.select({
    id: schema.sysTask.id,
    type: schema.sysTask.type,
    status: schema.sysTask.status,
    stage: schema.sysTask.stage,
    model: schema.sysTask.model,
    provider: schema.sysTask.provider,
    errorMsg: schema.sysTask.errorMsg,
    errorCode: schema.sysTask.errorCode,
    dramaId: schema.sysTask.dramaId,
    storyboardId: schema.sysTask.storyboardId,
    characterId: schema.sysTask.characterId,
    sceneId: schema.sysTask.sceneId,
    propId: schema.sysTask.propId,
    taskId: schema.sysTask.taskId,
    resultUrl: schema.sysTask.resultUrl,
    createdAt: schema.sysTask.createdAt,
    updatedAt: schema.sysTask.updatedAt,
    completedAt: schema.sysTask.completedAt,
    title: schema.dramas.title,
  }).from(schema.sysTask)
    .leftJoin(schema.dramas, eq(schema.sysTask.dramaId, schema.dramas.id))

  const filtered = clauses.length ? base.where(and(...clauses)) : base
  const rows = await filtered.orderBy(desc(schema.sysTask.id)).limit(200)
  return rows.map(t => ({
    id: t.id,
    type: t.type,
    status: t.status,
    stage: t.stage,
    model: t.model,
    provider: t.provider,
    error: clip(t.errorMsg, 180),
    error_code: t.errorCode,
    drama_id: t.dramaId,
    drama_title: t.title,
    storyboard_id: t.storyboardId,
    character_id: t.characterId,
    scene_id: t.sceneId,
    prop_id: t.propId,
    upstream_task_id: t.taskId,
    result_url: t.resultUrl,
    created_at: t.createdAt,
    updated_at: t.updatedAt,
    completed_at: t.completedAt,
  }))
}

export async function adminGetTask(id: number) {
  const [t] = await db.select({
    id: schema.sysTask.id,
    type: schema.sysTask.type,
    status: schema.sysTask.status,
    stage: schema.sysTask.stage,
    model: schema.sysTask.model,
    provider: schema.sysTask.provider,
    errorMsg: schema.sysTask.errorMsg,
    errorCode: schema.sysTask.errorCode,
    prompt: schema.sysTask.prompt,
    params: schema.sysTask.params,
    dramaId: schema.sysTask.dramaId,
    storyboardId: schema.sysTask.storyboardId,
    characterId: schema.sysTask.characterId,
    sceneId: schema.sysTask.sceneId,
    propId: schema.sysTask.propId,
    taskId: schema.sysTask.taskId,
    resultUrl: schema.sysTask.resultUrl,
    localPath: schema.sysTask.localPath,
    createdAt: schema.sysTask.createdAt,
    updatedAt: schema.sysTask.updatedAt,
    completedAt: schema.sysTask.completedAt,
    title: schema.dramas.title,
  }).from(schema.sysTask)
    .leftJoin(schema.dramas, eq(schema.sysTask.dramaId, schema.dramas.id))
    .where(eq(schema.sysTask.id, id))
  if (!t) throw new Error('任务不存在')
  return {
    id: t.id,
    type: t.type,
    status: t.status,
    stage: t.stage,
    model: t.model,
    provider: t.provider,
    error: t.errorMsg || '',
    error_code: t.errorCode,
    prompt: t.prompt,
    params: t.params,
    drama_id: t.dramaId,
    drama_title: t.title,
    storyboard_id: t.storyboardId,
    character_id: t.characterId,
    scene_id: t.sceneId,
    prop_id: t.propId,
    upstream_task_id: t.taskId,
    result_url: t.resultUrl,
    local_path: t.localPath,
    created_at: t.createdAt,
    updated_at: t.updatedAt,
    completed_at: t.completedAt,
  }
}

export async function adminCancelTask(id: number) {
  const [row] = await db.select().from(schema.sysTask).where(eq(schema.sysTask.id, id))
  if (!row) throw new Error('任务不存在')
  if (row.status !== 'pending' && row.status !== 'processing') {
    throw new Error('仅可取消进行中或排队中的任务')
  }
  const ts = now()
  await db.update(schema.sysTask).set({
    status: 'cancelled',
    errorMsg: '管理员取消',
    errorCode: 'admin_cancelled',
    updatedAt: ts,
    completedAt: ts,
  }).where(eq(schema.sysTask.id, id))
  return adminGetTask(id)
}

export async function adminListStyles() {
  const rows = await db.select().from(schema.stylePresets)
    .where(isNull(schema.stylePresets.userId))
    .orderBy(schema.stylePresets.sortOrder, schema.stylePresets.id)
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    value: r.value,
    prompt: r.prompt,
    description: r.description,
    sort_order: r.sortOrder ?? 0,
    is_active: !!r.isActive,
    is_builtin: BUILTIN_STYLE_VALUES.has(r.value),
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  }))
}

/**
 * 按代码内 stylePresetSeeds 强制还原全局内置风格（upsert）。
 * 不删除管理员自建的非内置风格；个人副本（user_id 非空）不动。
 */
export async function adminRestoreDefaultStyles() {
  const ts = now()
  let restored = 0
  let created = 0
  for (const seed of stylePresetSeeds) {
    const [existing] = await db.select({ id: schema.stylePresets.id }).from(schema.stylePresets)
      .where(and(isNull(schema.stylePresets.userId), eq(schema.stylePresets.value, seed.value)))
    if (existing) {
      await db.update(schema.stylePresets).set({
        name: seed.name,
        prompt: seed.prompt,
        description: seed.description || null,
        sortOrder: seed.sortOrder,
        isActive: true,
        updatedAt: ts,
      }).where(eq(schema.stylePresets.id, existing.id))
      restored += 1
    } else {
      await db.insert(schema.stylePresets).values({
        userId: null,
        name: seed.name,
        value: seed.value,
        prompt: seed.prompt,
        description: seed.description || null,
        sortOrder: seed.sortOrder,
        isActive: true,
        createdAt: ts,
        updatedAt: ts,
      })
      created += 1
    }
  }
  return {
    total: stylePresetSeeds.length,
    restored,
    created,
    items: await adminListStyles(),
  }
}

const VALUE_PATTERN = /^[a-z0-9][a-z0-9-]*$/

export async function adminCreateStyle(input: {
  name: string
  value: string
  prompt: string
  description?: string | null
  sort_order?: number
  is_active?: boolean
}) {
  const name = String(input.name || '').trim()
  const value = String(input.value || '').trim()
  const prompt = String(input.prompt || '').trim()
  if (!name) throw new Error('风格名称必填')
  if (!VALUE_PATTERN.test(value)) throw new Error('风格 key 仅支持小写字母、数字、中划线')
  if (!prompt) throw new Error('提示词片段必填')
  const [dup] = await db.select({ id: schema.stylePresets.id }).from(schema.stylePresets)
    .where(and(isNull(schema.stylePresets.userId), eq(schema.stylePresets.value, value)))
  if (dup) throw new Error('风格 key 已存在')
  const ts = now()
  await db.insert(schema.stylePresets).values({
    userId: null,
    name,
    value,
    prompt,
    description: input.description?.trim() || null,
    sortOrder: Number(input.sort_order ?? 0),
    isActive: input.is_active === false ? false : true,
    createdAt: ts,
    updatedAt: ts,
  })
  const items = await adminListStyles()
  const created = items.find(i => i.value === value)
  if (!created) throw new Error('创建失败')
  return created
}

export async function adminUpdateStyle(id: number, patch: {
  name?: string
  prompt?: string
  description?: string | null
  sort_order?: number
  is_active?: boolean
}) {
  const [row] = await db.select().from(schema.stylePresets)
    .where(and(eq(schema.stylePresets.id, id), isNull(schema.stylePresets.userId)))
  if (!row) throw new Error('风格预设不存在')
  const updates: Partial<typeof schema.stylePresets.$inferInsert> = { updatedAt: now() }
  if (patch.name !== undefined) {
    const name = String(patch.name || '').trim()
    if (!name) throw new Error('风格名称必填')
    updates.name = name
  }
  if (patch.prompt !== undefined) {
    const prompt = String(patch.prompt || '').trim()
    if (!prompt) throw new Error('提示词片段必填')
    updates.prompt = prompt
  }
  if (patch.description !== undefined) updates.description = patch.description?.trim() || null
  if (patch.sort_order !== undefined) updates.sortOrder = Number(patch.sort_order)
  if (patch.is_active !== undefined) updates.isActive = !!patch.is_active
  await db.update(schema.stylePresets).set(updates).where(eq(schema.stylePresets.id, id))
  const items = await adminListStyles()
  return items.find(i => i.id === id)!
}

export async function adminDeleteStyle(id: number) {
  const [row] = await db.select().from(schema.stylePresets)
    .where(and(eq(schema.stylePresets.id, id), isNull(schema.stylePresets.userId)))
  if (!row) throw new Error('风格预设不存在')
  await db.delete(schema.stylePresets).where(eq(schema.stylePresets.id, id))
}

export async function adminListAiConfigs() {
  const rows = await db.select({
    id: schema.aiServiceConfigs.id,
    userId: schema.aiServiceConfigs.userId,
    serviceType: schema.aiServiceConfigs.serviceType,
    provider: schema.aiServiceConfigs.provider,
    name: schema.aiServiceConfigs.name,
    baseUrl: schema.aiServiceConfigs.baseUrl,
    apiKey: schema.aiServiceConfigs.apiKey,
    model: schema.aiServiceConfigs.model,
    endpoint: schema.aiServiceConfigs.endpoint,
    priority: schema.aiServiceConfigs.priority,
    isDefault: schema.aiServiceConfigs.isDefault,
    isActive: schema.aiServiceConfigs.isActive,
    createdAt: schema.aiServiceConfigs.createdAt,
    updatedAt: schema.aiServiceConfigs.updatedAt,
    username: schema.users.username,
  }).from(schema.aiServiceConfigs)
    .leftJoin(schema.users, eq(schema.aiServiceConfigs.userId, schema.users.id))
    .orderBy(desc(schema.aiServiceConfigs.updatedAt))
    .limit(500)

  const byType: Record<string, number> = {}
  const byProvider: Record<string, number> = {}
  const items = rows.map(r => {
    byType[r.serviceType] = (byType[r.serviceType] || 0) + 1
    const p = r.provider || 'unknown'
    byProvider[p] = (byProvider[p] || 0) + 1
    return {
      id: r.id,
      user_id: r.userId,
      username: r.username,
      service_type: r.serviceType,
      provider: r.provider,
      name: r.name,
      base_url: r.baseUrl,
      api_key_masked: maskSecret(r.apiKey),
      model: r.model,
      endpoint: r.endpoint,
      priority: r.priority ?? 0,
      is_default: !!r.isDefault,
      is_active: !!r.isActive,
      created_at: r.createdAt,
      updated_at: r.updatedAt,
    }
  })

  return { items, by_type: byType, by_provider: byProvider }
}

export async function adminSystemInfo() {
  const tables = [
    'users', 'dramas', 'episodes', 'characters', 'scenes', 'props',
    'storyboards', 'sys_task', 'ai_service_configs', 'style_presets',
    'video_merges', 'assets', 'app_settings',
  ] as const
  const counts: Record<string, number> = {}
  for (const table of tables) counts[table] = rawCount(table)
  return {
    mode: APP_MODE,
    saas: isSaas(),
    allow_register: allowRegister(),
    data_dir: DATA_ROOT,
    sqlite_path: dbPath,
    table_counts: counts,
    server_time: now(),
  }
}
