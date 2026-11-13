/**
 * SaaS 示例项目：每个账号预置《一品布衣》，角标「示例」，用户可自行删除。
 * - 媒体文件共享同一 static 路径，只复制数据库行并重映射 ID
 * - 若用户曾拥有同 sample_key（含软删），不再重复下发
 */
import { and, eq, isNull } from 'drizzle-orm'
import { isSaas } from '../config/mode.js'
import { db, getInsertId, schema } from '../db/index.js'
import { now } from '../utils/response.js'

export const SAMPLE_KEY = 'yipin-buyi'
export const SAMPLE_TITLE = '一品布衣'

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
  return meta.is_sample === true || meta.sample_key === SAMPLE_KEY
}

function stampSampleMeta(raw: string | null | undefined, extra: Meta = {}): string {
  return JSON.stringify({
    ...parseDramaMeta(raw),
    is_sample: true,
    sample_key: SAMPLE_KEY,
    ...extra,
  })
}

function envTemplateId(): number | null {
  const n = Number(process.env.SAMPLE_DRAMA_ID || '')
  return Number.isFinite(n) && n > 0 ? n : null
}

/** 解析示例模板源（优先环境变量，其次 metadata.is_template，再次标题匹配） */
async function resolveTemplateDrama() {
  const preferred = envTemplateId()
  if (preferred) {
    const [row] = await db.select().from(schema.dramas).where(eq(schema.dramas.id, preferred))
    if (row) return row
  }

  const all = await db.select().from(schema.dramas)
  const byFlag = all.find(d => parseDramaMeta(d.metadata).is_template === true)
  if (byFlag) return byFlag

  const byTitle = all
    .filter(d => !d.deletedAt && d.title === SAMPLE_TITLE)
    .sort((a, b) => a.id - b.id)[0]
  return byTitle || null
}

async function userHasSampleSeed(userId: number): Promise<boolean> {
  const rows = await db.select({
    id: schema.dramas.id,
    metadata: schema.dramas.metadata,
  }).from(schema.dramas).where(eq(schema.dramas.userId, userId))
  return rows.some(r => parseDramaMeta(r.metadata).sample_key === SAMPLE_KEY)
}

async function stampExistingTitleAsSample(userId: number): Promise<boolean> {
  const rows = await db.select().from(schema.dramas).where(and(
    eq(schema.dramas.userId, userId),
    eq(schema.dramas.title, SAMPLE_TITLE),
    isNull(schema.dramas.deletedAt),
  ))
  if (!rows.length) return false
  for (const row of rows) {
    await db.update(schema.dramas).set({
      metadata: stampSampleMeta(row.metadata),
      updatedAt: now(),
    }).where(eq(schema.dramas.id, row.id))
  }
  return true
}

async function markTemplate(sourceId: number) {
  const [row] = await db.select().from(schema.dramas).where(eq(schema.dramas.id, sourceId))
  if (!row) return
  const meta = parseDramaMeta(row.metadata)
  if (meta.is_template === true && meta.sample_key === SAMPLE_KEY) return
  await db.update(schema.dramas).set({
    metadata: stampSampleMeta(row.metadata, { is_template: true }),
    updatedAt: now(),
  }).where(eq(schema.dramas.id, sourceId))
}

function cloneSampleDrama(sourceId: number, userId: number): number {
  const ts = now()
  const src = db.select().from(schema.dramas).where(eq(schema.dramas.id, sourceId)).get()
  if (!src) throw new Error(`示例模板不存在: ${sourceId}`)

  // better-sqlite3 事务回调必须同步；克隆结果不带 is_template
  const sampleMeta = JSON.stringify({
    is_sample: true,
    sample_key: SAMPLE_KEY,
    cloned_from: sourceId,
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
        seedValue: ch.seedValue,
        sortOrder: ch.sortOrder,
        localPath: ch.localPath,
        createdAt: ts,
        updatedAt: ts,
      }).run()
      charMap.set(ch.id, getInsertId(res))
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
          variantId: null,
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

/** 为指定用户确保有一份可删的示例项目；无模板时静默跳过 */
export async function ensureSampleDramaForUser(userId: number): Promise<void> {
  if (!isSaas() || !userId) return
  if (ensuringUsers.has(userId)) return
  ensuringUsers.add(userId)
  try {
    if (await userHasSampleSeed(userId)) return
    if (await stampExistingTitleAsSample(userId)) return

    const template = await resolveTemplateDrama()
    if (!template) {
      console.warn('[sample-drama] 未找到《一品布衣》模板，跳过预置')
      return
    }
    await markTemplate(template.id)
    // 模板归属当前用户时，上面 stamp 已处理；仍可能是别的账号的模板
    if (template.userId === userId) {
      await stampExistingTitleAsSample(userId)
      return
    }
    const newId = await cloneSampleDrama(template.id, userId)
    console.log(`[sample-drama] 已为用户 ${userId} 预置示例项目 #${newId} ← #${template.id}`)
  } catch (err: any) {
    console.error(`[sample-drama] 用户 ${userId} 预置失败:`, err?.message || err)
  } finally {
    ensuringUsers.delete(userId)
  }
}
