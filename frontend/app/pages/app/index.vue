<template>
  <div class="page">
    <!-- 紧凑头部：标题 + 统计 + 新建 一行 -->
    <div class="launcher-head">
      <div class="head-left">
        <h1 class="launcher-title">{{ t('index.hero.title') }}</h1>
        <span class="launcher-sub">{{ t('index.hero.sub') }}</span>
      </div>
      <div class="hero-stats">
        <span class="tag">{{ t('index.hero.projectCount', { n: dramas.length }) }}</span>
        <span class="tag tag-success">{{ t('index.hero.activeCount', { n: dramas.filter(d => currentStatus(d) === 'active').length }) }}</span>
        <span class="tag tag-accent">{{ t('index.hero.styleCount', { n: stylePresets.length }) }}</span>
      </div>
      <div class="head-actions">
        <button class="btn btn-icon tour-help-btn" :title="t('tour.helpTitle')" @click="startTour('index', INDEX_TOUR, t)">
          <CircleHelp :size="15" :stroke-width="1.8" />
        </button>
        <button class="btn btn-primary" @click="openCreate">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          {{ t('index.create') }}
        </button>
      </div>
    </div>

    <div class="toolbar">
      <label class="search-box">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
          <circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <input v-model.trim="searchKeyword" class="input" :placeholder="t('index.searchPlaceholder')" />
      </label>
      <div class="chip-row">
        <button
          v-for="f in filters"
          :key="f.value"
          type="button"
          class="filter-chip"
          :class="{ on: statusFilter === f.value }"
          @click="statusFilter = f.value"
        >
          {{ f.label }}
        </button>
      </div>
      <div class="sort-select-wrap">
        <BaseSelect v-model="sortMode" :options="sortOptions" :searchable="false" />
      </div>
    </div>

    <!-- 加载骨架：卡片 -->
    <div v-if="loading" class="project-grid">
      <div v-for="i in 8" :key="i" class="card skeleton-card">
        <div class="skeleton-cover"></div>
        <div class="skeleton-body">
          <div class="skeleton-line w-60"></div>
          <div class="skeleton-line w-40"></div>
        </div>
      </div>
    </div>

    <!-- 项目卡片网格 -->
    <div v-else-if="filteredDramas.length" class="project-grid">
      <article
        v-for="(d, i) in filteredDramas"
        :key="d.id"
        class="card project-card"
        :style="{ animationDelay: `${i * 0.04}s` }"
        tabindex="0"
        role="button"
        :aria-label="t('index.openProjectAria', { title: d.title })"
        @click="openDrama(d)"
        @keydown.enter.prevent="openDrama(d)"
        @keydown.space.prevent="openDrama(d)"
      >
        <div class="project-cover">
          <img
            v-if="coverSrc(d)"
            :src="thumbOf(coverSrc(d))"
            class="cover-image"
            alt=""
            loading="lazy"
            @error="thumbFallback($event, coverSrc(d))"
          />
          <span v-else class="cover-initial">{{ coverInitial(d) }}</span>
          <span v-if="isSampleProject(d)" class="cover-sample">{{ t('index.sampleBadge') }}</span>
          <span v-if="d.aspect_ratio && d.aspect_ratio !== 'adaptive'" class="cover-ratio">{{ d.aspect_ratio }}</span>
          <div class="status-wrap" @click.stop>
            <AppMenu
              :open="statusMenuId === d.id"
              placement="bottom-start"
              :min-width="120"
              @update:open="(v) => { statusMenuId = v ? d.id : null }"
            >
              <template #trigger>
                <button type="button" class="cover-badge status-badge" :title="t('index.statusBadgeTitle')">
                  <span class="status-dot" :class="statusDotClass(d)"></span>
                  {{ projectStatus(d) }}
                </button>
              </template>
              <AppMenuItem
                v-for="s in statusOptions"
                :key="s.value"
                :selected="currentStatus(d) === s.value"
                @click="setDramaStatus(d, s.value)"
              >{{ s.label }}</AppMenuItem>
            </AppMenu>
          </div>
          <div class="more-wrap" @click.stop>
            <AppMenu
              :open="activeMenuId === d.id"
              placement="bottom-end"
              :min-width="140"
              @update:open="(v) => { activeMenuId = v ? d.id : null }"
            >
              <template #trigger>
                <button class="btn btn-icon btn-sm cover-more" type="button" :title="t('common.more')">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                    <circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>
                  </svg>
                </button>
              </template>
              <AppMenuItem @click="activeMenuId = null; openDrama(d)">{{ t('index.openProject') }}</AppMenuItem>
              <AppMenuItem @click="activeMenuId = null; openEdit(d)">{{ t('index.editProject') }}</AppMenuItem>
              <AppMenuItem danger @click="activeMenuId = null; dramaToDelete = d">{{ t('index.deleteProject') }}</AppMenuItem>
            </AppMenu>
          </div>
        </div>
        <div class="project-body">
          <h2 class="project-name truncate">{{ d.title }}</h2>
          <p v-if="d.description" class="project-desc truncate-2">{{ d.description }}</p>
          <div class="project-meta">
            <span v-if="d.style" class="tag tag-accent">{{ styleLabel(d.style) }}</span>
            <span class="dim">{{ t('index.projectMeta', { chars: d.characters?.length || 0, scenes: d.scenes?.length || 0, eps: d.episodes?.length || 0 }) }}</span>
          </div>
          <div class="project-foot dim">
            <Clock :size="11" :stroke-width="1.8" />
            {{ fmtDate(d.updated_at || d.updatedAt) }}
          </div>
        </div>
      </article>
    </div>

    <div v-else class="empty-state">
      <div class="empty-icon">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
          <rect x="3" y="3" width="18" height="18" rx="3"/>
          <line x1="12" y1="8" x2="12" y2="16"/>
          <line x1="8" y1="12" x2="16" y2="12"/>
        </svg>
      </div>
      <p class="empty-title">{{ dramas.length ? t('index.emptyFilteredTitle') : t('index.emptyTitle') }}</p>
      <p class="empty-desc">{{ dramas.length ? t('index.emptyFilteredDesc') : t('index.emptyDesc') }}</p>
      <button v-if="!dramas.length" class="btn btn-primary" @click="openCreate">{{ t('index.create') }}</button>
    </div>

    <div v-if="showProjectDialog" class="overlay" @click.self="!coverBusy && closeProjectDialog()">
      <div class="dialog create-dialog">
        <div class="dialog-head">
          <div class="modal-icon">
            <svg v-if="isEditing" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>
            </svg>
            <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
              <rect x="3" y="3" width="18" height="18" rx="3"/>
              <line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>
            </svg>
          </div>
          <div class="dialog-head-copy">
            <h2 class="dialog-title">{{ isEditing ? t('index.editDialog.title') : t('index.createDialog.title') }}</h2>
            <p class="dialog-desc">{{ isEditing ? t('index.editDialog.desc') : t('index.createDialog.desc') }}</p>
          </div>
        </div>
        <form @submit.prevent="saveProject" class="dialog-form">
          <div class="dialog-body">
            <label class="field">
              <span class="field-label">{{ t('index.createDialog.name') }} <span class="required">*</span></span>
              <input v-model="form.title" class="input" :placeholder="t('index.createDialog.namePlaceholder')" required autofocus />
            </label>
            <label class="field">
              <span class="field-label">{{ t('index.createDialog.description') }} <span class="optional">{{ t('common.optional') }}</span></span>
              <textarea
                v-model="form.description"
                class="input textarea"
                rows="3"
                :placeholder="t('index.createDialog.descriptionPlaceholder')"
              />
            </label>
            <div class="field">
              <span class="field-label">{{ t('index.createDialog.cover') }} <span class="optional">{{ t('common.optional') }}</span></span>
              <div class="cover-editor">
                <div class="cover-preview">
                  <img v-if="form.thumbnail" :src="mediaSrc(form.thumbnail)" alt="" class="cover-preview-img" />
                  <span v-else class="cover-preview-empty">{{ t('index.createDialog.coverEmpty') }}</span>
                </div>
                <div class="cover-actions">
                  <button type="button" class="btn btn-sm" :disabled="coverBusy" @click="pickCoverFile">
                    {{ t('index.createDialog.coverUpload') }}
                  </button>
                  <button type="button" class="btn btn-sm btn-primary" :disabled="coverBusy || !form.title.trim()" @click="generateCover">
                    <Loader2 v-if="coverGenerating" :size="12" class="animate-spin" />
                    {{ coverGenerating ? t('index.createDialog.coverGenerating') : t('index.createDialog.coverAi') }}
                  </button>
                  <button v-if="form.thumbnail" type="button" class="btn btn-sm" :disabled="coverBusy" @click="form.thumbnail = ''">
                    {{ t('index.createDialog.coverClear') }}
                  </button>
                  <input ref="coverFileInput" type="file" accept="image/*" class="sr-only" @change="onCoverFileChange" />
                </div>
              </div>
              <span class="field-hint">{{ t('index.createDialog.coverHint') }}</span>
            </div>
            <label class="field">
              <span class="field-label">{{ t('index.createDialog.style') }}</span>
              <BaseSelect v-model="form.style" :options="styleSelectOptions" :placeholder="t('index.createDialog.stylePlaceholder')" searchable />
              <span v-if="selectedStyleDesc" class="field-hint">{{ selectedStyleDesc }}</span>
            </label>
            <label class="field">
              <span class="field-label">{{ t('index.createDialog.aspectRatio') }}</span>
              <input
                v-if="isEditing"
                class="input"
                :value="aspectRatioLabel(form.aspect_ratio)"
                readonly
              />
              <BaseSelect
                v-else
                v-model="form.aspect_ratio"
                :options="aspectRatioOptions"
                :placeholder="t('index.createDialog.aspectRatioPlaceholder')"
              />
              <span class="field-hint">{{ isEditing ? t('index.editDialog.aspectRatioLocked') : t('index.createDialog.aspectRatioHint') }}</span>
            </label>
          </div>
          <div class="dialog-foot">
            <button type="button" class="btn" :disabled="savingProject" @click="closeProjectDialog">{{ t('common.cancel') }}</button>
            <button type="submit" class="btn btn-primary" :disabled="savingProject || coverBusy">
              <Loader2 v-if="savingProject" :size="13" class="animate-spin" />
              <svg v-else-if="!isEditing" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              {{ isEditing ? t('index.editDialog.submit') : t('index.createDialog.submit') }}
            </button>
          </div>
        </form>
      </div>
    </div>
    <ConfirmDialog
      :open="!!dramaToDelete"
      :title="t('index.deleteDialog.title')"
      :message="t('index.deleteDialog.message', { title: dramaToDelete?.title })"
      :loading="deletingDrama"
      @confirm="confirmDelDrama"
      @cancel="dramaToDelete = null"
    />
  </div>
</template>

<script setup>
import { toast } from 'vue-sonner'
import { toastError } from '~/composables/useToast'
import { useI18n } from 'vue-i18n'
import { Clock, CircleHelp, Loader2 } from 'lucide-vue-next'
import { dramaAPI, stylePresetAPI, uploadAPI, taskAPI } from '~/composables/useApi'
import BaseSelect from '~/components/BaseSelect.vue'
import { startTour, autoTour } from '~/composables/useTour'
import { thumbOf, thumbFallback } from '~/composables/useMedia'

const { t, locale } = useI18n()

const dramas = ref([])
const loading = ref(false)
const showProjectDialog = ref(false)
const editingId = ref(null)
const isEditing = computed(() => editingId.value != null)
const savingProject = ref(false)
const coverUploading = ref(false)
const coverGenerating = ref(false)
const coverBusy = computed(() => coverUploading.value || coverGenerating.value || savingProject.value)
const coverFileInput = ref(null)
const searchKeyword = ref('')
const statusFilter = ref('all')
const sortMode = ref('updated')
const sortOptions = computed(() => ([
  { label: t('index.sortUpdated'), value: 'updated' },
  { label: t('index.sortTitle'), value: 'title' },
]))
const activeMenuId = ref(null)
const dramaToDelete = ref(null)
const deletingDrama = ref(false)
const form = ref({ title: '', description: '', style: '', aspect_ratio: '16:9', thumbnail: '' })
const stylePresets = ref([])
const styleSelectOptions = computed(() => stylePresets.value.map(p => ({ label: p.name, value: p.value })))
const selectedStyleDesc = computed(() => stylePresets.value.find(p => p.value === form.value.style)?.description || '')
// 常量数组 label 渲染时求值（语言切换即时生效），value 为逻辑值
const aspectRatioOptions = computed(() => ([
  { label: t('index.ratio.landscape'), value: '16:9' },
  { label: t('index.ratio.portrait'), value: '9:16' },
  { label: t('index.ratio.square'), value: '1:1' },
  { label: t('index.ratio.adaptive'), value: 'adaptive' },
]))
function aspectRatioLabel(value) {
  return aspectRatioOptions.value.find(o => o.value === value)?.label || value || '—'
}
const filters = computed(() => ([
  { label: t('index.status.all'), value: 'all' },
  { label: t('index.status.draft'), value: 'draft' },
  { label: t('index.status.active'), value: 'active' },
  { label: t('index.status.completed'), value: 'completed' },
]))
// 项目状态由用户手动标记（持久化到 dramas.status），不再按内容自动推算
const statusOptions = computed(() => ([
  { label: t('index.status.draft'), value: 'draft' },
  { label: t('index.status.active'), value: 'active' },
  { label: t('index.status.completed'), value: 'completed' },
]))
const statusMenuId = ref(null)

function currentStatus(d) { return d.status || 'draft' }
function projectStatus(d) { return statusOptions.value.find(s => s.value === currentStatus(d))?.label || t('index.status.draft') }
function statusDotClass(d) { return currentStatus(d) === 'active' ? 'on' : currentStatus(d) === 'completed' ? 'done' : '' }
function isSampleProject(d) {
  if (d?.is_sample === true || d?.isSample === true) return true
  const meta = d?.metadata
  if (meta && typeof meta === 'object') return meta.is_sample === true || meta.sample_key === 'yipin-buyi'
  if (typeof meta === 'string') {
    try {
      const parsed = JSON.parse(meta)
      return parsed?.is_sample === true || parsed?.sample_key === 'yipin-buyi'
    } catch { /* ignore */ }
  }
  return false
}

async function setDramaStatus(d, status) {
  statusMenuId.value = null
  if (currentStatus(d) === status) return
  const prev = d.status
  d.status = status
  try {
    await dramaAPI.update(d.id, { status })
  } catch (e) {
    d.status = prev
    toastError(e)
  }
}

function styleLabel(key) {
  return stylePresets.value.find(p => p.value === key)?.name || key || ''
}

// 封面：有 thumbnail 用图，否则首字符占位（状态色只以小圆点出现）
function coverInitial(d) {
  return String(d.title || '?').trim().slice(0, 1).toUpperCase() || '?'
}
function mediaSrc(raw) {
  if (!raw) return ''
  return /^https?:\/\//i.test(raw) || raw.startsWith('/') ? raw : `/${raw}`
}
function coverSrc(d) {
  return mediaSrc(d.thumbnail || '')
}

function resetProjectForm() {
  editingId.value = null
  form.value = {
    title: '',
    description: '',
    style: stylePresets.value[0]?.value || '',
    aspect_ratio: '16:9',
    thumbnail: '',
  }
}
function closeProjectDialog() {
  if (savingProject.value || coverGenerating.value || coverUploading.value) return
  showProjectDialog.value = false
  resetProjectForm()
}
function openCreate() {
  resetProjectForm()
  showProjectDialog.value = true
}
function openEdit(d) {
  editingId.value = d.id
  form.value = {
    title: d.title || '',
    description: d.description || '',
    style: d.style || stylePresets.value[0]?.value || '',
    aspect_ratio: d.aspect_ratio || d.aspectRatio || '16:9',
    thumbnail: d.thumbnail || '',
  }
  showProjectDialog.value = true
}
function pickCoverFile() {
  coverFileInput.value?.click?.()
}
async function onCoverFileChange(e) {
  const file = e.target?.files?.[0]
  e.target.value = ''
  if (!file) return
  coverUploading.value = true
  try {
    const res = await uploadAPI.image(file)
    form.value.thumbnail = res.path || res.url || ''
    toast.success(t('index.createDialog.coverUploaded'))
  } catch (err) {
    toastError(err)
  } finally {
    coverUploading.value = false
  }
}
async function generateCover() {
  if (!form.value.title.trim()) {
    toast.warning(t('index.createDialog.coverNeedTitle'))
    return
  }
  coverGenerating.value = true
  try {
    const { task_id: taskId } = await dramaAPI.generateCover({
      title: form.value.title.trim(),
      description: form.value.description?.trim() || undefined,
      style: form.value.style || undefined,
      aspect_ratio: form.value.aspect_ratio || '16:9',
      drama_id: editingId.value || undefined,
    })
    if (!taskId) throw new Error(t('index.createDialog.coverFailed'))
    const path = await pollCoverTask(taskId)
    form.value.thumbnail = path
    toast.success(t('index.createDialog.coverReady'))
  } catch (err) {
    toastError(err)
  } finally {
    coverGenerating.value = false
  }
}
async function pollCoverTask(taskId) {
  const maxAttempts = 90
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 2000))
    const task = await taskAPI.get(taskId)
    const status = task?.status
    if (status === 'completed') {
      const path = task.localPath || task.local_path || task.resultUrl || task.result_url
      if (!path) throw new Error(t('index.createDialog.coverFailed'))
      return path
    }
    if (status === 'failed') {
      throw new Error(task.errorMsg || task.error_msg || t('index.createDialog.coverFailed'))
    }
  }
  throw new Error(t('index.createDialog.coverTimeout'))
}

const filteredDramas = computed(() => {
  const keyword = searchKeyword.value.trim().toLowerCase()
  const items = dramas.value.filter((d) => {
    const text = [d.title, d.description, d.style, styleLabel(d.style), projectStatus(d)].filter(Boolean).join(' ').toLowerCase()
    const matchesSearch = !keyword || text.includes(keyword)
    const matchesStatus = statusFilter.value === 'all' || currentStatus(d) === statusFilter.value
    return matchesSearch && matchesStatus
  })

  return [...items].sort((a, b) => {
    if (sortMode.value === 'title') return String(a.title || '').localeCompare(String(b.title || ''), 'zh-CN')
    return new Date(b.updated_at || b.updatedAt || 0).getTime() - new Date(a.updated_at || a.updatedAt || 0).getTime()
  })
})

async function load() {
  loading.value = true
  try {
    const [res, presets] = await Promise.all([dramaAPI.list(), stylePresetAPI.list()])
    dramas.value = res.items || []
    stylePresets.value = presets || []
    if (!form.value.style && stylePresets.value.length) {
      form.value.style = stylePresets.value[0].value
    }
  } catch (e) {
    toastError(e)
  } finally {
    loading.value = false
  }
}

async function saveProject() {
  if (!form.value.title?.trim()) return
  savingProject.value = true
  try {
    const payload = {
      title: form.value.title.trim(),
      description: form.value.description?.trim() || '',
      style: form.value.style || undefined,
      thumbnail: form.value.thumbnail || '',
    }
    if (isEditing.value) {
      await dramaAPI.update(editingId.value, payload)
      toast.success(t('index.editDialog.saved'))
      showProjectDialog.value = false
      resetProjectForm()
      await load()
    } else {
      const d = await dramaAPI.create({
        ...payload,
        description: payload.description || undefined,
        thumbnail: payload.thumbnail || undefined,
        aspect_ratio: form.value.aspect_ratio || '16:9',
      })
      showProjectDialog.value = false
      resetProjectForm()
      navigateTo(`/drama/${d.id}`)
    }
  } catch (e) {
    toastError(e)
  } finally {
    savingProject.value = false
  }
}

watch(showProjectDialog, (open) => {
  if (open && !isEditing.value && !form.value.style && stylePresets.value.length) {
    form.value.style = stylePresets.value[0].value
  }
})

async function confirmDelDrama() {
  const d = dramaToDelete.value
  if (!d) return
  try {
    deletingDrama.value = true
    await dramaAPI.del(d.id)
    toast.success(t('index.deleted'))
    dramaToDelete.value = null
    load()
  } catch (e) {
    toastError(e)
  } finally {
    deletingDrama.value = false
  }
}

function getEpisodeNumber(d) {
  const episodes = [...(d.episodes || [])]
  if (!episodes.length) return 1
  episodes.sort((a, b) => Number(a.episode_number || a.episodeNumber || 1) - Number(b.episode_number || b.episodeNumber || 1))
  return Number(episodes[0].episode_number || episodes[0].episodeNumber || 1)
}

function getDramaPath(d) {
  return `/drama/${d.id}`
}

function openDrama(d) {
  activeMenuId.value = null
  navigateTo(getDramaPath(d))
}

function latestEpisodeLabel(d) {
  if (!d.episodes?.length) return t('index.noEpisodes')
  return t('index.episodeN', { n: getEpisodeNumber(d) })
}

function fmtDate(s) {
  if (!s) return ''
  const d = new Date(s)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  if (diff < 60000) return t('index.time.justNow')
  if (diff < 3600000) return t('index.time.minutesAgo', { n: Math.floor(diff / 60000) })
  if (diff < 86400000) return t('index.time.hoursAgo', { n: Math.floor(diff / 3600000) })
  if (diff < 604800000) return t('index.time.daysAgo', { n: Math.floor(diff / 86400000) })
  return d.toLocaleDateString(locale.value === 'zh' ? 'zh-CN' : locale.value, { month: 'short', day: 'numeric' })
}

onMounted(load)

// ===== 应用内引导（首页）：3 步 — 欢迎 / 新建项目 / AI 配置提醒 =====
const INDEX_TOUR = [
  { element: '#__nuxt', titleKey: 'tour.index.welcome.title', descKey: 'tour.index.welcome.desc' },
  { element: '.nav-link[href="/settings"]', titleKey: 'tour.index.settings.title', descKey: 'tour.index.settings.desc', popoverSide: 'bottom' },
  { element: '.head-actions .btn-primary', titleKey: 'tour.index.create.title', descKey: 'tour.index.create.desc', popoverSide: 'bottom', popoverAlign: 'end' },
]
onMounted(() => setTimeout(() => autoTour('index', INDEX_TOUR, t), 600))
</script>

<style scoped>
.page {
  padding: 20px 28px 48px;
  overflow-y: auto;
  height: 100%;
  display: flex;
  flex-direction: column;
  animation: fadeUp 0.35s var(--ease-out) both;
  background: transparent;
}

/* 紧凑头部：标题 + 副标题 + 统计 + 新建 一行 */
.launcher-head {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  padding-bottom: var(--sp-4);
}
.head-left { display: flex; align-items: baseline; gap: 12px; min-width: 0; }
.launcher-title {
  font-family: var(--serif-display, var(--font-display));
  font-size: 22px;
  font-weight: 650;
  letter-spacing: 0.08em;
  color: var(--text-0);
  white-space: nowrap;
}
.launcher-sub { color: var(--text-3); font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hero-stats { display: flex; gap: var(--sp-2); margin-left: auto; }
.launcher-head .btn { flex-shrink: 0; }
.head-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }

.toolbar {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  margin-bottom: var(--sp-4);
}
.search-box { position: relative; width: 240px; flex: 0 0 auto; }
.search-box svg {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-3);
  pointer-events: none;
}
.search-box .input {
  padding-left: 34px;
  border-radius: var(--radius-pill);
  border-color: var(--border);
  background: var(--bg-hover);
}
.search-box .input:focus { background: var(--surface-input); }
.chip-row { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 1px; }
.filter-chip {
  appearance: none;
  cursor: pointer;
  padding: 6px 14px;
  border: none;
  border-radius: var(--radius-pill);
  background: var(--overlay-track);
  color: var(--text-2);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  transition: all 0.16s var(--ease-out);
}
.filter-chip:hover { color: var(--text-0); background: var(--bg-active); }
.filter-chip:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3.5px var(--button-focus);
}
.filter-chip.on { background: var(--inverse-surface); color: var(--on-inverse); }
.sort-select-wrap { margin-left: auto; width: 132px; flex-shrink: 0; }

/* 项目卡片网格 */
.project-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 16px;
}
.project-card {
  position: relative;
  overflow: hidden;
  cursor: pointer;
  animation: fadeUp 0.32s var(--ease-out) both;
  background: var(--panel-bg, var(--surface-raised));
  border-color: var(--border);
  box-shadow: var(--shadow-card);
  transition: border-color 0.16s var(--ease-out), background 0.16s var(--ease-out), box-shadow 0.16s var(--ease-out);
}
.project-card:hover {
  border-color: var(--accent-glow);
  box-shadow: 0 2px 8px rgba(163, 59, 43, 0.08), 0 12px 28px rgba(20, 17, 12, 0.08);
}
.project-card:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3.5px var(--button-focus);
}

/* 封面：陶土柔光 + 首字符，状态色只在圆点上出现 */
.project-cover {
  position: relative;
  aspect-ratio: 2.1 / 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(80% 90% at 70% 20%, var(--accent-bg), transparent 60%),
    linear-gradient(160deg, var(--bg-2) 0%, var(--bg-1) 75%);
  border-bottom: 1px solid var(--border);
}
.cover-image {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.cover-initial {
  font-size: 30px;
  font-weight: 700;
  color: var(--accent-text);
  opacity: 0.55;
  user-select: none;
  position: relative;
  z-index: 0;
}
.cover-ratio {
  position: absolute;
  right: 10px;
  bottom: 8px;
  padding: 2px 7px;
  border-radius: 5px;
  background: var(--surface-raised);
  border: 1px solid var(--border);
  color: var(--text-3);
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.02em;
  font-family: var(--font-mono);
}
.cover-sample {
  position: absolute;
  left: 10px;
  bottom: 8px;
  z-index: 1;
  padding: 2px 7px;
  border-radius: 5px;
  background: color-mix(in srgb, var(--accent) 18%, var(--surface-raised));
  border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border));
  color: var(--accent-text);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
}
.cover-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface-raised);
  color: var(--text-2);
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
}
.status-badge { cursor: pointer; transition: background 0.14s var(--ease-out), color 0.14s var(--ease-out); }
.status-badge:hover { color: var(--text-0); background: var(--bg-1); }
.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-3);
}
.status-dot.on { background: var(--success); }
.status-dot.done { background: var(--accent); }
.status-wrap { position: absolute; top: 10px; left: 10px; z-index: 1; }

.more-wrap { position: absolute; top: 8px; right: 8px; z-index: 1; }
.cover-ratio { z-index: 1; }
.cover-more {
  width: 30px;
  min-width: 30px;
  height: 30px;
  min-height: 30px;
  background: var(--surface-raised);
  border: 1px solid var(--border);
  color: var(--text-2);
  opacity: 0;
  transition: opacity 0.15s var(--ease-out), color 0.15s var(--ease-out);
}
.cover-more:hover { color: var(--text-0); }
.project-card:hover .cover-more,
.more-wrap:focus-within .cover-more { opacity: 1; }

/* 卡身 */
.project-body { padding: 12px 14px 13px; }
.project-desc {
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--text-3);
}
.truncate-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.project-name {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--text-0);
}
.project-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 7px;
  font-size: 11.5px;
  flex-wrap: wrap;
}
.project-foot {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 10px;
  font-size: 11px;
  color: var(--text-3);
  white-space: nowrap;
}

/* 骨架卡片 */
.skeleton-card { overflow: hidden; }
.skeleton-cover {
  aspect-ratio: 2.1 / 1;
  background: var(--bg-2);
  animation: skeleton-pulse 1.4s ease-in-out infinite alternate;
}
.skeleton-body { padding: 12px 14px 14px; display: grid; gap: 10px; }
.skeleton-line {
  height: 12px;
  border-radius: 99px;
  background: var(--bg-2);
  animation: skeleton-pulse 1.4s ease-in-out infinite alternate;
}
.skeleton-line.w-60 { width: 60%; }
.skeleton-line.w-40 { width: 40%; }
@keyframes skeleton-pulse { to { opacity: 0.55; } }

/* 空状态吃掉剩余高度 */
.empty-state {
  flex: 1;
  min-height: 240px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-lg);
  background: var(--panel-bg, var(--surface-raised));
  text-align: center;
}
.empty-icon {
  width: 56px;
  height: 56px;
  border-radius: var(--radius-lg);
  background: var(--bg-2);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-3);
  margin-bottom: 4px;
}
.empty-title { font-size: 14px; font-weight: 600; color: var(--text-1); }
.empty-desc { font-size: 12px; color: var(--text-3); max-width: 240px; line-height: 1.6; }

.create-dialog { width: 520px; max-width: calc(100vw - 32px); }
.optional {
  margin-left: 4px;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-3);
}
.textarea {
  resize: vertical;
  min-height: 72px;
  line-height: 1.5;
  padding-top: 10px;
  padding-bottom: 10px;
}
.cover-editor {
  display: flex;
  gap: 12px;
  align-items: stretch;
}
.cover-preview {
  width: 132px;
  aspect-ratio: 2.1 / 1;
  flex-shrink: 0;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--bg-1);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}
.cover-preview-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.cover-preview-empty {
  font-size: 11px;
  color: var(--text-3);
  padding: 0 8px;
  text-align: center;
}
.cover-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
  justify-content: center;
  min-width: 0;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.animate-spin { animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.dialog-head-copy { display: flex; flex-direction: column; gap: 2px; }
.dialog-desc { font-size: 12.5px; color: var(--text-3); }
.modal-icon {
  width: 40px;
  height: 40px;
  flex: 0 0 auto;
  border-radius: var(--radius);
  background: var(--accent-bg);
  color: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
}
.dialog-form {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.dialog-body { display: flex; flex-direction: column; gap: 16px; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field-label { font-size: 12px; font-weight: 600; color: var(--text-1); }
.required { color: var(--error); }
.field-hint { font-size: 11px; color: var(--text-3); line-height: 1.5; }
.field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }

@media (max-width: 900px) {
  .project-grid { grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
}
@media (max-width: 760px) {
  .page { padding: 16px 16px 40px; }
  .launcher-head { flex-wrap: wrap; }
  .launcher-sub { display: none; }
  .hero-stats { display: none; }
  .toolbar { flex-wrap: wrap; }
  .search-box { width: 100%; flex: 1 1 100%; }
  .sort-select-wrap { margin-left: 0; flex: 1; }
  .project-grid { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); }
  .field-row { grid-template-columns: 1fr; }
  .dialog-foot { flex-direction: column-reverse; }
  .dialog-foot .btn { width: 100%; }
  .cover-more { opacity: 1; }
  .project-grid { grid-template-columns: 1fr; }
  .launcher-title { font-size: 18px; letter-spacing: 0.04em; }
}
</style>
