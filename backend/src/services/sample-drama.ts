/**
 * SaaS 示例项目：每个账号预置《一品布衣》《灵环纪》《御赐傻婿》等，角标「示例」，用户可自行删除。
 * - 媒体文件共享同一 static 路径，只复制数据库行并重映射 ID
 * - 若用户曾拥有同 sample_key（含软删），该 key 不再重复下发；各示例相互独立
 * - 以 data/sample-packs/<key> 本地导出包为权威源，避免线上同名落后副本被克隆
 */
import { and, eq, isNull } from 'drizzle-orm'
import { isSaas } from '../config/mode.js'
import { db, getInsertId, schema } from '../db/index.js'
import { now } from '../utils/response.js'
import { syncSamplePackToTemplate } from './sample-pack.js'

export type SampleDef = {
  key: string
  title: string
  /** 可选：环境变量指定模板 drama id */
  envVar?: string
}

export const SAMPLE_DRAMAS: SampleDef[] = [
  { key: 'yipin-buyi', title: '一品布衣', envVar: 'SAMPLE_DRAMA_ID' },
  { key: 'linghuan-ji', title: '灵环纪', envVar: 'SAMPLE_DRAMA_ID_LINGHUAN' },
  { key: 'yuci-shaxu', title: '御赐傻婿', envVar: 'SAMPLE_DRAMA_ID_YUCI' },
]

/** @deprecated 兼容旧引用：默认取第一部示例 */
export const SAMPLE_KEY = SAMPLE_DRAMAS[0].key
/** @deprecated 兼容旧引用 */
export const SAMPLE_TITLE = SAMPLE_DRAMAS[0].title

const SAMPLE_KEYS = new Set(SAMPLE_DRAMAS.map(s => s.key))

const ensuringUsers = new Set<number>()

type Meta = Record<string, unknown>

export function parseDramaMeta(raw: string | null | undefined): Meta {
  if (!raw) return {}
  try {
    const v = JSON.parse(raw)
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Meta : {}
  } catch {
    return {}
  }
}

export function isSampleDrama(metaOrRaw: Meta | string | null | undefined): boolean {
  const meta = typeof metaOrRaw === 'string' || metaOrRaw == null
    ? parseDramaMeta(metaOrRaw)
    : metaOrRaw
  if (meta.is_sample === true) return true
  return typeof meta.sample_key === 'string' && SAMPLE_KEYS.has(meta.sample_key)
}

function stampSampleMeta(raw: string | null | undefined, sample: SampleDef, extra: Meta = {}): string {
  return JSON.stringify({
    ...parseDramaMeta(raw),
    is_sample: true,
    sample_key: sample.key,
    ...extra,
  })
}

function envTemplateId(sample: SampleDef): number | null {
  if (!sample.envVar) return null
  const n = Number(process.env[sample.envVar] || '')
  return Number.isFinite(n) && n > 0 ? n : null
}

/** 解析某一部示例的模板源（环境变量 → 已标记 is_template；不再按标题盲匹配，避免线上落后副本） */
async function resolveTemplateDrama(sample: SampleDef) {
  const preferred = envTemplateId(sample)
  if (preferred) {
    const [row] = await db.select().from(schema.dramas).where(eq(schema.dramas.id, preferred))
    if (row && !row.deletedAt) return row
  }

  const all = await db.select().from(schema.dramas)
  const byFlag = all.find(d => {
    if (d.deletedAt) return false
    const meta = parseDramaMeta(d.metadata)
    return meta.is_template === true && meta.sample_key === sample.key
  })
  return byFlag || null
}

type UserSampleState =
  | { kind: 'missing' }
  | { kind: 'retired' }
  | { kind: 'ready'; version: number; ids: number[] }

async function getUserSampleState(userId: number, sample: SampleDef): Promise<UserSampleState> {
  const rows = await db.select({
    id: schema.dramas.id,
    metadata: schema.dramas.metadata,
    deletedAt: schema.dramas.deletedAt,
  }).from(schema.dramas).where(eq(schema.dramas.userId, userId))

  const related = rows.filter(r => parseDramaMeta(r.metadata).sample_key === sample.key)
  if (!related.length) return { kind: 'missing' }

  const active = related.filter(r => !r.deletedAt && parseDramaMeta(r.metadata).is_template !== true)
  if (!active.length) {
    // 用户主动软删过则不再下发；若只剩模板行则视为 missing（模板所有者不另克隆）
    if (related.some(r => r.deletedAt && parseDramaMeta(r.metadata).is_template !== true)) {
      return { kind: 'retired' }
    }
    return { kind: 'missing' }
  }

  const version = Math.max(...active.map(r => Number(parseDramaMeta(r.metadata).pack_version || 0)))
  return { kind: 'ready', version, ids: active.map(r => r.id) }
}

async function stampExistingTitleAsSample(userId: number, sample: SampleDef): Promise<boolean> {
  const rows = await db.select().from(schema.dramas).where(and(
    eq(schema.dramas.userId, userId),
    eq(schema.dramas.title, sample.title),
    isNull(schema.dramas.deletedAt),
  ))
  if (!rows.length) return false
  for (const row of rows) {
    await db.update(schema.dramas).set({
      metadata: stampSampleMeta(row.metadata, sample),
      updatedAt: now(),
    }).where(eq(schema.dramas.id, row.id))
  }
  return true
}

async function markTemplate(sourceId: number, sample: SampleDef) {
  const [row] = await db.select().from(schema.dramas).where(eq(schema.dramas.id, sourceId))
  if (!row) return
  const meta = parseDramaMeta(row.metadata)
  if (meta.is_template === true && meta.sample_key === sample.key) return
  await db.update(schema.dramas).set({
    metadata: stampSampleMeta(row.metadata, sample, { is_template: true }),
    updatedAt: now(),
  }).where(eq(schema.dramas.id, sourceId))
}

function cloneSampleDrama(sourceId: number, userId: number, sample: SampleDef, packVersion = 0): number {
  const ts = now()
  const src = db.select().from(schema.dramas).where(eq(schema.dramas.id, sourceId)).get()
  if (!src) throw new Error(`示例模板不存在: ${sourceId}`)

  const srcMeta = parseDramaMeta(src.metadata)
  const version = packVersion || Number(srcMeta.pack_version || 0)

  // better-sqlite3 事务回调必须同步；克隆结果不带 is_template
  const sampleMeta = JSON.stringify({
    is_sample: true,
    sample_key: sample.key,
    cloned_from: sourceId,
    pack_version: version,
  })

  return db.transaction((tx) => {
    const dramaRes = tx.insert(schema.dramas).values({
      userId,
      title: src.title,
      description: src.description,
      genre: src.genre,
      style: src.style,
      aspectRatio: src.aspectRatio,
      totalEpisodes: src.totalEpisodes,
      totalDuration: src.totalDuration,
      status: src.status || 'draft',
      thumbnail: src.thumbnail,
      tags: src.tags,
      metadata: sampleMeta,
      createdAt: ts,
      updatedAt: ts,
    }).run()
    const newDramaId = getInsertId(dramaRes)

    const epRows = tx.select().from(schema.episodes).where(and(
      eq(schema.episodes.dramaId, sourceId),
      isNull(schema.episodes.deletedAt),
    )).all()
    const epMap = new Map<number, number>()
    for (const ep of epRows) {
      const res = tx.insert(schema.episodes).values({
        dramaId: newDramaId,
        episodeNumber: ep.episodeNumber,
        title: ep.title,
        content: ep.content,
        scriptContent: ep.scriptContent,
        description: ep.description,
        duration: ep.duration,
        status: ep.status,
        videoUrl: ep.videoUrl,
        thumbnail: ep.thumbnail,
        imageConfigId: null,
        videoConfigId: null,
        resolution: ep.resolution,
        createdAt: ts,
        updatedAt: ts,
      }).run()
      epMap.set(ep.id, getInsertId(res))
    }

    const charRows = tx.select().from(schema.characters).where(and(
      eq(schema.characters.dramaId, sourceId),
      isNull(schema.characters.deletedAt),
    )).all()
    const charMap = new Map<number, number>()
    for (const ch of charRows) {
      const res = tx.insert(schema.characters).values({
        dramaId: newDramaId,
        name: ch.name,
        role: ch.role,
        description: ch.description,
        appearance: ch.appearance,
        styling: ch.styling,
        finalPrompt: ch.finalPrompt,
        personality: ch.personality,
        imageUrl: ch.imageUrl,
        referenceImages: ch.referenceImages,
        referenceAudios: ch.referenceAudios,
        voiceStyle: ch.voiceStyle,
        seedValue: ch.seedValue,
        sortOrder: ch.sortOrder,
        localPath: ch.localPath,
        createdAt: ts,
        updatedAt: ts,
      }).run()
      charMap.set(ch.id, getInsertId(res))
    }

    const variantMap = new Map<number, number>()
    for (const [oldCharId, newCharId] of charMap) {
      const variants = tx.select().from(schema.characterVariants).where(and(
        eq(schema.characterVariants.characterId, oldCharId),
        isNull(schema.characterVariants.deletedAt),
      )).all()
      for (const v of variants) {
        const res = tx.insert(schema.characterVariants).values({
          characterId: newCharId,
          label: v.label,
          imageUrl: v.imageUrl,
          localPath: v.localPath,
          finalPrompt: v.finalPrompt,
          source: v.source || 'archive',
          presetKey: v.presetKey,
          sortOrder: v.sortOrder,
          createdAt: ts,
          updatedAt: ts,
        }).run()
        variantMap.set(v.id, getInsertId(res))
      }
    }

    const sceneRows = tx.select().from(schema.scenes).where(and(
      eq(schema.scenes.dramaId, sourceId),
      isNull(schema.scenes.deletedAt),
    )).all()
    const sceneMap = new Map<number, number>()
    for (const sc of sceneRows) {
      const res = tx.insert(schema.scenes).values({
        dramaId: newDramaId,
        episodeId: sc.episodeId != null ? (epMap.get(sc.episodeId) ?? null) : null,
        location: sc.location,
        time: sc.time,
        prompt: sc.prompt,
        lighting: sc.lighting,
        finalPrompt: sc.finalPrompt,
        storyboardCount: sc.storyboardCount,
        imageUrl: sc.imageUrl,
        referenceImages: sc.referenceImages,
        status: sc.status,
        localPath: sc.localPath,
        createdAt: ts,
        updatedAt: ts,
      }).run()
      sceneMap.set(sc.id, getInsertId(res))
    }

    const propRows = tx.select().from(schema.props).where(and(
      eq(schema.props.dramaId, sourceId),
      isNull(schema.props.deletedAt),
    )).all()
    const propMap = new Map<number, number>()
    for (const pr of propRows) {
      const res = tx.insert(schema.props).values({
        dramaId: newDramaId,
        name: pr.name,
        type: pr.type,
        description: pr.description,
        prompt: pr.prompt,
        finalPrompt: pr.finalPrompt,
        imageUrl: pr.imageUrl,
        referenceImages: pr.referenceImages,
        localPath: pr.localPath,
        createdAt: ts,
        updatedAt: ts,
      }).run()
      propMap.set(pr.id, getInsertId(res))
    }

    for (const [oldEpId, newEpId] of epMap) {
      const links = tx.select().from(schema.episodeCharacters)
        .where(eq(schema.episodeCharacters.episodeId, oldEpId)).all()
      for (const link of links) {
        const newCharId = charMap.get(link.characterId)
        if (!newCharId) continue
        tx.insert(schema.episodeCharacters).values({
          episodeId: newEpId,
          characterId: newCharId,
          createdAt: ts,
        }).run()
      }

      const sceneLinks = tx.select().from(schema.episodeScenes)
        .where(eq(schema.episodeScenes.episodeId, oldEpId)).all()
      for (const link of sceneLinks) {
        const newSceneId = sceneMap.get(link.sceneId)
        if (!newSceneId) continue
        tx.insert(schema.episodeScenes).values({
          episodeId: newEpId,
          sceneId: newSceneId,
          createdAt: ts,
        }).run()
      }

      const propLinks = tx.select().from(schema.episodeProps)
        .where(eq(schema.episodeProps.episodeId, oldEpId)).all()
      for (const link of propLinks) {
        const newPropId = propMap.get(link.propId)
        if (!newPropId) continue
        tx.insert(schema.episodeProps).values({
          episodeId: newEpId,
          propId: newPropId,
          createdAt: ts,
        }).run()
      }
    }

    const sbMap = new Map<number, number>()
    for (const [oldEpId, newEpId] of epMap) {
      const sbs = tx.select().from(schema.storyboards).where(and(
        eq(schema.storyboards.episodeId, oldEpId),
        isNull(schema.storyboards.deletedAt),
      )).all()
      for (const sb of sbs) {
        const res = tx.insert(schema.storyboards).values({
          episodeId: newEpId,
          sceneId: sb.sceneId != null ? (sceneMap.get(sb.sceneId) ?? null) : null,
          storyboardNumber: sb.storyboardNumber,
          title: sb.title,
          location: sb.location,
          time: sb.time,
          shotType: sb.shotType,
          angle: sb.angle,
          movement: sb.movement,
          result: sb.result,
          atmosphere: sb.atmosphere,
          imagePrompt: sb.imagePrompt,
          videoPrompt: sb.videoPrompt,
          bgmPrompt: sb.bgmPrompt,
          soundEffect: sb.soundEffect,
          description: sb.description,
          duration: sb.duration,
          composedImage: sb.composedImage,
          firstFrameImage: sb.firstFrameImage,
          lastFrameImage: sb.lastFrameImage,
          referenceImages: sb.referenceImages,
          videoUrl: sb.videoUrl,
          subtitleUrl: sb.subtitleUrl,
          composedVideoUrl: sb.composedVideoUrl,
          status: sb.status,
          createdAt: ts,
          updatedAt: ts,
        }).run()
        sbMap.set(sb.id, getInsertId(res))
      }
    }

    for (const [oldSbId, newSbId] of sbMap) {
      const chars = tx.select().from(schema.storyboardCharacters)
        .where(eq(schema.storyboardCharacters.storyboardId, oldSbId)).all()
      for (const link of chars) {
        const newCharId = charMap.get(link.characterId)
        if (!newCharId) continue
        tx.insert(schema.storyboardCharacters).values({
          storyboardId: newSbId,
          characterId: newCharId,
          variantId: link.variantId != null ? (variantMap.get(link.variantId) ?? null) : null,
        }).run()
      }
      const props = tx.select().from(schema.storyboardProps)
        .where(eq(schema.storyboardProps.storyboardId, oldSbId)).all()
      for (const link of props) {
        const newPropId = propMap.get(link.propId)
        if (!newPropId) continue
        tx.insert(schema.storyboardProps).values({
          storyboardId: newSbId,
          propId: newPropId,
        }).run()
      }
    }

    const merges = tx.select().from(schema.videoMerges).where(and(
      eq(schema.videoMerges.dramaId, sourceId),
      isNull(schema.videoMerges.deletedAt),
    )).all()
    for (const m of merges) {
      tx.insert(schema.videoMerges).values({
        episodeId: m.episodeId != null ? (epMap.get(m.episodeId) ?? null) : null,
        dramaId: newDramaId,
        title: m.title,
        provider: m.provider,
        model: m.model,
        status: m.status,
        scenes: m.scenes,
        mergedUrl: m.mergedUrl,
        duration: m.duration,
        taskId: m.taskId,
        errorMsg: m.errorMsg,
        createdAt: m.createdAt || ts,
        completedAt: m.completedAt,
      }).run()
    }

    // 仅复制已完成任务，保留分镜视频历史；config 归属用户私有，置空
    const tasks = tx.select().from(schema.sysTask).where(eq(schema.sysTask.dramaId, sourceId)).all()
    for (const t of tasks) {
      if (t.status !== 'completed') continue
      tx.insert(schema.sysTask).values({
        configId: null,
        configBaseUrl: t.configBaseUrl,
        stage: t.stage,
        errorCode: t.errorCode,
        type: t.type,
        storyboardId: t.storyboardId != null ? (sbMap.get(t.storyboardId) ?? null) : null,
        dramaId: newDramaId,
        sceneId: t.sceneId != null ? (sceneMap.get(t.sceneId) ?? null) : null,
        characterId: t.characterId != null ? (charMap.get(t.characterId) ?? null) : null,
        propId: t.propId != null ? (propMap.get(t.propId) ?? null) : null,
        provider: t.provider,
        prompt: t.prompt,
        model: t.model,
        params: t.params,
        taskId: t.taskId,
        resultUrl: t.resultUrl,
        localPath: t.localPath,
        status: t.status,
        errorMsg: t.errorMsg,
        createdAt: t.createdAt || ts,
        updatedAt: t.updatedAt || ts,
        completedAt: t.completedAt,
      }).run()
    }

    return newDramaId
  })
}

async function dramaIdsHaveContent(ids: number[]): Promise<boolean> {
  for (const id of ids) {
    const eps = await db.select({ id: schema.episodes.id }).from(schema.episodes).where(and(
      eq(schema.episodes.dramaId, id),
      isNull(schema.episodes.deletedAt),
    ))
    if (eps.length) return true
    const chars = await db.select({ id: schema.characters.id }).from(schema.characters).where(and(
      eq(schema.characters.dramaId, id),
      isNull(schema.characters.deletedAt),
    ))
    if (chars.length) return true
  }
  return false
}

async function ensureOneSampleForUser(userId: number, sample: SampleDef, packVersion: number | null): Promise<void> {
  const state = await getUserSampleState(userId, sample)
  if (state.kind === 'retired') return

  const requiredVersion = packVersion || 0
  if (state.kind === 'ready') {
    const hasContent = await dramaIdsHaveContent(state.ids)
    const versionOk = !requiredVersion || state.version >= requiredVersion
    if (versionOk && hasContent) return
    // 包升级，或历史空壳副本：软删后按权威模板重发
    const ts = now()
    for (const id of state.ids) {
      await db.update(schema.dramas).set({ deletedAt: ts, updatedAt: ts }).where(eq(schema.dramas.id, id))
    }
  } else {
    // 仅当用户同名项目本身有内容时才打标复用；空壳同名不要挡住从模板克隆
    const titled = await db.select().from(schema.dramas).where(and(
      eq(schema.dramas.userId, userId),
      eq(schema.dramas.title, sample.title),
      isNull(schema.dramas.deletedAt),
    ))
    if (titled.length && await dramaIdsHaveContent(titled.map(r => r.id))) {
      await stampExistingTitleAsSample(userId, sample)
      return
    }
    if (titled.length) {
      const ts = now()
      for (const row of titled) {
        await db.update(schema.dramas).set({ deletedAt: ts, updatedAt: ts }).where(eq(schema.dramas.id, row.id))
      }
    }
  }

  const template = await resolveTemplateDrama(sample)
  if (!template) {
    console.warn(`[sample-drama] 未找到《${sample.title}》权威模板（需 is_template 或 sample-pack），跳过预置`)
    return
  }
  await markTemplate(template.id, sample)
  if (template.userId === userId) {
    // 模板所有者：若模板已有内容则只需打标；空壳模板不应在此短路
    if (await dramaIdsHaveContent([template.id])) {
      await stampExistingTitleAsSample(userId, sample)
      return
    }
  }
  const newId = cloneSampleDrama(template.id, userId, sample, requiredVersion || Number(parseDramaMeta(template.metadata).pack_version || 0))
  console.log(`[sample-drama] 已为用户 ${userId} 预置示例《${sample.title}》 #${newId} ← #${template.id}`)
}

/** 为指定用户确保各示例项目均已下发；无模板时静默跳过对应项 */
export async function ensureSampleDramaForUser(userId: number): Promise<void> {
  if (!isSaas() || !userId) return
  if (ensuringUsers.has(userId)) return
  ensuringUsers.add(userId)
  try {
    for (const sample of SAMPLE_DRAMAS) {
      try {
        // 有本地导出包则先同步媒体+模板（以包为准）
        const packVersion = await syncSamplePackToTemplate(sample)
        await ensureOneSampleForUser(userId, sample, packVersion)
      } catch (err: any) {
        console.error(`[sample-drama] 用户 ${userId} 预置《${sample.title}》失败:`, err?.message || err)
      }
    }
  } finally {
    ensuringUsers.delete(userId)
  }
}
