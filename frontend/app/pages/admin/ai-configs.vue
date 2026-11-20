<template>
  <div class="panel">
    <div class="toolbar">
      <button type="button" class="btn" @click="load">{{ t('common.refresh') }}</button>
    </div>

    <div v-if="data" class="chips">
      <span v-for="(n, k) in data.by_type" :key="'t' + k" class="chip">{{ typeLabel(k) }} · {{ n }}</span>
      <span v-for="(n, k) in data.by_provider" :key="'p' + k" class="chip muted">{{ k }} · {{ n }}</span>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{{ t('admin.configName') }}</th>
            <th>{{ t('admin.type') }}</th>
            <th>{{ t('admin.provider') }}</th>
            <th>{{ t('admin.owner') }}</th>
            <th>{{ t('admin.model') }}</th>
            <th>API Key</th>
            <th>{{ t('admin.status') }}</th>
            <th>{{ t('admin.updatedAt') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!items.length"><td colspan="8" class="empty">{{ t('admin.empty') }}</td></tr>
          <tr v-for="c in items" :key="c.id">
            <td>
              <strong>{{ c.name }}</strong>
              <div class="mono dim">{{ c.base_url }}</div>
            </td>
            <td>{{ typeLabel(c.service_type) }}</td>
            <td>{{ c.provider || '—' }}</td>
            <td>{{ c.username || t('admin.unassigned') }}</td>
            <td>{{ c.model || '—' }}</td>
            <td class="mono">{{ c.api_key_masked || '—' }}</td>
            <td>
              {{ c.is_active ? t('admin.statusActive') : t('admin.statusDisabled') }}
              <span v-if="c.is_default" class="you">{{ t('common.default') }}</span>
            </td>
            <td>{{ fmt(c.updated_at) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import { useI18n } from 'vue-i18n'
import { adminAPI } from '~/composables/useApi'
import { toastError } from '~/composables/useToast'

definePageMeta({ layout: 'admin' })

const { t } = useI18n()
const data = ref(null)
const items = computed(() => data.value?.items || [])

function typeLabel(k) {
  if (k === 'text' || k === 'image' || k === 'video') return t(`common.serviceType.${k}`)
  return k
}
function fmt(v) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString()
}

async function load() {
  try { data.value = await adminAPI.aiConfigs() }
  catch (e) { toastError(e) }
}

onMounted(load)
</script>

<style scoped>
.toolbar { display: flex; gap: 8px; margin-bottom: 12px; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.chip {
  padding: 4px 10px; border-radius: var(--radius-pill);
  background: var(--seg-active-bg); font-size: 12px; color: var(--text-2);
}
.chip.muted { background: var(--overlay-track); }
.table-wrap { overflow: auto; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface-raised); }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--border); vertical-align: top; }
th { color: var(--text-3); font-weight: 650; font-size: 12px; }
.mono { font-family: ui-monospace, monospace; font-size: 12px; }
.dim { color: var(--text-3); margin-top: 4px; max-width: 320px; word-break: break-all; }
.you { margin-left: 6px; font-size: 11px; color: var(--accent-text); }
.empty { color: var(--text-3); }
@media (max-width: 768px) { table { min-width: 900px; } }
</style>
