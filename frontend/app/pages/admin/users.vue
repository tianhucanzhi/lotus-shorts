<template>
  <div class="panel">
    <div class="toolbar">
      <input v-model.trim="userQ" class="input" :placeholder="t('admin.searchUser')" @keydown.enter="loadUsers" />
      <button type="button" class="btn" @click="loadUsers">{{ t('common.refresh') }}</button>
      <button type="button" class="btn btn-primary" @click="openCreate">{{ t('admin.createUser') }}</button>
    </div>
    <p v-if="isSuper" class="hint">{{ t('admin.menuPermHint') }}</p>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{{ t('admin.username') }}</th>
            <th>{{ t('admin.displayName') }}</th>
            <th>{{ t('admin.role') }}</th>
            <th>{{ t('admin.status') }}</th>
            <th>{{ t('admin.menus') }}</th>
            <th>{{ t('admin.stats.projects') }}</th>
            <th>{{ t('admin.createdAt') }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!users.length"><td colspan="8" class="empty">{{ t('admin.empty') }}</td></tr>
          <tr v-for="u in users" :key="u.id">
            <td>
              {{ u.username }}
              <span v-if="u.id === meId" class="you">{{ t('admin.you') }}</span>
              <span v-if="u.is_super_admin" class="you">{{ t('admin.superAdmin') }}</span>
            </td>
            <td>{{ u.display_name || '—' }}</td>
            <td>{{ u.role === 'admin' ? t('admin.roleAdmin') : t('admin.roleUser') }}</td>
            <td>{{ u.status === 'active' ? t('admin.statusActive') : t('admin.statusDisabled') }}</td>
            <td class="menus-cell">{{ menusLabel(u) }}</td>
            <td>{{ u.drama_count ?? 0 }}</td>
            <td>{{ fmt(u.created_at) }}</td>
            <td>
              <div class="actions">
                <template v-if="canManage(u)">
                  <button
                    v-if="isSuper && !u.is_super_admin"
                    type="button"
                    class="btn btn-sm"
                    @click="patchUser(u, { role: u.role === 'admin' ? 'user' : 'admin' })"
                  >
                    {{ u.role === 'admin' ? t('admin.demote') : t('admin.promote') }}
                  </button>
                  <button
                    v-if="!u.is_super_admin"
                    type="button"
                    class="btn btn-sm"
                    @click="patchUser(u, { status: u.status === 'active' ? 'disabled' : 'active' })"
                  >
                    {{ u.status === 'active' ? t('admin.disable') : t('admin.enable') }}
                  </button>
                  <button type="button" class="btn btn-sm" @click="passwordFor = u; newPassword = ''">{{ t('admin.resetPassword') }}</button>
                  <button
                    v-if="isSuper && u.role === 'admin' && !u.is_super_admin"
                    type="button"
                    class="btn btn-sm"
                    @click="openMenus(u)"
                  >{{ t('admin.assignMenus') }}</button>
                </template>
                <span v-else class="muted">—</span>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="showCreate" class="overlay" @click.self="showCreate = false">
      <form class="dialog" @submit.prevent="createUser">
        <h2>{{ t('admin.createUser') }}</h2>
        <label class="field"><span>{{ t('admin.username') }}</span><input v-model.trim="createForm.username" class="input" required maxlength="32" /></label>
        <label class="field"><span>{{ t('admin.password') }}</span><input v-model="createForm.password" class="input" type="password" required minlength="6" /></label>
        <label class="field"><span>{{ t('admin.displayName') }}</span><input v-model.trim="createForm.display_name" class="input" maxlength="32" /></label>
        <label class="field">
          <span>{{ t('admin.role') }}</span>
          <select v-model="createForm.role" class="input select">
            <option value="user">{{ t('admin.roleUser') }}</option>
            <option v-if="isSuper" value="admin">{{ t('admin.roleAdmin') }}</option>
          </select>
        </label>
        <div v-if="isSuper && createForm.role === 'admin'" class="menu-checks">
          <span class="field-label">{{ t('admin.assignMenus') }}</span>
          <label v-for="key in MENU_KEYS" :key="key" class="check">
            <input v-model="createForm.admin_menus" type="checkbox" :value="key" />
            {{ menuLabel(key) }}
          </label>
        </div>
        <div class="dialog-actions">
          <button type="button" class="btn" @click="showCreate = false">{{ t('common.cancel') }}</button>
          <button class="btn btn-primary" type="submit" :disabled="creating">{{ t('common.save') }}</button>
        </div>
      </form>
    </div>

    <div v-if="passwordFor" class="overlay" @click.self="passwordFor = null">
      <form class="dialog" @submit.prevent="resetPassword">
        <h2>{{ t('admin.resetPassword') }} · {{ passwordFor.username }}</h2>
        <label class="field"><span>{{ t('admin.newPassword') }}</span><input v-model="newPassword" class="input" type="password" required minlength="6" /></label>
        <div class="dialog-actions">
          <button type="button" class="btn" @click="passwordFor = null">{{ t('common.cancel') }}</button>
          <button class="btn btn-primary" type="submit">{{ t('common.save') }}</button>
        </div>
      </form>
    </div>

    <div v-if="menusFor" class="overlay" @click.self="menusFor = null">
      <form class="dialog" @submit.prevent="saveMenus">
        <h2>{{ t('admin.assignMenus') }} · {{ menusFor.username }}</h2>
        <p class="hint">{{ t('admin.assignMenusHint') }}</p>
        <label v-for="key in MENU_KEYS" :key="key" class="check">
          <input v-model="menuDraft" type="checkbox" :value="key" />
          {{ menuLabel(key) }}
        </label>
        <div class="dialog-actions">
          <button type="button" class="btn" @click="menusFor = null">{{ t('common.cancel') }}</button>
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

const MENU_KEYS = ['overview', 'users', 'projects', 'tasks', 'styles', 'aiConfigs', 'system']

const { t } = useI18n()
const auth = useAuth()
const users = ref([])
const userQ = ref('')
const showCreate = ref(false)
const creating = ref(false)
const createForm = reactive({
  username: '',
  password: '',
  display_name: '',
  role: 'user',
  admin_menus: [],
})
const passwordFor = ref(null)
const newPassword = ref('')
const menusFor = ref(null)
const menuDraft = ref([])

const meId = computed(() => auth.user.value?.id || null)
const isSuper = computed(() => auth.isSuperAdmin.value)

function fmt(v) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString()
}

function menuLabel(key) {
  const map = {
    overview: t('admin.tabs.overview'),
    users: t('admin.tabs.users'),
    projects: t('admin.tabs.projects'),
    tasks: t('admin.tabs.tasks'),
    styles: t('admin.tabs.styles'),
    aiConfigs: t('admin.tabs.aiConfigs'),
    system: t('admin.tabs.system'),
  }
  return map[key] || key
}

function menusLabel(u) {
  if (u.is_super_admin) return t('admin.menusAll')
  if (u.role !== 'admin') return '—'
  const list = Array.isArray(u.admin_menus) ? u.admin_menus : []
  if (!list.length) return t('admin.menusNone')
  return list.map(menuLabel).join(t('common.listJoin'))
}

function canManage(u) {
  if (u.is_super_admin && u.id !== meId.value) return false
  if (u.role === 'admin' && !isSuper.value && u.id !== meId.value) return false
  return true
}

async function loadUsers() {
  try { users.value = (await adminAPI.users(userQ.value))?.items || [] }
  catch (e) { toastError(e) }
}

function openCreate() {
  createForm.username = ''
  createForm.password = ''
  createForm.display_name = ''
  createForm.role = 'user'
  createForm.admin_menus = []
  showCreate.value = true
}

function openMenus(u) {
  menusFor.value = u
  menuDraft.value = Array.isArray(u.admin_menus) ? [...u.admin_menus] : []
}

async function createUser() {
  creating.value = true
  try {
    const payload = {
      username: createForm.username,
      password: createForm.password,
      display_name: createForm.display_name,
      role: createForm.role,
    }
    if (createForm.role === 'admin') payload.admin_menus = [...createForm.admin_menus]
    await adminAPI.createUser(payload)
    toast.success(t('admin.created'))
    showCreate.value = false
    await loadUsers()
  } catch (e) { toastError(e) } finally { creating.value = false }
}

async function patchUser(user, body) {
  try {
    await adminAPI.updateUser(user.id, body)
    toast.success(t('admin.updated'))
    await loadUsers()
  } catch (e) { toastError(e) }
}

async function resetPassword() {
  if (!passwordFor.value) return
  try {
    await adminAPI.updateUser(passwordFor.value.id, { password: newPassword.value })
    toast.success(t('admin.updated'))
    passwordFor.value = null
    newPassword.value = ''
  } catch (e) { toastError(e) }
}

async function saveMenus() {
  if (!menusFor.value) return
  try {
    await adminAPI.updateUser(menusFor.value.id, { admin_menus: [...menuDraft.value] })
    toast.success(t('admin.updated'))
    menusFor.value = null
    await loadUsers()
  } catch (e) { toastError(e) }
}

onMounted(loadUsers)
</script>

<style scoped>
.toolbar { display: flex; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
.toolbar .input { max-width: 280px; }
.hint { margin: 0 0 12px; font-size: 12px; color: var(--text-3); }
.table-wrap { overflow: auto; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface-raised); }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--border); vertical-align: middle; }
th { color: var(--text-3); font-weight: 650; font-size: 12px; }
.actions { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.you { margin-left: 6px; font-size: 11px; color: var(--accent-text); }
.muted { color: var(--text-3); }
.menus-cell { max-width: 240px; font-size: 12px; color: var(--text-2); }
.empty { color: var(--text-3); }
.overlay {
  position: fixed; inset: 0; z-index: 40; display: flex; align-items: center; justify-content: center;
  background: var(--scrim, rgba(0,0,0,.45));
}
.dialog {
  width: min(440px, calc(100vw - 32px)); padding: 18px; border-radius: var(--radius-lg);
  background: var(--surface-raised); border: 1px solid var(--border); display: flex; flex-direction: column; gap: 10px;
  max-height: calc(100vh - 48px); overflow: auto;
}
.dialog h2 { margin: 0 0 4px; font-size: 16px; }
.field { display: flex; flex-direction: column; gap: 6px; font-size: 12.5px; color: var(--text-2); }
.field-label { font-size: 12.5px; color: var(--text-2); }
.menu-checks { display: flex; flex-direction: column; gap: 8px; }
.check { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-2); }
.dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
@media (max-width: 768px) {
  .toolbar .input { max-width: none; width: 100%; }
  table { min-width: 920px; }
}
</style>
