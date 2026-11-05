<template>
  <div class="page">
    <header class="head">
      <div>
        <h1>{{ t('admin.title') }}</h1>
        <p>{{ t('admin.sub') }}</p>
      </div>
    </header>

    <p v-if="!isSaas" class="hint">{{ t('admin.standaloneHint') }}</p>

    <div class="tabs" role="tablist">
      <button type="button" class="tab" :class="{ on: tab === 'overview' }" @click="tab = 'overview'">{{ t('admin.tabs.overview') }}</button>
      <button v-if="isSaas" type="button" class="tab" :class="{ on: tab === 'users' }" @click="tab = 'users'">{{ t('admin.tabs.users') }}</button>
      <button type="button" class="tab" :class="{ on: tab === 'projects' }" @click="tab = 'projects'">{{ t('admin.tabs.projects') }}</button>
      <button type="button" class="tab" :class="{ on: tab === 'tasks' }" @click="tab = 'tasks'">{{ t('admin.tabs.tasks') }}</button>
    </div>

    <section v-if="tab === 'overview'" class="panel">
      <div v-if="overview" class="stats">
        <div v-if="isSaas" class="stat"><span>{{ t('admin.stats.users') }}</span><strong>{{ overview.users.total }}</strong></div>
        <div v-if="isSaas" class="stat"><span>{{ t('admin.stats.admins') }}</span><strong>{{ overview.users.admins }}</strong></div>
        <div v-if="isSaas" class="stat"><span>{{ t('admin.stats.disabledUsers') }}</span><strong>{{ overview.users.disabled }}</strong></div>
        <div class="stat"><span>{{ t('admin.stats.projects') }}</span><strong>{{ overview.dramas.total }}</strong></div>
        <div class="stat"><span>{{ t('admin.stats.episodes') }}</span><strong>{{ overview.episodes }}</strong></div>
        <div class="stat"><span>{{ t('admin.stats.tasks') }}</span><strong>{{ overview.tasks.total }}</strong></div>
        <div class="stat"><span>{{ t('admin.stats.processing') }}</span><strong>{{ overview.tasks.processing }}</strong></div>
        <div class="stat"><span>{{ t('admin.stats.failed') }}</span><strong>{{ overview.tasks.failed }}</strong></div>
      </div>

      <dl v-if="overview" class="meta">
        <div><dt>{{ t('admin.mode') }}</dt><dd>{{ overview.mode }}</dd></div>
        <div v-if="isSaas"><dt>{{ t('admin.register') }}</dt><dd>{{ overview.allow_register ? t('admin.registerOn') : t('admin.registerOff') }}</dd></div>
        <div class="wide"><dt>{{ t('admin.dataDir') }}</dt><dd class="mono">{{ overview.data_dir }}</dd></div>
      </dl>

      <div v-if="overview" class="split">
        <div v-if="isSaas" class="card">
          <h2>{{ t('admin.recentUsers') }}</h2>
          <p v-if="!overview.recent_users.length" class="empty">{{ t('admin.empty') }}</p>
          <ul v-else>
            <li v-for="u in overview.recent_users" :key="u.id">
              <span>{{ u.display_name || u.username }}</span>
              <em>{{ roleLabel(u.role) }}</em>
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

      <div v-if="overview" class="card">
        <h2>{{ t('admin.byStatus') }}</h2>
        <div class="chips">
          <span v-for="(n, name) in overview.dramas.by_status" :key="'d' + name" class="chip">{{ t('admin.tabs.projects') }} · {{ name }} · {{ n }}</span>
          <span v-for="(n, name) in overview.tasks.by_status" :key="'t' + name" class="chip">{{ t('admin.tabs.tasks') }} · {{ name }} · {{ n }}</span>
          <span v-if="!Object.keys(overview.dramas.by_status).length && !Object.keys(overview.tasks.by_status).length" class="empty">{{ t('admin.empty') }}</span>
        </div>
      </div>
    </section>

    <section v-else-if="tab === 'users'" class="panel">
      <div class="toolbar">
        <input v-model.trim="userQ" class="input" :placeholder="t('admin.searchUser')" @keydown.enter="loadUsers" />
        <button type="button" class="btn" @click="loadUsers">{{ t('common.refresh') }}</button>
        <button type="button" class="btn btn-primary" @click="openCreate">{{ t('admin.createUser') }}</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{{ t('admin.username') }}</th>
              <th>{{ t('admin.displayName') }}</th>
              <th>{{ t('admin.role') }}</th>
              <th>{{ t('admin.status') }}</th>
              <th>{{ t('admin.createdAt') }}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!users.length"><td colspan="6" class="empty">{{ t('admin.empty') }}</td></tr>
            <tr v-for="u in users" :key="u.id">
              <td>
                {{ u.username }}
                <span v-if="u.id === meId" class="you">{{ t('admin.you') }}</span>
              </td>
              <td>{{ u.display_name || '—' }}</td>
              <td>{{ roleLabel(u.role) }}</td>
              <td>{{ u.status === 'active' ? t('admin.statusActive') : t('admin.statusDisabled') }}</td>
              <td>{{ fmt(u.created_at) }}</td>
              <td class="actions">
                <button type="button" class="btn btn-sm" @click="patchUser(u, { role: u.role === 'admin' ? 'user' : 'admin' })">
                  {{ u.role === 'admin' ? t('admin.demote') : t('admin.promote') }}
                </button>
                <button type="button" class="btn btn-sm" @click="patchUser(u, { status: u.status === 'active' ? 'disabled' : 'active' })">
                  {{ u.status === 'active' ? t('admin.disable') : t('admin.enable') }}
                </button>
                <button type="button" class="btn btn-sm" @click="passwordFor = u; newPassword = ''">{{ t('admin.resetPassword') }}</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-else-if="tab === 'projects'" class="panel">
      <div class="toolbar">
        <input v-model.trim="dramaQ" class="input" :placeholder="t('admin.searchProject')" @keydown.enter="loadDramas" />
        <button type="button" class="btn" @click="loadDramas">{{ t('common.refresh') }}</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
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
            <tr v-if="!dramas.length"><td colspan="7" class="empty">{{ t('admin.empty') }}</td></tr>
            <tr v-for="d in dramas" :key="d.id">
              <td>{{ d.title }}</td>
              <td>{{ d.display_name || d.username || t('admin.unassigned') }}</td>
              <td>{{ d.status }}</td>
              <td>{{ d.style || '—' }}</td>
              <td>{{ d.episodes }}</td>
              <td>{{ fmt(d.updated_at) }}</td>
              <td><button type="button" class="btn btn-sm" @click="navigateTo(`/drama/${d.id}`)">{{ t('admin.open') }}</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-else class="panel">
      <div class="toolbar">
        <select v-model="taskStatus" class="input select" @change="loadTasks">
          <option value="">{{ t('admin.allStatus') }}</option>
          <option value="processing">processing</option>
          <option value="pending">pending</option>
          <option value="completed">completed</option>
          <option value="failed">failed</option>
        </select>
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
            </tr>
          </thead>
          <tbody>
            <tr v-if="!tasks.length"><td colspan="7" class="empty">{{ t('admin.empty') }}</td></tr>
            <tr v-for="task in tasks" :key="task.id">
              <td>{{ task.id }}</td>
              <td>{{ task.type }}</td>
              <td>{{ task.status }}</td>
              <td>
                <button v-if="task.drama_id" type="button" class="linkish" @click="navigateTo(`/drama/${task.drama_id}`)">{{ task.drama_title || task.drama_id }}</button>
                <span v-else>—</span>
              </td>
              <td>{{ task.model || task.provider || '—' }}</td>
              <td class="err">{{ task.error || '—' }}</td>
              <td>{{ fmt(task.created_at) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

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
            <option value="admin">{{ t('admin.roleAdmin') }}</option>
          </select>
        </label>
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
  </div>
</template>

<script setup>
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import { adminAPI } from '~/composables/useApi'
import { toastError } from '~/composables/useToast'

const { t } = useI18n()
const auth = useAuth()
const tab = ref('overview')
const overview = ref(null)
const users = ref([])
const dramas = ref([])
const tasks = ref([])
const userQ = ref('')
const dramaQ = ref('')
const taskStatus = ref('')
const showCreate = ref(false)
const creating = ref(false)
const createForm = reactive({ username: '', password: '', display_name: '', role: 'user' })
const passwordFor = ref(null)
const newPassword = ref('')

const isSaas = computed(() => auth.isSaas.value)
const meId = computed(() => auth.user.value?.id || null)

function fmt(v) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString()
}
function roleLabel(role) {
  return role === 'admin' ? t('admin.roleAdmin') : t('admin.roleUser')
}

async function loadOverview() {
  try { overview.value = await adminAPI.overview() } catch (e) { toastError(e) }
}
async function loadUsers() {
  try { users.value = (await adminAPI.users(userQ.value))?.items || [] } catch (e) { toastError(e) }
}
async function loadDramas() {
  try { dramas.value = (await adminAPI.dramas(dramaQ.value))?.items || [] } catch (e) { toastError(e) }
}
async function loadTasks() {
  try { tasks.value = (await adminAPI.tasks(taskStatus.value))?.items || [] } catch (e) { toastError(e) }
}

function openCreate() {
  createForm.username = ''
  createForm.password = ''
  createForm.display_name = ''
  createForm.role = 'user'
  showCreate.value = true
}

async function createUser() {
  creating.value = true
  try {
    await adminAPI.createUser({ ...createForm })
    toast.success(t('admin.created'))
    showCreate.value = false
    await loadUsers()
    await loadOverview()
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

watch(tab, (name) => {
  if (name === 'overview') loadOverview()
  else if (name === 'users') loadUsers()
  else if (name === 'projects') loadDramas()
  else loadTasks()
})

onMounted(loadOverview)
</script>

<style scoped>
.page { height: 100%; overflow: auto; padding: 20px 28px 48px; }
.head h1 { margin: 0; font-size: 22px; font-weight: 800; letter-spacing: -0.02em; }
.head p { margin: 4px 0 0; color: var(--text-3); font-size: 13px; }
.hint {
  margin: 14px 0 0; padding: 10px 12px; border-radius: var(--radius);
  background: var(--warn-bg); color: var(--warn-text); font-size: 12.5px;
}
.tabs { display: flex; gap: 6px; margin: 16px 0; }
.tab {
  height: 32px; padding: 0 14px; border: none; border-radius: var(--radius-pill);
  background: transparent; color: var(--text-2); font-weight: 650; cursor: pointer;
}
.tab.on { background: var(--seg-active-bg); color: var(--text-0); }
.stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; }
.stat, .card, .meta {
  background: var(--surface-raised); border: 1px solid var(--border); border-radius: var(--radius-lg);
}
.stat { padding: 12px 14px; }
.stat span { display: block; color: var(--text-3); font-size: 12px; }
.stat strong { display: block; margin-top: 4px; font-size: 22px; }
.meta { display: grid; grid-template-columns: 180px 180px 1fr; gap: 12px; margin-top: 12px; padding: 12px 14px; }
.meta dt { color: var(--text-3); font-size: 12px; }
.meta dd { margin: 4px 0 0; font-size: 13px; }
.mono { font-family: var(--font-mono, ui-monospace, monospace); word-break: break-all; }
.split { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; margin-top: 12px; }
.card { padding: 14px; margin-top: 12px; }
.split .card { margin-top: 0; }
.card h2 { margin: 0 0 8px; font-size: 14px; }
.card ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.card li { display: flex; justify-content: space-between; gap: 10px; font-size: 13px; }
.card em { color: var(--text-3); font-style: normal; font-size: 12px; text-align: right; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chip { padding: 4px 10px; border-radius: var(--radius-pill); background: var(--overlay-track); font-size: 12px; color: var(--text-2); }
.toolbar { display: flex; gap: 8px; margin-bottom: 12px; }
.toolbar .input { max-width: 280px; }
.select { max-width: 180px; }
.table-wrap { overflow: auto; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface-raised); }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--border); vertical-align: top; }
th { color: var(--text-3); font-weight: 650; font-size: 12px; }
.actions { display: flex; flex-wrap: wrap; gap: 6px; white-space: nowrap; }
.you { margin-left: 6px; font-size: 11px; color: var(--accent-text); }
.empty { color: var(--text-3); }
.err { color: var(--warn-text); max-width: 320px; }
.linkish { background: none; border: none; padding: 0; color: var(--text-0); font-weight: 650; cursor: pointer; text-align: left; }
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
.dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
@media (max-width: 800px) { .meta { grid-template-columns: 1fr; } }
</style>
