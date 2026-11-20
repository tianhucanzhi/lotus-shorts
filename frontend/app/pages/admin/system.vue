<template>
  <div class="panel">
    <div class="toolbar">
      <button type="button" class="btn" @click="load">{{ t('common.refresh') }}</button>
    </div>

    <dl v-if="info" class="meta">
      <div><dt>{{ t('admin.mode') }}</dt><dd>{{ info.mode }}</dd></div>
      <div><dt>{{ t('admin.register') }}</dt><dd>{{ info.allow_register ? t('admin.registerOn') : t('admin.registerOff') }}</dd></div>
      <div><dt>{{ t('admin.serverTime') }}</dt><dd>{{ fmt(info.server_time) }}</dd></div>
      <div class="wide"><dt>{{ t('admin.dataDir') }}</dt><dd class="mono">{{ info.data_dir }}</dd></div>
      <div class="wide"><dt>{{ t('admin.sqlitePath') }}</dt><dd class="mono">{{ info.sqlite_path }}</dd></div>
    </dl>

    <div v-if="info" class="card">
      <h2>{{ t('admin.tableCounts') }}</h2>
      <div class="grid">
        <div v-for="(n, name) in info.table_counts" :key="name" class="cell">
          <span>{{ name }}</span>
          <strong>{{ n < 0 ? '—' : n }}</strong>
        </div>
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
const info = ref(null)

function fmt(v) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString()
}

async function load() {
  try { info.value = await adminAPI.system() }
  catch (e) { toastError(e) }
}

onMounted(load)
</script>

<style scoped>
.toolbar { display: flex; gap: 8px; margin-bottom: 12px; }
.meta, .card {
  background: var(--surface-raised);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
}
.meta {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  padding: 14px;
  margin-bottom: 12px;
}
.meta .wide { grid-column: 1 / -1; }
.meta dt { color: var(--text-3); font-size: 12px; }
.meta dd { margin: 4px 0 0; font-size: 13px; }
.mono { font-family: ui-monospace, monospace; word-break: break-all; }
.card { padding: 14px; }
.card h2 { margin: 0 0 12px; font-size: 14px; }
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 8px;
}
.cell {
  padding: 10px 12px;
  border-radius: var(--radius);
  background: var(--overlay-track);
}
.cell span { display: block; font-size: 12px; color: var(--text-3); }
.cell strong { display: block; margin-top: 4px; font-size: 18px; }
@media (max-width: 800px) { .meta { grid-template-columns: 1fr; } }
</style>
