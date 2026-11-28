/**
 * 示例项目打包 / 安装：以导出包为权威源（本地导出 → 各环境安装），
 * 避免线上同名项目内容落后时被误当成模板克隆。
 *
 * 目录：
 *   ${LOTUS_DATA_DIR|data}/sample-packs/<key>/
 *     manifest.json
 *     files/<relative static path>...
 */
import fs from 'fs'
import path from 'path'
import { and, eq, isNull } from 'drizzle-orm'
import { db, getInsertId, schema } from '../db/index.js'
import { DATA_ROOT } from '../utils/paths.js'
import { now } from '../utils/response.js'

type SampleDef = { key: string; title: string; envVar?: string }

function parseDramaMeta(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {}
  try {
    const v = JSON.parse(raw)
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

export type SamplePackManifest = {
  key: string
  title: string
  version: number
  exported_at: string
  source_drama_id: number
  media: string[]
  drama: Record<string, unknown>
  episodes: Record<string, unknown>[]
  characters: Record<string, unknown>[]
  character_variants: Record<string, unknown>[]
  scenes: Record<string, unknown>[]
  props: Record<string, unknown>[]
  episode_characters: { episode_id: number; character_id: number }[]
  episode_scenes: { episode_id: number; scene_id: number }[]
  episode_props: { episode_id: number; prop_id: number }[]
  storyboards: Record<string, unknown>[]
  storyboard_characters: { storyboard_id: number; character_id: number; variant_id: number | null }[]
  storyboard_props: { storyboard_id: number; prop_id: number }[]
  video_merges: Record<string, unknown>[]
  sys_tasks: Record<string, unknown>[]
}

export function samplePacksRoot(): string {
  return process.env.SAMPLE_PACKS_DIR || path.join(DATA_ROOT, 'sample-packs')
}

export function samplePackDir(key: string): string {
  return path.join(samplePacksRoot(), key)
}

export function readSamplePackManifest(key: string): SamplePackManifest | null {
  const file = path.join(samplePackDir(key), 'manifest.json')
  if (!fs.existsSync(file)) return null
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as SamplePackManifest
  } catch {
    return null
  }
}

function collectMediaPaths(manifest: Omit<SamplePackManifest, 'media' | 'exported_at' | 'version'>): string[] {
  const out = new Set<string>()
  const add = (p?: unknown) => {
    if (typeof p === 'string' && p && !p.startsWith('http://') && !p.startsWith('https://') && !p.startsWith('data:')) {
      out.add(p.replace(/^\//, ''))
    }
  }
  const addJsonList = (raw?: unknown) => {
    if (!raw) return
    try {
      const v = typeof raw === 'string' ? JSON.parse(raw) : raw
      if (Array.isArray(v)) v.forEach(add)
    } catch { /* ignore */ }
  }

  add(manifest.drama.thumbnail)
  for (const row of manifest.characters) {
    add(row.imageUrl); add(row.localPath); addJsonList(row.referenceImages); addJsonList(row.referenceAudios)
  }
  for (const row of manifest.character_variants) {
    add(row.imageUrl); add(row.localPath)
  }
  for (const row of manifest.scenes) {
    add(row.imageUrl); add(row.localPath); addJsonList(row.referenceImages)
  }
  for (const row of manifest.props) {
    add(row.imageUrl); add(row.localPath); addJsonList(row.referenceImages)
  }
  for (const row of manifest.storyboards) {
    add(row.videoUrl); add(row.composedImage); add(row.firstFrameImage); add(row.lastFrameImage)
    add(row.subtitleUrl); add(row.composedVideoUrl); addJsonList(row.referenceImages)
  }
  for (const row of manifest.video_merges) add(row.mergedUrl)
  for (const row of manifest.sys_tasks) {
    add(row.resultUrl); add(row.localPath)
  }
  for (const ep of manifest.episodes) {
    add(ep.videoUrl); add(ep.thumbnail)
  }
  return [...out]
}

function copyFileEnsured(src: string, dest: string) {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(src, dest)
}

/** 从本地 drama 导出权威示例包（覆盖同 key 目录） */
export function exportSamplePack(opts: {
  dramaId: number
  sample: SampleDef
  version?: number
}): SamplePackManifest {
  const src = db.select().from(schema.dramas).where(eq(schema.dramas.id, opts.dramaId)).get()
  if (!src) throw new Error(`drama #${opts.dramaId} 不存在`)

  const episodes = db.select().from(schema.episodes).where(and(
    eq(schema.episodes.dramaId, opts.dramaId),
    isNull(schema.episodes.deletedAt),
  )).all()
  const epIds = episodes.map(e => e.id)

  const characters = db.select().from(schema.characters).where(and(
    eq(schema.characters.dramaId, opts.dramaId),
    isNull(schema.characters.deletedAt),
  )).all()
  const charIds = characters.map(c => c.id)

  const character_variants = charIds.length
    ? db.select().from(schema.characterVariants).where(isNull(schema.characterVariants.deletedAt)).all()
      .filter(v => charIds.includes(v.characterId))
    : []

  const scenes = db.select().from(schema.scenes).where(and(
    eq(schema.scenes.dramaId, opts.dramaId),
    isNull(schema.scenes.deletedAt),
  )).all()
  const props = db.select().from(schema.props).where(and(
    eq(schema.props.dramaId, opts.dramaId),
    isNull(schema.props.deletedAt),
  )).all()

  const episode_characters: SamplePackManifest['episode_characters'] = []
  const episode_scenes: SamplePackManifest['episode_scenes'] = []
  const episode_props: SamplePackManifest['episode_props'] = []
  for (const epId of epIds) {
    for (const link of db.select().from(schema.episodeCharacters).where(eq(schema.episodeCharacters.episodeId, epId)).all()) {
      episode_characters.push({ episode_id: link.episodeId, character_id: link.characterId })
    }
    for (const link of db.select().from(schema.episodeScenes).where(eq(schema.episodeScenes.episodeId, epId)).all()) {
      episode_scenes.push({ episode_id: link.episodeId, scene_id: link.sceneId })
    }
    for (const link of db.select().from(schema.episodeProps).where(eq(schema.episodeProps.episodeId, epId)).all()) {
      episode_props.push({ episode_id: link.episodeId, prop_id: link.propId })
    }
  }

  const storyboards = epIds.length
    ? db.select().from(schema.storyboards).where(isNull(schema.storyboards.deletedAt)).all()
      .filter(s => epIds.includes(s.episodeId!))
    : []
  const sbIds = storyboards.map(s => s.id)

  const storyboard_characters: SamplePackManifest['storyboard_characters'] = []
  const storyboard_props: SamplePackManifest['storyboard_props'] = []
  for (const sbId of sbIds) {
    for (const link of db.select().from(schema.storyboardCharacters).where(eq(schema.storyboardCharacters.storyboardId, sbId)).all()) {
      storyboard_characters.push({
        storyboard_id: link.storyboardId,
        character_id: link.characterId,
        variant_id: link.variantId ?? null,
      })
    }
    for (const link of db.select().from(schema.storyboardProps).where(eq(schema.storyboardProps.storyboardId, sbId)).all()) {
      storyboard_props.push({ storyboard_id: link.storyboardId, prop_id: link.propId })
    }
  }

  const video_merges = db.select().from(schema.videoMerges).where(and(
    eq(schema.videoMerges.dramaId, opts.dramaId),
    isNull(schema.videoMerges.deletedAt),
  )).all()

  const sys_tasks = db.select().from(schema.sysTask).where(eq(schema.sysTask.dramaId, opts.dramaId)).all()
    .filter(t => t.status === 'completed')

  const partial = {
    key: opts.sample.key,
    title: opts.sample.title,
    source_drama_id: opts.dramaId,
    drama: { ...src },
    episodes,
    characters,
    character_variants,
    scenes,
    props,
    episode_characters,
    episode_scenes,
    episode_props,
    storyboards,
    storyboard_characters,
    storyboard_props,
    video_merges,
    sys_tasks,
  }

  const media = collectMediaPaths(partial)
  const version = opts.version ?? Date.now()
  const manifest: SamplePackManifest = {
    ...partial,
    version,
    exported_at: new Date().toISOString(),
    media,
  }

  const packDir = samplePackDir(opts.sample.key)
  const filesDir = path.join(packDir, 'files')
  fs.rmSync(packDir, { recursive: true, force: true })
  fs.mkdirSync(filesDir, { recursive: true })

  const missing: string[] = []
  for (const rel of media) {
    const abs = path.isAbsolute(rel) ? rel : path.join(DATA_ROOT, rel)
    if (!fs.existsSync(abs)) {
      missing.push(rel)
      continue
    }
    copyFileEnsured(abs, path.join(filesDir, rel))
  }
  if (missing.length) {
    console.warn(`[sample-pack] 导出时缺失 ${missing.length} 个媒体文件（已跳过）`)
  }

  fs.writeFileSync(path.join(packDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
  return manifest
}

function resolveTemplateOwnerId(): number | null {
  const env = Number(process.env.SAMPLE_TEMPLATE_OWNER_ID || '')
  if (Number.isFinite(env) && env > 0) return env
  const admin = db.select().from(schema.users).where(eq(schema.users.role, 'admin')).all()[0]
  if (admin) return admin.id
  const any = db.select().from(schema.users).all()[0]
  return any?.id ?? null
}

function findTemplateRow(sampleKey: string) {
  const all = db.select().from(schema.dramas).where(isNull(schema.dramas.deletedAt)).all()
  return all.find(d => {
    const meta = parseDramaMeta(d.metadata)
    return meta.is_template === true && meta.sample_key === sampleKey
  }) || null
}

function softDeleteDramaTree(dramaId: number, ts: string) {
  db.update(schema.dramas).set({ deletedAt: ts, updatedAt: ts }).where(eq(schema.dramas.id, dramaId)).run()
  const eps = db.select().from(schema.episodes).where(eq(schema.episodes.dramaId, dramaId)).all()
  for (const ep of eps) {
    db.update(schema.episodes).set({ deletedAt: ts, updatedAt: ts }).where(eq(schema.episodes.id, ep.id)).run()
    const sbs = db.select().from(schema.storyboards).where(eq(schema.storyboards.episodeId, ep.id)).all()
    for (const sb of sbs) {
      db.update(schema.storyboards).set({ deletedAt: ts, updatedAt: ts }).where(eq(schema.storyboards.id, sb.id)).run()
    }
  }
  for (const ch of db.select().from(schema.characters).where(eq(schema.characters.dramaId, dramaId)).all()) {
    db.update(schema.characters).set({ deletedAt: ts }).where(eq(schema.characters.id, ch.id)).run()
    for (const v of db.select().from(schema.characterVariants).where(eq(schema.characterVariants.characterId, ch.id)).all()) {
      db.update(schema.characterVariants).set({ deletedAt: ts, updatedAt: ts }).where(eq(schema.characterVariants.id, v.id)).run()
    }
  }
  for (const sc of db.select().from(schema.scenes).where(eq(schema.scenes.dramaId, dramaId)).all()) {
    db.update(schema.scenes).set({ deletedAt: ts, updatedAt: ts }).where(eq(schema.scenes.id, sc.id)).run()
  }
  for (const pr of db.select().from(schema.props).where(eq(schema.props.dramaId, dramaId)).all()) {
    db.update(schema.props).set({ deletedAt: ts, updatedAt: ts }).where(eq(schema.props.id, pr.id)).run()
  }
  for (const m of db.select().from(schema.videoMerges).where(eq(schema.videoMerges.dramaId, dramaId)).all()) {
    db.update(schema.videoMerges).set({ deletedAt: ts }).where(eq(schema.videoMerges.id, m.id)).run()
  }
}

function materializePackMedia(manifest: SamplePackManifest) {
  const filesDir = path.join(samplePackDir(manifest.key), 'files')
  let copied = 0
  for (const rel of manifest.media || []) {
    const src = path.join(filesDir, rel)
    if (!fs.existsSync(src)) continue
    const dest = path.join(DATA_ROOT, rel)
    copyFileEnsured(src, dest)
    copied++
  }
  return copied
}

function importPackAsTemplate(manifest: SamplePackManifest, ownerId: number): number {
  const ts = now()
  const meta = JSON.stringify({
    is_sample: true,
    is_template: true,
    sample_key: manifest.key,
    pack_version: manifest.version,
    exported_at: manifest.exported_at,
  })

  return db.transaction((tx) => {
    const d = manifest.drama
    const dramaRes = tx.insert(schema.dramas).values({
      userId: ownerId,
      title: String(d.title || manifest.title),
      description: (d.description as string) || null,
      genre: (d.genre as string) || null,
      style: (d.style as string) || null,
      aspectRatio: (d.aspectRatio as string) || null,
      totalEpisodes: (d.totalEpisodes as number) || null,
      totalDuration: (d.totalDuration as number) || null,
      status: (d.status as string) || 'draft',
      thumbnail: (d.thumbnail as string) || null,
      tags: (d.tags as string) || null,
      metadata: meta,
      createdAt: ts,
      updatedAt: ts,
    }).run()
    const newDramaId = getInsertId(dramaRes)

    const epMap = new Map<number, number>()
    for (const ep of manifest.episodes) {
      const oldId = Number(ep.id)
      const res = tx.insert(schema.episodes).values({
        dramaId: newDramaId,
        episodeNumber: Number(ep.episodeNumber) || 1,
        title: (ep.title as string) || null,
        content: (ep.content as string) || null,
        scriptContent: (ep.scriptContent as string) || null,
        description: (ep.description as string) || null,
        duration: (ep.duration as number) || null,
        status: (ep.status as string) || null,
        videoUrl: (ep.videoUrl as string) || null,
        thumbnail: (ep.thumbnail as string) || null,
        imageConfigId: null,
        videoConfigId: null,
        resolution: (ep.resolution as string) || null,
        createdAt: ts,
        updatedAt: ts,
      }).run()
      epMap.set(oldId, getInsertId(res))
    }

    const charMap = new Map<number, number>()
    for (const ch of manifest.characters) {
      const oldId = Number(ch.id)
      const res = tx.insert(schema.characters).values({
        dramaId: newDramaId,
        name: String(ch.name || ''),
        role: (ch.role as string) || null,
        description: (ch.description as string) || null,
        appearance: (ch.appearance as string) || null,
        styling: (ch.styling as string) || null,
        finalPrompt: (ch.finalPrompt as string) || null,
        personality: (ch.personality as string) || null,
        imageUrl: (ch.imageUrl as string) || null,
        referenceImages: (ch.referenceImages as string) || null,
        referenceAudios: (ch.referenceAudios as string) || null,
        voiceStyle: (ch.voiceStyle as string) || null,
        seedValue: (ch.seedValue as string) || null,
        sortOrder: (ch.sortOrder as number) || 0,
        localPath: (ch.localPath as string) || null,
        createdAt: ts,
        updatedAt: ts,
      }).run()
      charMap.set(oldId, getInsertId(res))
    }

    const variantMap = new Map<number, number>()
    for (const v of manifest.character_variants) {
      const newCharId = charMap.get(Number(v.characterId))
      if (!newCharId) continue
      const res = tx.insert(schema.characterVariants).values({
        characterId: newCharId,
        label: String(v.label || '变体'),
        imageUrl: (v.imageUrl as string) || null,
        localPath: (v.localPath as string) || null,
        finalPrompt: (v.finalPrompt as string) || null,
        source: String(v.source || 'archive'),
        presetKey: (v.presetKey as string) || null,
        sortOrder: (v.sortOrder as number) || 0,
        createdAt: ts,
        updatedAt: ts,
      }).run()
      variantMap.set(Number(v.id), getInsertId(res))
    }

    const sceneMap = new Map<number, number>()
    for (const sc of manifest.scenes) {
      const oldId = Number(sc.id)
      const res = tx.insert(schema.scenes).values({
        dramaId: newDramaId,
        episodeId: sc.episodeId != null ? (epMap.get(Number(sc.episodeId)) ?? null) : null,
        location: (sc.location as string) || null,
        time: (sc.time as string) || null,
        prompt: (sc.prompt as string) || null,
        lighting: (sc.lighting as string) || null,
        finalPrompt: (sc.finalPrompt as string) || null,
        storyboardCount: (sc.storyboardCount as number) || null,
        imageUrl: (sc.imageUrl as string) || null,
        referenceImages: (sc.referenceImages as string) || null,
        status: (sc.status as string) || null,
        localPath: (sc.localPath as string) || null,
        createdAt: ts,
        updatedAt: ts,
      }).run()
      sceneMap.set(oldId, getInsertId(res))
    }

    const propMap = new Map<number, number>()
    for (const pr of manifest.props) {
      const oldId = Number(pr.id)
      const res = tx.insert(schema.props).values({
        dramaId: newDramaId,
        name: String(pr.name || ''),
        type: (pr.type as string) || null,
        description: (pr.description as string) || null,
        prompt: (pr.prompt as string) || null,
        finalPrompt: (pr.finalPrompt as string) || null,
        imageUrl: (pr.imageUrl as string) || null,
        referenceImages: (pr.referenceImages as string) || null,
        localPath: (pr.localPath as string) || null,
        createdAt: ts,
        updatedAt: ts,
      }).run()
      propMap.set(oldId, getInsertId(res))
    }

    for (const link of manifest.episode_characters) {
      const newEp = epMap.get(link.episode_id)
      const newChar = charMap.get(link.character_id)
      if (!newEp || !newChar) continue
      tx.insert(schema.episodeCharacters).values({ episodeId: newEp, characterId: newChar, createdAt: ts }).run()
    }
    for (const link of manifest.episode_scenes) {
      const newEp = epMap.get(link.episode_id)
      const newScene = sceneMap.get(link.scene_id)
      if (!newEp || !newScene) continue
      tx.insert(schema.episodeScenes).values({ episodeId: newEp, sceneId: newScene, createdAt: ts }).run()
    }
    for (const link of manifest.episode_props) {
      const newEp = epMap.get(link.episode_id)
      const newProp = propMap.get(link.prop_id)
      if (!newEp || !newProp) continue
      tx.insert(schema.episodeProps).values({ episodeId: newEp, propId: newProp, createdAt: ts }).run()
    }

    const sbMap = new Map<number, number>()
    for (const sb of manifest.storyboards) {
      const newEp = epMap.get(Number(sb.episodeId))
      if (!newEp) continue
      const res = tx.insert(schema.storyboards).values({
        episodeId: newEp,
        sceneId: sb.sceneId != null ? (sceneMap.get(Number(sb.sceneId)) ?? null) : null,
        storyboardNumber: Number(sb.storyboardNumber) || 0,
        title: (sb.title as string) || null,
        location: (sb.location as string) || null,
        time: (sb.time as string) || null,
        shotType: (sb.shotType as string) || null,
        angle: (sb.angle as string) || null,
        movement: (sb.movement as string) || null,
        result: (sb.result as string) || null,
        atmosphere: (sb.atmosphere as string) || null,
        imagePrompt: (sb.imagePrompt as string) || null,
        videoPrompt: (sb.videoPrompt as string) || null,
        bgmPrompt: (sb.bgmPrompt as string) || null,
        soundEffect: (sb.soundEffect as string) || null,
        description: (sb.description as string) || null,
        duration: (sb.duration as number) || null,
        composedImage: (sb.composedImage as string) || null,
        firstFrameImage: (sb.firstFrameImage as string) || null,
        lastFrameImage: (sb.lastFrameImage as string) || null,
        referenceImages: (sb.referenceImages as string) || null,
        videoUrl: (sb.videoUrl as string) || null,
        subtitleUrl: (sb.subtitleUrl as string) || null,
        composedVideoUrl: (sb.composedVideoUrl as string) || null,
        status: (sb.status as string) || null,
        createdAt: ts,
        updatedAt: ts,
      }).run()
      sbMap.set(Number(sb.id), getInsertId(res))
    }

    for (const link of manifest.storyboard_characters) {
      const newSb = sbMap.get(link.storyboard_id)
      const newChar = charMap.get(link.character_id)
      if (!newSb || !newChar) continue
      tx.insert(schema.storyboardCharacters).values({
        storyboardId: newSb,
        characterId: newChar,
        variantId: link.variant_id != null ? (variantMap.get(link.variant_id) ?? null) : null,
      }).run()
    }
    for (const link of manifest.storyboard_props) {
      const newSb = sbMap.get(link.storyboard_id)
      const newProp = propMap.get(link.prop_id)
      if (!newSb || !newProp) continue
      tx.insert(schema.storyboardProps).values({ storyboardId: newSb, propId: newProp }).run()
    }

    for (const m of manifest.video_merges) {
      tx.insert(schema.videoMerges).values({
        episodeId: m.episodeId != null ? (epMap.get(Number(m.episodeId)) ?? null) : null,
        dramaId: newDramaId,
        title: (m.title as string) || null,
        provider: String(m.provider || 'ffmpeg'),
        model: String(m.model || 'concat'),
        status: (m.status as string) || 'completed',
        scenes: (m.scenes as string) || null,
        mergedUrl: (m.mergedUrl as string) || null,
        duration: (m.duration as number) || null,
        taskId: (m.taskId as string) || null,
        errorMsg: (m.errorMsg as string) || null,
        createdAt: (m.createdAt as string) || ts,
        completedAt: (m.completedAt as string) || null,
      }).run()
    }

    for (const t of manifest.sys_tasks) {
      if (t.status !== 'completed') continue
      tx.insert(schema.sysTask).values({
        configId: null,
        configBaseUrl: (t.configBaseUrl as string) || null,
        stage: (t.stage as string) || null,
        errorCode: (t.errorCode as string) || null,
        type: String(t.type || 'video'),
        storyboardId: t.storyboardId != null ? (sbMap.get(Number(t.storyboardId)) ?? null) : null,
        dramaId: newDramaId,
        sceneId: t.sceneId != null ? (sceneMap.get(Number(t.sceneId)) ?? null) : null,
        characterId: t.characterId != null ? (charMap.get(Number(t.characterId)) ?? null) : null,
        propId: t.propId != null ? (propMap.get(Number(t.propId)) ?? null) : null,
        provider: (t.provider as string) || null,
        prompt: (t.prompt as string) || null,
        model: (t.model as string) || null,
        params: (t.params as string) || null,
        taskId: (t.taskId as string) || null,
        resultUrl: (t.resultUrl as string) || null,
        localPath: (t.localPath as string) || null,
        status: 'completed',
        errorMsg: (t.errorMsg as string) || null,
        createdAt: (t.createdAt as string) || ts,
        updatedAt: (t.updatedAt as string) || ts,
        completedAt: (t.completedAt as string) || null,
      }).run()
    }

    return newDramaId
  })
}

function dramaHasRows(dramaId: number): boolean {
  const eps = db.select({ id: schema.episodes.id }).from(schema.episodes).where(and(
    eq(schema.episodes.dramaId, dramaId),
    isNull(schema.episodes.deletedAt),
  )).all()
  if (eps.length) return true
  const chars = db.select({ id: schema.characters.id }).from(schema.characters).where(and(
    eq(schema.characters.dramaId, dramaId),
    isNull(schema.characters.deletedAt),
  )).all()
  if (chars.length) return true
  const scenes = db.select({ id: schema.scenes.id }).from(schema.scenes).where(and(
    eq(schema.scenes.dramaId, dramaId),
    isNull(schema.scenes.deletedAt),
  )).all()
  return scenes.length > 0
}

function packHasContent(manifest: SamplePackManifest): boolean {
  return (manifest.episodes?.length || 0) > 0
    || (manifest.characters?.length || 0) > 0
    || (manifest.scenes?.length || 0) > 0
    || (manifest.storyboards?.length || 0) > 0
}

/**
 * 若存在示例包：覆盖写入媒体，并保证库内模板行与包版本一致（过期/空壳则重建模板）。
 * 返回当前权威 pack_version；无包时返回 null。
 */
export async function syncSamplePackToTemplate(sample: SampleDef): Promise<number | null> {
  const manifest = readSamplePackManifest(sample.key)
  if (!manifest) return null

  const copied = materializePackMedia(manifest)
  const existing = findTemplateRow(sample.key)
  const existingVer = existing ? Number(parseDramaMeta(existing.metadata).pack_version || 0) : 0
  const existingEmpty = existing ? !dramaHasRows(existing.id) : false
  const needRebuildEmpty = !!(existing && existingEmpty && packHasContent(manifest))

  if (existing && existingVer >= manifest.version && !needRebuildEmpty) {
    // 媒体已按包覆盖；模板元数据保持
    if (copied) console.log(`[sample-pack] 《${sample.title}》媒体已按本地包同步 (${copied} 个文件)`)
    return manifest.version
  }

  const ownerId = existing?.userId || resolveTemplateOwnerId()
  if (!ownerId) {
    console.warn(`[sample-pack] 无可用用户，无法安装《${sample.title}》模板`)
    return null
  }

  const ts = now()
  if (existing) {
    softDeleteDramaTree(existing.id, ts)
    if (needRebuildEmpty) {
      console.warn(`[sample-pack] 《${sample.title}》模板 #${existing.id} 为空壳，按本地包重建`)
    }
  }

  // 同源本地工程：仅当该剧本身已有内容时才打标复用。
  // 禁止仅凭同名/同 id 打标——线上常有空壳同名项目，id 也可能碰巧撞上导出源 id。
  if (!existing) {
    const byTitle = db.select().from(schema.dramas).where(and(
      eq(schema.dramas.title, sample.title),
      isNull(schema.dramas.deletedAt),
    )).all().sort((a, b) => a.id - b.id)[0]
    if (
      byTitle
      && byTitle.userId === ownerId
      && Number(byTitle.id) === Number(manifest.source_drama_id)
      && dramaHasRows(byTitle.id)
    ) {
      db.update(schema.dramas).set({
        metadata: JSON.stringify({
          ...parseDramaMeta(byTitle.metadata),
          is_sample: true,
          is_template: true,
          sample_key: sample.key,
          pack_version: manifest.version,
          exported_at: manifest.exported_at,
        }),
        updatedAt: ts,
      }).where(eq(schema.dramas.id, byTitle.id)).run()
      console.log(`[sample-pack] 已将本地 #${byTitle.id}《${sample.title}》标为权威模板 v${manifest.version}`)
      return manifest.version
    }
  }

  const newId = importPackAsTemplate(manifest, ownerId)
  console.log(`[sample-pack] 已从本地包安装《${sample.title}》模板 #${newId} v${manifest.version}`)
  return manifest.version
}
