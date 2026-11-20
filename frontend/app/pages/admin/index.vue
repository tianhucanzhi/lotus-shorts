<template>
  <div class="panel">
    <div v-if="overview" class="stats">
      <div class="stat"><span>{{ t('admin.stats.users') }}</span><strong>{{ overview.users.total }}</strong></div>
      <div class="stat"><span>{{ t('admin.stats.admins') }}</span><strong>{{ overview.users.admins }}</strong></div>
      <div class="stat"><span>{{ t('admin.stats.projects') }}</span><strong>{{ overview.dramas.total }}</strong></div>
      <div class="stat"><span>{{ t('admin.stats.episodes') }}</span><strong>{{ overview.episodes }}</strong></div>
      <div class="stat"><span>{{ t('admin.stats.tasks') }}</span><strong>{{ overview.tasks.total }}</strong></div>
      <div class="stat"><span>{{ t('admin.stats.processing') }}</span><strong>{{ overview.tasks.processing }}</strong></div>
      <div class="stat"><span>{{ t('admin.stats.failed') }}</span><strong>{{ overview.tasks.failed }}</strong></div>
      <div class="stat"><span>{{ t('admin.stats.styles') }}</span><strong>{{ overview.styles }}</strong></div>
      <div class="stat"><span>{{ t('admin.stats.aiConfigs') }}</span><strong>{{ overview.ai_configs }}</strong></div>
    </div>

    <dl v-if="overview" class="meta">
      <div><dt>{{ t('admin.mode') }}</dt><dd>{{ overview.mode }}</dd></div>
      <div><dt>{{ t('admin.register') }}</dt><dd>{{ overview.allow_register ? t('admin.registerOn') : t('admin.registerOff') }}</dd></div>
      <div class="wide"><dt>{{ t('admin.dataDir') }}</dt><dd class="mono">{{ overview.data_dir }}</dd></div>
    </dl>

    <div v-if="overview?.task_trend?.length" class="card">
      <h2>{{ t('admin.taskTrend') }}</h2>
      <div class="trend">
        <div v-for="d in overview.task_trend" :key="d.date" class="trend-col">
          <div class="bars">
            <div class="bar total" :style="{ height: barH(d.total) }" :title="`${d.total}`" />
            <div class="bar ok" :style="{ height: barH(d.completed) }" :title="`${d.completed}`" />
            <div class="bar fail" :style="{ height: barH(d.failed) }" :title="`${d.failed}`" />
          </div>
          <span>{{ d.date.slice(5) }}</span>
        </div>
      </div>
      <div class="legend">
        <span>{{ t('admin.stats.tasks') }}</span>
        <span class="ok">{{ t('admin.statusCompleted') }}</span>
        <span class="fail">{{ t('admin.stats.failed') }}</span>
      </div>
    </div>

    <div v-if="overview" class="split">
      <div class="card">
        <h2>{{ t('admin.recentUsers') }}</h2>
        <p v-if="!overview.recent_users.length" class="empty">{{ t('admin.empty') }}</p>
        <ul v-else>
          <li v-for="u in overview.recent_users" :key="u.id">
            <span>{{ u.display_name || u.username }}</span>
            <em>{{ u.role === 'admin' ? t('admin.roleAdmin') : t('admin.roleUser') }}</em>
          </li>
        </ul>
      </div>
      <div class="card">
        <h2>{{ t('admin.recentProjects') }}</h2>
        <p v-if="!overview.recent_dramas.length" class="empty">{{ t('admin.empty') }}</p>
        <ul v-else>
          <li v-for="d in overview.recent_dramas" :key="d.id">
            <button type="button" class="linkish" @click="navigateTo(`/drama/${d.id}`)">{{ d.title }}</button>
            <em>{{ d.username || t('admin.unassigned') }}</em>
          </li>
        </ul>
      </div>
      <div class="card">
        <h2>{{ t('admin.recentFailures') }}</h2>
        <p v-if="!overview.recent_failures.length" class="empty">{{ t('admin.empty') }}</p>
        <ul v-else>
          <li v-for="task in overview.recent_failures" :key="task.id">
            <span>{{ task.drama_title || `#${task.id}` }} · {{ task.type }}</span>
            <em class="err">{{ task.error || task.status }}</em>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useI18n } from 'vue-i18n'
import { adminAPI } from '~/composables/useApi'
import { toastError } from '~/composables/useToast'

definePageMeta({ layout: 'admin' })

const { t } = useI18n()
const overview = ref(null)
const maxTrend = computed(() => {
  const rows = overview.value?.task_trend || []
  return Math.max(1, ...rows.map(r => r.total || 0))
})

function barH(n) {
  return `${Math.max(4, Math.round((Number(n || 0) / maxTrend.value) * 72))}px`
}

onMounted(async () => {
  try { overview.value = await adminAPI.overview() }
  catch (e) { toastError(e) }
})
</script>

<style scoped>
.panel { display: flex; flex-direction: column; gap: 12px; }
.stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(132px, 1fr)); gap: 10px; }
.stat, .card, .meta {
  background: var(--surface-raised);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
}
.stat { padding: 12px 14px; }
.stat span { display: block; color: var(--text-3); font-size: 12px; }
.stat strong { display: block; margin-top: 4px; font-size: 22px; }
.meta { display: grid; grid-template-columns: 160px 160px 1fr; gap: 12px; padding: 12px 14px; }
.meta dt { color: var(--text-3); font-size: 12px; }
.meta dd { margin: 4px 0 0; font-size: 13px; }
.mono { font-family: ui-monospace, monospace; word-break: break-all; }
.card { padding: 14px; }
.card h2 { margin: 0 0 10px; font-size: 14px; }
.split { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
.card ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.card li { display: flex; justify-content: space-between; gap: 10px; font-size: 13px; }
.card em { color: var(--text-3); font-style: normal; font-size: 12px; text-align: right; }
.empty { color: var(--text-3); margin: 0; }
.err { color: var(--warn-text); }
.linkish { background: none; border: none; padding: 0; color: var(--text-0); font-weight: 650; cursor: pointer; text-align: left; }
.trend { display: flex; gap: 10px; align-items: flex-end; min-height: 96px; }
.trend-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 6px; }
.trend-col > span { font-size: 11px; color: var(--text-3); }
.bars { display: flex; align-items: flex-end; gap: 3px; height: 76px; }
.bar { width: 8px; border-radius: 3px 3px 0 0; min-height: 4px; }
.bar.total { background: var(--overlay-track); }
.bar.ok { background: color-mix(in srgb, #2f9e44 70%, var(--accent)); }
.bar.fail { background: var(--warn-text); }
.legend { display: flex; gap: 12px; margin-top: 10px; font-size: 12px; color: var(--text-3); }
.legend .ok { color: #2f9e44; }
.legend .fail { color: var(--warn-text); }
@media (max-width: 800px) { .meta { grid-template-columns: 1fr; } }
</style>
