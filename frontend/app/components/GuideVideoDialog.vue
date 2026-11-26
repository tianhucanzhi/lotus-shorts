<template>
  <Teleport to="body">
    <div v-if="visible" class="guide-overlay">
      <div
        class="guide-dialog"
        :class="{ expanded }"
        role="dialog"
        aria-modal="true"
        :aria-label="t('landing.guide.title')"
      >
        <header class="guide-dialog-head">
          <div class="guide-dialog-meta">
            <strong>{{ t('landing.guide.title') }}</strong>
            <span>{{ t('landing.guide.sub') }}</span>
          </div>
          <div class="guide-dialog-actions">
            <button
              type="button"
              class="guide-icon-btn"
              :aria-label="expanded ? t('landing.guide.shrink') : t('landing.guide.expand')"
              :title="expanded ? t('landing.guide.shrink') : t('landing.guide.expand')"
              @click="expanded = !expanded"
            >
              <Minimize2 v-if="expanded" :size="16" :stroke-width="2" />
              <Maximize2 v-else :size="16" :stroke-width="2" />
            </button>
            <button
              type="button"
              class="guide-icon-btn"
              :aria-label="t('common.close')"
              :title="t('common.close')"
              @click="close()"
            >
              <X :size="17" :stroke-width="2" />
            </button>
          </div>
        </header>
        <div class="guide-player">
          <div class="guide-stage">
            <video
              ref="videoEl"
              class="guide-video"
              :src="GUIDE_VIDEO"
              controls
              playsinline
              preload="auto"
              @play="showPlay = false"
              @pause="showPlay = true"
              @ended="showPlay = true"
            />
            <button
              v-if="showPlay"
              type="button"
              class="guide-play"
              :aria-label="t('landing.guide.play')"
              @click="playByUser"
            >
              <span class="guide-play-ring" />
              <span class="guide-play-core">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
              </span>
              <span class="guide-play-label">{{ t('landing.guide.play') }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { Maximize2, Minimize2, X } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'

const GUIDE_VIDEO = 'https://medstatic.oss-cn-shanghai.aliyuncs.com/shorts/shorts-yanshi.mp4'

const props = defineProps({
  /** 落地页自管滚动；工作台布局交给组件锁 body */
  lockBodyScroll: { type: Boolean, default: true },
})
const emit = defineEmits(['opened', 'closed'])
const { t } = useI18n()

const visible = ref(false)
const expanded = ref(false)
const showPlay = ref(true)
const videoEl = ref(null)
let pendingAutoplay = false
let lockedScroll = false

async function tryPlayUnmuted() {
  const el = videoEl.value
  if (!el) return false
  try {
    el.muted = false
    await el.play()
    showPlay.value = false
    return true
  } catch {
    showPlay.value = true
    return false
  }
}

async function playByUser() {
  await tryPlayUnmuted()
}

function lockScroll() {
  if (!props.lockBodyScroll || lockedScroll) return
  lockedScroll = true
  document.documentElement.style.overflow = 'hidden'
  document.body.style.overflow = 'hidden'
}

function unlockScroll() {
  if (!lockedScroll) return
  lockedScroll = false
  document.documentElement.style.overflow = ''
  document.body.style.overflow = ''
}

function open(opts = {}) {
  expanded.value = false
  showPlay.value = true
  pendingAutoplay = !!opts.tryAutoplay
  visible.value = true
  lockScroll()
  emit('opened')
  if (pendingAutoplay) {
    pendingAutoplay = false
    nextTick(() => { tryPlayUnmuted() })
  }
}

function close() {
  const el = videoEl.value
  if (el) {
    try { el.pause() } catch { /* ignore */ }
  }
  visible.value = false
  expanded.value = false
  showPlay.value = true
  unlockScroll()
  emit('closed')
}

function onKey(e) {
  if (e.key === 'Escape' && visible.value) close()
}

onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => {
  window.removeEventListener('keydown', onKey)
  unlockScroll()
})

defineExpose({ open, close, visible })
</script>

<style scoped>
.guide-overlay {
  position: fixed; inset: 0; z-index: 120;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(8px);
  display: grid; place-items: center;
  padding: 16px;
}
.guide-dialog {
  --guide-surface: #1a1714;
  --guide-border: rgba(243, 236, 217, 0.12);
  --guide-text-0: #f3ecd9;
  --guide-text-1: #cfc6b5;
  --guide-text-2: #a89f8e;
  --guide-hover: rgba(255, 255, 255, 0.03);
  --guide-accent-bg: rgba(163, 59, 43, 0.15);
  --guide-accent-text: #e08a78;

  width: min(920px, 100%);
  max-height: min(92vh, 900px);
  border-radius: var(--radius-xl, 18px);
  overflow: hidden;
  background: var(--guide-surface);
  border: 1px solid var(--guide-border);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.4), 0 24px 56px rgba(0, 0, 0, 0.5);
  color: var(--guide-text-0);
  display: flex;
  flex-direction: column;
  transition: width 0.2s var(--ease-out, ease), max-height 0.2s var(--ease-out, ease);
}
.guide-dialog.expanded {
  width: min(1280px, calc(100vw - 24px));
  max-height: calc(100vh - 24px);
  height: calc(100vh - 24px);
}
.guide-dialog-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 18px 12px;
  border-bottom: 1px solid var(--guide-border);
}
.guide-dialog-meta strong {
  display: block;
  font: 700 17px/1.25 var(--font-display);
  color: var(--guide-text-0);
  letter-spacing: -0.02em;
}
.guide-dialog-meta span {
  display: block;
  margin-top: 4px;
  font-size: 12.5px;
  color: var(--guide-text-2);
  line-height: 1.5;
}
.guide-dialog-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.guide-icon-btn {
  width: 36px; height: 36px;
  border: 0; border-radius: 999px;
  background: var(--guide-hover);
  color: var(--guide-text-1);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.guide-icon-btn:hover {
  background: var(--guide-accent-bg);
  color: var(--guide-accent-text);
}
.guide-player {
  padding: 16px 18px 18px;
  min-height: 0;
  flex: 1;
  display: flex;
}
.guide-stage {
  position: relative;
  width: 100%;
  flex: 1;
  min-height: 0;
  display: flex;
}
.guide-video {
  display: block;
  width: 100%;
  max-height: min(62vh, 560px);
  border-radius: 12px;
  background: #0f0e0c;
  border: 1px solid var(--guide-border);
  aspect-ratio: 16 / 9;
  object-fit: contain;
}
.guide-dialog.expanded .guide-video {
  max-height: none;
  height: 100%;
  flex: 1;
  aspect-ratio: auto;
}
.guide-play {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: grid;
  place-items: center;
  place-content: center;
  gap: 12px;
  border: 0;
  border-radius: 12px;
  background: rgba(22, 19, 16, 0.42);
  color: #f7f1e7;
  cursor: pointer;
  transition: background 0.25s ease;
}
.guide-play:hover { background: rgba(22, 19, 16, 0.32); }
.guide-play-ring {
  position: absolute;
  width: 88px;
  height: 88px;
  border-radius: 50%;
  border: 1px solid rgba(247, 241, 231, 0.4);
  animation: guide-ring-pulse 2.4s ease-out infinite;
}
@keyframes guide-ring-pulse {
  0% { transform: scale(0.92); opacity: 0.9; }
  70% { transform: scale(1.25); opacity: 0; }
  100% { transform: scale(1.25); opacity: 0; }
}
.guide-play-core {
  position: relative;
  width: 72px;
  height: 72px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: linear-gradient(145deg, #2a241e 0%, #1a1612 100%);
  border: 1px solid rgba(247, 241, 231, 0.22);
  box-shadow:
    0 12px 36px rgba(22, 19, 16, 0.35),
    0 0 0 6px rgba(247, 241, 231, 0.06);
  transition: transform 0.2s ease;
}
.guide-play:hover .guide-play-core { transform: scale(1.06); }
.guide-play-label {
  position: relative;
  font: 650 13px/1 var(--font-body);
  letter-spacing: 0.08em;
  color: rgba(247, 241, 231, 0.92);
}
</style>
