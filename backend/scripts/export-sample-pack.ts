/**
 * 导出示例项目权威包（本地资产/视频为准）
 *
 * 用法：
 *   npx tsx scripts/export-sample-pack.ts --title 灵环纪
 *   npx tsx scripts/export-sample-pack.ts --id 19 --key linghuan-ji
 */
import 'dotenv/config'
import { eq, isNull } from 'drizzle-orm'
import { db, schema } from '../src/db/index.js'
import { SAMPLE_DRAMAS } from '../src/services/sample-drama.js'
import { exportSamplePack, samplePackDir } from '../src/services/sample-pack.js'
import { now } from '../src/utils/response.js'

function arg(name: string): string | null {
  const i = process.argv.indexOf(name)
  if (i < 0) return null
  return process.argv[i + 1] || null
}

async function main() {
  const idArg = arg('--id')
  const titleArg = arg('--title')
  const keyArg = arg('--key')

  let dramaId = idArg ? Number(idArg) : NaN
  let sample = keyArg
    ? SAMPLE_DRAMAS.find(s => s.key === keyArg) || null
    : null

  if (!Number.isFinite(dramaId) || dramaId <= 0) {
    const title = titleArg || sample?.title
    if (!title) {
      console.error('请指定 --id 或 --title，可选 --key')
      process.exit(1)
    }
    const rows = db.select().from(schema.dramas).where(isNull(schema.dramas.deletedAt)).all()
      .filter(d => d.title === title)
      .sort((a, b) => a.id - b.id)
    if (!rows.length) {
      console.error(`未找到标题为《${title}》的项目`)
      process.exit(1)
    }
    dramaId = rows[0].id
    sample = sample || SAMPLE_DRAMAS.find(s => s.title === title) || {
      key: keyArg || title.toLowerCase().replace(/\s+/g, '-'),
      title,
    }
  }

  if (!sample) {
    const [row] = db.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId))
    if (!row) {
      console.error(`drama #${dramaId} 不存在`)
      process.exit(1)
    }
    sample = SAMPLE_DRAMAS.find(s => s.title === row.title) || {
      key: keyArg || `drama-${dramaId}`,
      title: row.title,
    }
  }

  const manifest = exportSamplePack({ dramaId, sample })

  // 将源项目标为权威模板，避免被同名落后副本抢模板位
  await db.update(schema.dramas).set({
    metadata: JSON.stringify({
      is_sample: true,
      is_template: true,
      sample_key: sample.key,
      pack_version: manifest.version,
      exported_at: manifest.exported_at,
    }),
    updatedAt: now(),
  }).where(eq(schema.dramas.id, dramaId))

  console.log(`已导出《${sample.title}》→ ${samplePackDir(sample.key)}`)
  console.log(`version=${manifest.version} media=${manifest.media.length} source=#${dramaId}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
