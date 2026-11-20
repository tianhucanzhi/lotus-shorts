<template>
  <div class="panel">
    <div class="toolbar">
      <button type="button" class="btn" @click="load">{{ t('common.refresh') }}</button>
      <button type="button" class="btn" :disabled="restoring" @click="restoreDefaults">
        {{ restoring ? t('admin.restoringStyles') : t('admin.restoreDefaultStyles') }}
      </button>
      <button type="button" class="btn btn-primary" @click="openCreate">{{ t('admin.createStyle') }}</button>
    </div>
    <p class="hint">{{ t('admin.restoreDefaultStylesHint') }}</p>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{{ t('admin.styleName') }}</th>
            <th>key</th>
            <th>{{ t('admin.sortOrder') }}</th>
            <th>{{ t('admin.status') }}</th>
            <th>{{ t('admin.updatedAt') }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!items.length"><td colspan="6" class="empty">{{ t('admin.empty') }}</td></tr>
          <tr v-for="s in items" :key="s.id">
            <td>
              <strong>{{ s.name }}</strong>
              <span v-if="s.is_builtin" class="builtin">{{ t('admin.builtinStyle') }}</span>
              <div class="desc">{{ s.description || clip(s.prompt, 80) }}</div>
            </td>
            <td class="mono">{{ s.value }}</td>
            <td>{{ s.sort_order }}</td>
            <td>{{ s.is_active ? t('admin.statusActive') : t('admin.statusDisabled') }}</td>
            <td>{{ fmt(s.updated_at) }}</td>
            <td>
              <div class="actions">
                <button type="button" class="btn btn-sm" @click="openEdit(s)">{{ t('admin.edit') }}</button>
                <button type="button" class="btn btn-sm" @click="toggleActive(s)">
                  {{ s.is_active ? t('admin.disable') : t('admin.enable') }}
                </button>
                <button type="button" class="btn btn-sm danger" @click="remove(s)">{{ t('common.delete') }}</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="editing" class="overlay" @click.self="editing = null">
      <form class="dialog" @submit.prevent="save">
        <h2>{{ editing.id ? t('admin.editStyle') : t('admin.createStyle') }}</h2>
        <label class="field"><span>{{ t('admin.styleName') }}</span><input v-model.trim="form.name" class="input" required /></label>
        <label v-if="!editing.id" class="field"><span>key</span><input v-model.trim="form.value" class="input" required pattern="[a-z0-9][a-z0-9-]*" /></label>
        <label class="field"><span>{{ t('admin.stylePrompt') }}</span><textarea v-model.trim="form.prompt" class="input area" rows="5" required /></label>
        <label class="field"><span>{{ t('admin.styleDesc') }}</span><input v-model.trim="form.description" class="input" /></label>
        <label class="field"><span>{{ t('admin.sortOrder') }}</span><input v-model.number="form.sort_order" class="input" type="number" /></label>
        <label class="check"><input v-model="form.is_active" type="checkbox" /> {{ t('admin.statusActive') }}</label>
        <div class="dialog-actions">
          <button type="button" class="btn" @click="editing = null">{{ t('common.cancel') }}</button>
          <button class="btn btn-primary" type="submit" :disabled="saving">{{ t('common.save') }}</button>
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
const items = ref([])
const editing = ref(null)
const saving = ref(false)
const restoring = ref(false)
const form = reactive({
  name: '',
  value: '',
  prompt: '',
  description: '',
  sort_order: 0,
  is_active: true,
})

function fmt(v) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString()
}
function clip(s, n) {
  const t = String(s || '')
  return t.length > n ? `${t.slice(0, n)}…` : t
}

async function load() {
  try { items.value = (await adminAPI.styles())?.items || [] }
  catch (e) { toastError(e) }
}

async function restoreDefaults() {
  if (!confirm(t('admin.confirmRestoreStyles'))) return
  restoring.value = true
  try {
    const res = await adminAPI.restoreDefaultStyles()
    items.value = res?.items || []
    toast.success(t('admin.restoredStyles', {
      n: (res?.restored || 0) + (res?.created || 0),
    }))
  } catch (e) { toastError(e) } finally { restoring.value = false }
}

function openCreate() {
  Object.assign(form, { name: '', value: '', prompt: '', description: '', sort_order: 0, is_active: true })
  editing.value = { id: null }
}

function openEdit(s) {
  Object.assign(form, {
    name: s.name,
    value: s.value,
    prompt: s.prompt,
    description: s.description || '',
    sort_order: s.sort_order || 0,
    is_active: !!s.is_active,
  })
  editing.value = s
}

async function save() {
  saving.value = true
  try {
    if (editing.value?.id) {
      await adminAPI.updateStyle(editing.value.id, { ...form })
    } else {
      await adminAPI.createStyle({ ...form })
    }
    toast.success(t('admin.updated'))
    editing.value = null
    await load()
  } catch (e) { toastError(e) } finally { saving.value = false }
}

async function toggleActive(s) {
  try {
    await adminAPI.updateStyle(s.id, { is_active: !s.is_active })
    toast.success(t('admin.updated'))
    await load()
  } catch (e) { toastError(e) }
}

async function remove(s) {
  if (!confirm(t('admin.confirmDeleteStyle', { name: s.name }))) return
  try {
    await adminAPI.deleteStyle(s.id)
    toast.success(t('admin.deleted'))
    await load()
  } catch (e) { toastError(e) }
}

onMounted(load)
</script>

<style scoped>
.toolbar { display: flex; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
.hint { margin: 0 0 12px; font-size: 12px; color: var(--text-3); }
.builtin {
  margin-left: 8px; font-size: 11px; font-weight: 650;
  color: var(--accent-text); vertical-align: middle;
}
.table-wrap { overflow: auto; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface-raised); }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--border); vertical-align: middle; }
th { color: var(--text-3); font-weight: 650; font-size: 12px; }
.desc { margin-top: 4px; color: var(--text-3); font-size: 12px; max-width: 420px; }
.mono { font-family: ui-monospace, monospace; }
.actions { display: flex; flex-wrap: nowrap; gap: 6px; align-items: center; white-space: nowrap; }
.danger { color: var(--warn-text); }
.empty { color: var(--text-3); }
.overlay {
  position: fixed; inset: 0; z-index: 40; display: flex; align-items: center; justify-content: center;
  background: var(--scrim, rgba(0,0,0,.45));
}
.dialog {
  width: min(520px, calc(100vw - 32px)); padding: 18px; border-radius: var(--radius-lg);
  background: var(--surface-raised); border: 1px solid var(--border); display: flex; flex-direction: column; gap: 10px;
  max-height: calc(100vh - 48px); overflow: auto;
}
.dialog h2 { margin: 0 0 4px; font-size: 16px; }
.field { display: flex; flex-direction: column; gap: 6px; font-size: 12.5px; color: var(--text-2); }
.area { resize: vertical; min-height: 100px; }
.check { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-2); }
.dialog-actions { display: flex; justify-content: flex-end; gap: 8px; }
@media (max-width: 768px) { table { min-width: 720px; } }
</style>
