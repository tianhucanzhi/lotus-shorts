<template>
  <div class="panel">
    <div class="toolbar">
      <input v-model.trim="dramaQ" class="input" :placeholder="t('admin.searchProject')" @keydown.enter="loadDramas" />
      <select v-model="status" class="input select" @change="loadDramas">
        <option value="">{{ t('admin.allStatus') }}</option>
        <option value="draft">draft</option>
        <option value="producing">producing</option>
        <option value="completed">completed</option>
      </select>
      <button type="button" class="btn" @click="loadDramas">{{ t('common.refresh') }}</button>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>{{ t('index.createDialog.name') }}</th>
            <th>{{ t('admin.owner') }}</th>
            <th>{{ t('admin.status') }}</th>
            <th>{{ t('admin.style') }}</th>
            <th>{{ t('admin.episodes') }}</th>
            <th>{{ t('admin.updatedAt') }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!dramas.length"><td colspan="8" class="empty">{{ t('admin.empty') }}</td></tr>
          <tr v-for="d in dramas" :key="d.id">
            <td>{{ d.id }}</td>
            <td>{{ d.title }}</td>
            <td>{{ d.display_name || d.username || t('admin.unassigned') }}</td>
            <td>{{ d.status || '—' }}</td>
            <td>{{ d.style || '—' }}</td>
            <td>{{ d.episodes }}</td>
            <td>{{ fmt(d.updated_at) }}</td>
            <td>
              <div class="actions">
                <button type="button" class="btn btn-sm" @click="navigateTo(`/drama/${d.id}`)">{{ t('admin.open') }}</button>
                <button type="button" class="btn btn-sm" @click="openTransfer(d)">{{ t('admin.transfer') }}</button>
                <button type="button" class="btn btn-sm danger" @click="removeDrama(d)">{{ t('common.delete') }}</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="transferFor" class="overlay" @click.self="transferFor = null">
      <form class="dialog" @submit.prevent="doTransfer">
        <h2>{{ t('admin.transfer') }} · {{ transferFor.title }}</h2>
        <label class="field">
          <span>{{ t('admin.owner') }}</span>
          <select v-model="transferUserId" class="input select">
            <option :value="null">{{ t('admin.unassigned') }}</option>
            <option v-for="u in users" :key="u.id" :value="u.id">
              {{ u.display_name || u.username }} ({{ u.username }})
            </option>
          </select>
        </label>
        <div class="dialog-actions">
          <button type="button" class="btn" @click="transferFor = null">{{ t('common.cancel') }}</button>
          <button class="btn btn-primary" type="submit">{{ t('common.save') }}</button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup>
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import { adminAPI } from '~/composables/useApi'
import { toastError } from '~/composables/useToast'

definePageMeta({ layout: 'admin' })

const { t } = useI18n()
const dramas = ref([])
const users = ref([])
const dramaQ = ref('')
const status = ref('')
const transferFor = ref(null)
const transferUserId = ref(null)

function fmt(v) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString()
}

async function loadDramas() {
  try {
    dramas.value = (await adminAPI.dramas({ q: dramaQ.value, status: status.value }))?.items || []
  } catch (e) { toastError(e) }
}

async function loadUsers() {
  try { users.value = (await adminAPI.users())?.items || [] }
  catch { /* ignore */ }
}

function openTransfer(d) {
  transferFor.value = d
  transferUserId.value = d.user_id ?? null
}

async function doTransfer() {
  if (!transferFor.value) return
  try {
    await adminAPI.transferDrama(transferFor.value.id, transferUserId.value)
    toast.success(t('admin.updated'))
    transferFor.value = null
    await loadDramas()
  } catch (e) { toastError(e) }
}

async function removeDrama(d) {
  if (!confirm(t('admin.confirmDeleteProject', { title: d.title }))) return
  try {
    await adminAPI.deleteDrama(d.id)
    toast.success(t('admin.deleted'))
    await loadDramas()
  } catch (e) { toastError(e) }
}

onMounted(async () => {
  await Promise.all([loadDramas(), loadUsers()])
})
</script>

<style scoped>
.toolbar { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
.toolbar .input { max-width: 280px; }
.select { max-width: 160px; }
.table-wrap { overflow: auto; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface-raised); }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--border); vertical-align: middle; }
th { color: var(--text-3); font-weight: 650; font-size: 12px; }
.actions { display: flex; flex-wrap: nowrap; gap: 6px; align-items: center; white-space: nowrap; }
.danger { color: var(--warn-text); }
.empty { color: var(--text-3); }
.overlay {
  position: fixed; inset: 0; z-index: 40; display: flex; align-items: center; justify-content: center;
  background: var(--scrim, rgba(0,0,0,.45));
}
.dialog {
  width: min(420px, calc(100vw - 32px)); padding: 18px; border-radius: var(--radius-lg);
  background: var(--surface-raised); border: 1px solid var(--border); display: flex; flex-direction: column; gap: 10px;
}
.dialog h2 { margin: 0 0 4px; font-size: 16px; }
.field { display: flex; flex-direction: column; gap: 6px; font-size: 12.5px; color: var(--text-2); }
.dialog-actions { display: flex; justify-content: flex-end; gap: 8px; }
@media (max-width: 768px) {
  .toolbar .input, .select { max-width: none; width: 100%; }
  table { min-width: 860px; }
}
</style>
