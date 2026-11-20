<template>
  <div class="panel">
    <div class="toolbar">
      <select v-model="taskStatus" class="input select" @change="loadTasks">
        <option value="">{{ t('admin.allStatus') }}</option>
        <option value="processing">processing</option>
        <option value="pending">pending</option>
        <option value="completed">completed</option>
        <option value="failed">failed</option>
        <option value="cancelled">cancelled</option>
      </select>
      <select v-model="taskType" class="input select" @change="loadTasks">
        <option value="">{{ t('admin.allTypes') }}</option>
        <option value="image">image</option>
        <option value="video">video</option>
      </select>
      <input v-model.trim="taskQ" class="input" :placeholder="t('admin.searchTask')" @keydown.enter="loadTasks" />
      <button type="button" class="btn" @click="loadTasks">{{ t('common.refresh') }}</button>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>{{ t('admin.type') }}</th>
            <th>{{ t('admin.status') }}</th>
            <th>{{ t('index.createDialog.name') }}</th>
            <th>{{ t('admin.model') }}</th>
            <th>{{ t('admin.error') }}</th>
            <th>{{ t('admin.createdAt') }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!tasks.length"><td colspan="8" class="empty">{{ t('admin.empty') }}</td></tr>
          <tr v-for="task in tasks" :key="task.id">
            <td>{{ task.id }}</td>
            <td>{{ task.type }}</td>
            <td>{{ task.status }}</td>
            <td>
              <button v-if="task.drama_id" type="button" class="linkish" @click="navigateTo(`/drama/${task.drama_id}`)">
                {{ task.drama_title || task.drama_id }}
              </button>
              <span v-else>—</span>
            </td>
            <td>{{ task.model || task.provider || '—' }}</td>
            <td class="err">{{ task.error || '—' }}</td>
            <td>{{ fmt(task.created_at) }}</td>
            <td>
              <div class="actions">
                <button type="button" class="btn btn-sm" @click="openDetail(task.id)">{{ t('admin.detail') }}</button>
                <button
                  v-if="task.status === 'pending' || task.status === 'processing'"
                  type="button"
                  class="btn btn-sm danger"
                  @click="cancelTask(task)"
                >{{ t('admin.cancelTask') }}</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="detail" class="overlay" @click.self="detail = null">
      <div class="dialog wide">
        <h2>{{ t('admin.taskDetail') }} #{{ detail.id }}</h2>
        <dl class="detail">
          <div><dt>{{ t('admin.type') }}</dt><dd>{{ detail.type }}</dd></div>
          <div><dt>{{ t('admin.status') }}</dt><dd>{{ detail.status }} / {{ detail.stage || '—' }}</dd></div>
          <div><dt>{{ t('admin.model') }}</dt><dd>{{ detail.model || detail.provider || '—' }}</dd></div>
          <div><dt>{{ t('index.createDialog.name') }}</dt><dd>{{ detail.drama_title || detail.drama_id || '—' }}</dd></div>
          <div class="full"><dt>{{ t('admin.error') }}</dt><dd class="err">{{ detail.error || '—' }}</dd></div>
          <div class="full"><dt>prompt</dt><dd class="mono">{{ detail.prompt || '—' }}</dd></div>
          <div class="full"><dt>params</dt><dd class="mono pre">{{ detail.params || '—' }}</dd></div>
        </dl>
        <div class="dialog-actions">
          <button type="button" class="btn" @click="detail = null">{{ t('common.close') }}</button>
        </div>
      </div>
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
const tasks = ref([])
const taskStatus = ref('')
const taskType = ref('')
const taskQ = ref('')
const detail = ref(null)

function fmt(v) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString()
}

async function loadTasks() {
  try {
    tasks.value = (await adminAPI.tasks({
      status: taskStatus.value,
      type: taskType.value,
      q: taskQ.value,
    }))?.items || []
  } catch (e) { toastError(e) }
}

async function openDetail(id) {
  try { detail.value = await adminAPI.task(id) }
  catch (e) { toastError(e) }
}

async function cancelTask(task) {
  if (!confirm(t('admin.confirmCancelTask', { id: task.id }))) return
  try {
    await adminAPI.cancelTask(task.id)
    toast.success(t('admin.updated'))
    await loadTasks()
  } catch (e) { toastError(e) }
}

onMounted(loadTasks)
</script>

<style scoped>
.toolbar { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
.select { max-width: 160px; }
.toolbar .input { max-width: 240px; }
.table-wrap { overflow: auto; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface-raised); }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--border); vertical-align: middle; }
th { color: var(--text-3); font-weight: 650; font-size: 12px; }
.actions { display: flex; flex-wrap: nowrap; gap: 6px; align-items: center; white-space: nowrap; }
.danger { color: var(--warn-text); }
.empty { color: var(--text-3); }
.err { color: var(--warn-text); max-width: 280px; word-break: break-word; }
.linkish { background: none; border: none; padding: 0; color: var(--text-0); font-weight: 650; cursor: pointer; text-align: left; }
.overlay {
  position: fixed; inset: 0; z-index: 40; display: flex; align-items: center; justify-content: center;
  background: var(--scrim, rgba(0,0,0,.45));
}
.dialog {
  width: min(640px, calc(100vw - 32px)); max-height: calc(100vh - 48px); overflow: auto;
  padding: 18px; border-radius: var(--radius-lg);
  background: var(--surface-raised); border: 1px solid var(--border);
}
.dialog h2 { margin: 0 0 12px; font-size: 16px; }
.detail { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 0; }
.detail .full { grid-column: 1 / -1; }
.detail dt { color: var(--text-3); font-size: 12px; }
.detail dd { margin: 4px 0 0; font-size: 13px; }
.mono { font-family: ui-monospace, monospace; word-break: break-word; }
.pre { white-space: pre-wrap; }
.dialog-actions { display: flex; justify-content: flex-end; margin-top: 14px; }
@media (max-width: 768px) {
  .toolbar .input, .select { max-width: none; width: 100%; }
  table { min-width: 860px; }
  .detail { grid-template-columns: 1fr; }
}
</style>
