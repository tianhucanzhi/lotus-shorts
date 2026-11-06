<template>
  <div class="contact-float">
    <button type="button" class="contact-btn" @click="open = true">
      <MessageCircle :size="16" :stroke-width="1.8" />
      <span>{{ t('layout.contact.label') }}</span>
    </button>

    <div v-if="open" class="overlay contact-overlay" @click.self="open = false">
      <div class="dialog contact-dialog" role="dialog" aria-modal="true" :aria-label="t('layout.contact.label')">
        <div class="dialog-head">
          <h2 class="dialog-title contact-title"><MessageCircle :size="16" :stroke-width="1.8" />{{ t('layout.contact.label') }}</h2>
          <button type="button" class="btn btn-icon contact-close" :aria-label="t('common.close')" @click="open = false">
            <X :size="16" />
          </button>
        </div>
        <div class="dialog-body contact-body">
          <p>{{ t('layout.contact.body') }}</p>
          <img :src="qrUrl" :alt="t('layout.contact.qrAlt')" class="contact-qr" />
          <p class="contact-scan">{{ t('layout.contact.scan') }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { MessageCircle, X } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const open = ref(false)
const qrUrl = 'https://lotus.yunfm.cn/static/images/wx.png'

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') open.value = false
}

onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<style scoped>
.contact-btn {
  position: fixed;
  right: max(16px, env(safe-area-inset-right));
  bottom: max(16px, env(safe-area-inset-bottom));
  z-index: 80;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 40px;
  padding: 0 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface-raised);
  color: var(--text-0);
  font-size: 13px;
  font-weight: 700;
  box-shadow: var(--shadow-elevated);
  cursor: pointer;
}
.contact-btn:hover { background: var(--bg-hover); }
.contact-btn:focus-visible { outline: none; box-shadow: 0 0 0 3.5px var(--button-focus); }
.contact-overlay { z-index: 120; }
.contact-dialog { width: min(400px, calc(100vw - 32px)); }
.dialog-head { justify-content: space-between; }
.contact-title { display: inline-flex; align-items: center; gap: 8px; }
.contact-close { margin-left: auto; }
.contact-body { display: flex; flex-direction: column; align-items: center; gap: 16px; text-align: center; }
.contact-body p { margin: 0; color: var(--text-1); font-size: 14px; line-height: 1.7; }
.contact-qr {
  width: 220px;
  height: 220px;
  object-fit: contain;
  border-radius: var(--radius);
  background: #fff;
}
.contact-body .contact-scan { font-weight: 650; color: var(--text-0); }
</style>
