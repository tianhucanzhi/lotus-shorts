/**
 * FFmpeg 多镜头拼接 — 将所有生成后的镜头视频拼接为一集
 */
import fs from 'fs'
import path from 'path'
import { v4 as uuid } from 'uuid'
import { db, getInsertId, schema } from '../db/index.js'
import { eq } from 'drizzle-orm'
import { now } from '../utils/response.js'
import { logTaskError, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'
import { extractVideoPoster } from '../utils/video-poster.js'
import { ffmpeg, checkFfmpegSuite } from '../utils/ffmpeg.js'
import { DATA_ROOT, STORAGE_ROOT } from '../utils/paths.js'

function toAbsPath(relativePath: string): string {
  if (path.isAbsolute(relativePath)) return relativePath
  if (relativePath.startsWith('static/')) return path.join(DATA_ROOT, relativePath)
  return path.join(STORAGE_ROOT, relativePath)
}

/**
 * 拼接一集的镜头视频。
 * 优先使用视频生成产物，兼容历史的 composedVideoUrl 数据。
 * 传入 storyboardIds 时只拼接所选镜头（仍按镜号顺序）。
 */
export async function mergeEpisodeVideos(episodeId: number, dramaId: number, storyboardIds?: number[]): Promise<number> {
  let storyboards = await db.select().from(schema.storyboards)
    .where(eq(schema.storyboards.episodeId, episodeId))
    .orderBy(schema.storyboards.storyboardNumber)

  if (storyboardIds?.length) {
    const allow = new Set(storyboardIds.map(Number))
    storyboards = storyboards.filter(sb => allow.has(sb.id))
  }

  // 允许部分拼接:按镜号顺序拼接已生成的镜头,未生成的跳过
  const clips = storyboards
    .map(sb => ({ sb, url: sb.videoUrl || sb.composedVideoUrl }))
    .filter(c => Boolean(c.url)) as { sb: typeof storyboards[number]; url: string }[]

  if (clips.length === 0) throw new Error('所选镜头还没有可拼接的视频')

  // 拼接前探测 ffmpeg：二进制损坏时 fluent-ffmpeg 的同步 EFTYPE 会崩掉整个进程，
  // 这里提前拦截并给出可操作的修复指引（路由层会作为 400 返回前端）
  const suite = await checkFfmpegSuite()
  if (!suite.ffmpeg || !suite.ffprobe) {
    throw new Error('本机 ffmpeg 不可用，无法拼接视频（常见于 node_modules 跨平台拷贝或 ffmpeg-static 下载损坏）。请删除 node_modules 后在本机重新 npm install，或设置 FFMPEG_BIN 指向有效的 ffmpeg 可执行文件后重启服务')
  }

  // 校验视频文件真实存在:DB 里的 video_url 可能指向已被清理的文件,
  // 直接拼会得到 ffmpeg 的 "No such file or directory" 晦涩报错
  const missing = clips.filter(c => !fs.existsSync(toAbsPath(c.url)))
  if (missing.length > 0) {
    const nums = missing.map(c => `S${c.sb.storyboardNumber}`).join('、')
    throw new Error(`镜头 ${nums} 的视频文件已丢失（本地文件不存在），请重新生成这些镜头的视频，或在拼接时取消勾选`)
  }

  const videos = clips.map(c => c.url)

  logTaskStart('MergeTask', 'episode-merge', { episodeId, dramaId, clips: videos.length })

  // 创建 merge 记录
  const ts = now()
  const res = await db.insert(schema.videoMerges).values({
    episodeId,
    dramaId,
    title: `Episode ${episodeId} Merge`,
    provider: 'ffmpeg',
    model: 'ffmpeg-concat-h264-aac',
    status: 'processing',
    scenes: JSON.stringify(videos),
    createdAt: ts,
  })
  const mergeId = getInsertId(res)

  // 异步执行
  doMerge(mergeId, episodeId, videos).catch(async err => {
    logTaskError('MergeTask', 'episode-merge', { mergeId, episodeId, error: err.message })
    console.error(`[Merge] Failed:`, err)
    await db.update(schema.videoMerges)
      .set({ status: 'failed', errorMsg: err.message })
      .where(eq(schema.videoMerges.id, mergeId))
  })

  return mergeId
}

async function probeMedia(filePath: string): Promise<{ hasAudio: boolean; duration: number }> {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) { resolve({ hasAudio: false, duration: 0 }); return }
      const hasAudio = (metadata.streams || []).some(s => s.codec_type === 'audio')
      const duration = Number(metadata.format?.duration) || 0
      resolve({ hasAudio, duration })
    })
  })
}

async function doMerge(mergeId: number, episodeId: number, videos: string[]) {
  // 不用 concat demuxer：各镜头 time_base 常不一致（如 1/12288 vs 1/90000），
  // 再叠加 +genpts 会把视频轨时间戳拉飞（音频仍正确、成片显示成数倍时长）。
  // 改为 filter_complex concat，统一 fps / 采样率并重置 PTS。
  const absVideos = videos.map(toAbsPath)
  const n = absVideos.length
  const mediaMeta = await Promise.all(absVideos.map(probeMedia))

  const outputDir = path.join(STORAGE_ROOT, 'merged')
  fs.mkdirSync(outputDir, { recursive: true })
  const outputFilename = `${uuid()}.mp4`
  const outputPath = path.join(outputDir, outputFilename)

  const filterParts: string[] = []
  const concatPads: string[] = []
  let lavfiCount = 0
  for (let i = 0; i < n; i++) {
    filterParts.push(
      `[${i}:v]fps=24,format=yuv420p,settb=AVTB,setpts=PTS-STARTPTS[v${i}]`,
    )
    if (mediaMeta[i].hasAudio) {
      filterParts.push(
        `[${i}:a]aformat=sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS[a${i}]`,
      )
    } else {
      // 无音轨：按镜头时长生成有限静音（input 接在实体文件后）
      const silentIdx = n + lavfiCount
      lavfiCount += 1
      filterParts.push(
        `[${silentIdx}:a]aformat=sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS[a${i}]`,
      )
    }
    concatPads.push(`[v${i}][a${i}]`)
  }
  const filterComplex = `${filterParts.join(';')};${concatPads.join('')}concat=n=${n}:v=1:a=1[v][a]`

  await new Promise<void>((resolve, reject) => {
    let cmd = ffmpeg()
    for (const abs of absVideos) cmd = cmd.input(abs)
    for (let i = 0; i < n; i++) {
      if (mediaMeta[i].hasAudio) continue
      const dur = Math.max(0.1, mediaMeta[i].duration || 1)
      cmd = cmd
        .input(`anullsrc=channel_layout=stereo:sample_rate=48000`)
        .inputOptions(['-f', 'lavfi', '-t', String(dur)])
    }
    cmd
      .complexFilter(filterComplex)
      .outputOptions([
        '-map', '[v]',
        '-map', '[a]',
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-crf', '23',
        '-c:a', 'aac',
        '-ar', '48000',
        '-b:a', '192k',
        '-movflags', '+faststart',
      ])
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .run()
  })

  // 获取时长：以音视频较短者为准，避免异常时间戳虚高
  const duration = await getMergedDuration(outputPath)

  const mergedRelative = `static/merged/${outputFilename}`

  // 成片海报帧（导出页封面用）
  await extractVideoPoster(mergedRelative)

  // 更新 merge 记录
  await db.update(schema.videoMerges)
    .set({ status: 'completed', mergedUrl: mergedRelative, duration, completedAt: now() })
    .where(eq(schema.videoMerges.id, mergeId))

  // 更新 episode
  await db.update(schema.episodes)
    .set({ videoUrl: mergedRelative, updatedAt: now() })
    .where(eq(schema.episodes.id, episodeId))

  logTaskSuccess('MergeTask', 'episode-merge', { mergeId, episodeId, output: mergedRelative, duration, clips: videos.length })
}

function getVideoDuration(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) { resolve(0); return }
      resolve(Math.round(metadata.format.duration || 0))
    })
  })
}

/** 成片时长：取 format / 视频轨 / 音频轨中合理的较短值，防止时间戳异常虚高 */
function getMergedDuration(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) { resolve(0); return }
      const formatDur = Number(metadata.format?.duration) || 0
      const streamDurs = (metadata.streams || [])
        .map(s => Number(s.duration) || 0)
        .filter(d => d > 0)
      const candidates = [formatDur, ...streamDurs].filter(d => d > 0)
      if (!candidates.length) { resolve(0); return }
      const shortest = Math.min(...candidates)
      // 若 format 明显长于音轨（常见于错误 PTS），采用最短流
      resolve(Math.round(shortest))
    })
  })
}
