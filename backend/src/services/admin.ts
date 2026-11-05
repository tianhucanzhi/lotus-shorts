import { desc, eq, isNull, like, or, sql } from 'drizzle-orm'
import { allowRegister, APP_MODE, isSaas } from '../config/mode.js'
import { db, dbPath, schema } from '../db/index.js'
import { toPublicUser } from './auth.js'
import { DATA_ROOT } from '../utils/paths.js'

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

export async function adminOverview() {
  const [userRows, dramaTotal, episodeTotal] = await Promise.all([
    isSaas() ? db.select().from(schema.users) : Promise.resolve([]),
    db.select({ n: sql<number>`count(*)` }).from(schema.dramas).where(isNull(schema.dramas.deletedAt)),
    db.select({ n: sql<number>`count(*)` }).from(schema.episodes).where(isNull(schema.episodes.deletedAt)),
  ])
  const [taskRows, dramaRows] = await Promise.all([
    db.select({ status: schema.sysTask.status, n: sql<number>`count(*)` })
      .from(schema.sysTask).groupBy(schema.sysTask.status),
    db.select({ status: schema.dramas.status, n: sql<number>`count(*)` })
      .from(schema.dramas).where(isNull(schema.dramas.deletedAt)).groupBy(schema.dramas.status),
  ])
  const taskByStatus = toStatusMap(taskRows)
  const dramaByStatus = toStatusMap(dramaRows)

  const users = userRows.map(toPublicUser)
  const recentUsers = [...users].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 6)

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
    .limit(6)

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
    .limit(6)

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
    tasks: {
      total: taskTotal,
      by_status: taskByStatus,
      failed: taskByStatus.failed || 0,
      processing: (taskByStatus.processing || 0) + (taskByStatus.pending || 0),
    },
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
  return rows.map(toPublicUser)
}

export async function adminListDramas(q?: string) {
  const keyword = String(q || '').trim()
  const where = keyword
    ? sql`${schema.dramas.deletedAt} is null and ${schema.dramas.title} like ${'%' + keyword + '%'}`
    : isNull(schema.dramas.deletedAt)
  const rows = await db.select({
    id: schema.dramas.id,
    title: schema.dramas.title,
    status: schema.dramas.status,
    style: schema.dramas.style,
    userId: schema.dramas.userId,
    updatedAt: schema.dramas.updatedAt,
    username: schema.users.username,
    displayName: schema.users.displayName,
  }).from(schema.dramas)
    .leftJoin(schema.users, eq(schema.dramas.userId, schema.users.id))
    .where(where)
    .orderBy(desc(schema.dramas.updatedAt))
    .limit(200)

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
    updated_at: d.updatedAt,
  }))
}

export async function adminListTasks(status?: string) {
  const st = String(status || '').trim()
  const where = st ? eq(schema.sysTask.status, st) : undefined
  const q = db.select({
    id: schema.sysTask.id,
    type: schema.sysTask.type,
    status: schema.sysTask.status,
    stage: schema.sysTask.stage,
    model: schema.sysTask.model,
    provider: schema.sysTask.provider,
    errorMsg: schema.sysTask.errorMsg,
    dramaId: schema.sysTask.dramaId,
    createdAt: schema.sysTask.createdAt,
    updatedAt: schema.sysTask.updatedAt,
    title: schema.dramas.title,
  }).from(schema.sysTask)
    .leftJoin(schema.dramas, eq(schema.sysTask.dramaId, schema.dramas.id))
    .orderBy(desc(schema.sysTask.id))
    .limit(100)
  const rows = where ? await q.where(where) : await q
  return rows.map(t => ({
    id: t.id,
    type: t.type,
    status: t.status,
    stage: t.stage,
    model: t.model,
    provider: t.provider,
    error: clip(t.errorMsg, 180),
    drama_id: t.dramaId,
    drama_title: t.title,
    created_at: t.createdAt,
    updated_at: t.updatedAt,
  }))
}
