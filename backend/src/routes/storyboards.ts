import { Hono } from 'hono'
import type { AuthVariables } from '../middleware/auth.js'
import { denyUnlessEpisodeOwner, denyUnlessStoryboardOwner } from '../services/access.js'
import { eq } from 'drizzle-orm'
import { db, getInsertId, schema } from '../db/index.js'
import { success, created, now, badRequest } from '../utils/response.js'
import { toSnakeCase } from '../utils/transform.js'
import { logTaskPayload, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'
import {
  getStoryboardCharacterIds,
  getStoryboardCharacterVariantMap,
  syncStoryboardCharacterVariants,
  syncStoryboardCharacters,
} from '../services/storyboard-bindings.js'

const app = new Hono<{ Variables: AuthVariables }>()

async function syncStoryboardProps(storyboardId: number, propIds: number[]) {
  await db.delete(schema.storyboardProps)
    .where(eq(schema.storyboardProps.storyboardId, storyboardId))

  const uniqueIds = [...new Set((propIds || []).filter(Boolean))]
  if (!uniqueIds.length) return

  for (const propId of uniqueIds) {
    await db.insert(schema.storyboardProps).values({
      storyboardId,
      propId,
    })
  }
}

async function getStoryboardPropIds(storyboardId: number) {
  const links = await db.select().from(schema.storyboardProps)
    .where(eq(schema.storyboardProps.storyboardId, storyboardId))
  return links.map(link => link.propId)
}

async function validateStoryboardBindings(episodeId: number, sceneId: number | null | undefined, characterIds: number[] | undefined, propIds?: number[] | undefined) {
  const sceneLinks = await db.select().from(schema.episodeScenes)
    .where(eq(schema.episodeScenes.episodeId, episodeId))
  const episodeSceneIds = new Set(sceneLinks.map(link => link.sceneId))
  const characterLinks = await db.select().from(schema.episodeCharacters)
    .where(eq(schema.episodeCharacters.episodeId, episodeId))
  const episodeCharacterIds = new Set(characterLinks.map(link => link.characterId))
  const propLinks = await db.select().from(schema.episodeProps)
    .where(eq(schema.episodeProps.episodeId, episodeId))
  const episodePropIds = new Set(propLinks.map(link => link.propId))

  if (sceneId != null && !episodeSceneIds.has(sceneId)) {
    throw new Error('scene_id 必须来自当前集已关联场景')
  }

  const invalidCharacterIds = (characterIds || []).filter(id => !episodeCharacterIds.has(id))
  if (invalidCharacterIds.length) {
    throw new Error('character_ids 必须来自当前集已关联角色')
  }

  const invalidPropIds = (propIds || []).filter(id => !episodePropIds.has(id))
  if (invalidPropIds.length) {
    throw new Error('prop_ids 必须来自当前集已关联道具')
  }
}

// POST /storyboards
app.post('/', async (c) => {
  const body = await c.req.json()
  const deniedEp = await denyUnlessEpisodeOwner(c, Number(body.episode_id))
  if (deniedEp) return deniedEp
  const ts = now()
  logTaskStart('StoryboardAPI', 'create', {
    episodeId: body.episode_id,
    shotNumber: body.storyboard_number || 1,
    sceneId: body.scene_id,
    characterIds: body.character_ids,
  })
  logTaskPayload('StoryboardAPI', 'create body', body)
  await validateStoryboardBindings(body.episode_id, body.scene_id, body.character_ids, body.prop_ids)
  const res = await db.insert(schema.storyboards).values({
    episodeId: body.episode_id,
    storyboardNumber: body.storyboard_number || 1,
    title: body.title,
    description: body.description,
    sceneId: body.scene_id,
    duration: body.duration || 10,
    createdAt: ts,
    updatedAt: ts,
  })
  const newId = getInsertId(res)
  await syncStoryboardCharacters(newId, body.character_ids || [], body.character_variant_map)
  await syncStoryboardProps(newId, body.prop_ids || [])
  const [result] = await db.select().from(schema.storyboards)
    .where(eq(schema.storyboards.id, newId))
  logTaskSuccess('StoryboardAPI', 'create', {
    storyboardId: result.id,
    episodeId: result.episodeId,
    shotNumber: result.storyboardNumber,
  })
  return created(c, {
    ...toSnakeCase(result),
    character_ids: await getStoryboardCharacterIds(result.id),
    character_variant_map: await getStoryboardCharacterVariantMap(result.id),
    prop_ids: await getStoryboardPropIds(result.id),
  })
})

// PUT /storyboards/:id
app.put('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const denied = await denyUnlessStoryboardOwner(c, id)
  if (denied) return denied
  const body = await c.req.json()
  const [storyboard] = await db.select().from(schema.storyboards).where(eq(schema.storyboards.id, id))
  if (!storyboard) return badRequest(c, '镜头不存在')
  logTaskStart('StoryboardAPI', 'update', {
    storyboardId: id,
    episodeId: storyboard.episodeId,
    fields: Object.keys(body),
  })
  logTaskPayload('StoryboardAPI', 'update body', body)

  const fieldMap: Record<string, string> = {
    title: 'title', description: 'description', shot_type: 'shotType',
    angle: 'angle', movement: 'movement', duration: 'duration',
    video_prompt: 'videoPrompt',
    image_prompt: 'imagePrompt', scene_id: 'sceneId', location: 'location',
    time: 'time', atmosphere: 'atmosphere', result: 'result',
    bgm_prompt: 'bgmPrompt', sound_effect: 'soundEffect',
    video_url: 'videoUrl',
  }

  const updates: Record<string, any> = { updatedAt: now() }
  for (const [snakeKey, camelKey] of Object.entries(fieldMap)) {
    if (snakeKey in body) updates[camelKey] = body[snakeKey]
  }

  await validateStoryboardBindings(
    storyboard.episodeId,
    'scene_id' in body ? body.scene_id : storyboard.sceneId,
    'character_ids' in body ? body.character_ids : await getStoryboardCharacterIds(id),
    'prop_ids' in body ? body.prop_ids : await getStoryboardPropIds(id),
  )

  await db.update(schema.storyboards).set(updates).where(eq(schema.storyboards.id, id))
  if ('character_ids' in body) {
    await syncStoryboardCharacters(id, body.character_ids || [], body.character_variant_map)
  } else if ('character_variant_map' in body) {
    await syncStoryboardCharacterVariants(id, body.character_variant_map)
  }
  if ('prop_ids' in body) await syncStoryboardProps(id, body.prop_ids || [])
  logTaskSuccess('StoryboardAPI', 'update', {
    storyboardId: id,
    updatedFields: Object.keys(updates),
    characterIds: body.character_ids,
    propIds: body.prop_ids,
  })
  return success(c)
})

// DELETE /storyboards/:id
app.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const denied = await denyUnlessStoryboardOwner(c, id)
  if (denied) return denied
  logTaskStart('StoryboardAPI', 'delete', { storyboardId: id })
  await db.delete(schema.storyboardCharacters).where(eq(schema.storyboardCharacters.storyboardId, id))
  await db.delete(schema.storyboardProps).where(eq(schema.storyboardProps.storyboardId, id))
  await db.delete(schema.storyboards).where(eq(schema.storyboards.id, id))
  logTaskSuccess('StoryboardAPI', 'delete', { storyboardId: id })
  return success(c)
})

export default app
