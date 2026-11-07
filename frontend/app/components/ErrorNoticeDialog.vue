<template>
  <Teleport to="body">
    <div v-if="notice.open" class="overlay" @click.self="closeErrorNotice()">
      <div
        class="dialog notice-dialog"
        role="alertdialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        :aria-describedby="descId"
      >
        <div class="notice-icon" :class="notice.kind">
          <Wallet v-if="notice.kind === 'balance'" :size="22" :stroke-width="1.8" />
          <Timer v-else-if="notice.kind === 'rateLimit'" :size="22" :stroke-width="1.8" />
          <Info v-else :size="22" :stroke-width="1.8" />
        </div>
        <h2 :id="titleId" class="notice-title">{{ notice.title }}</h2>
        <p :id="descId" class="notice-message">{{ notice.message }}</p>
        <div class="notice-actions">
          <button
            v-if="notice.secondaryText"
            type="button"
            class="btn"
            @click="closeErrorNotice()"
          >{{ notice.secondaryText }}</button>
          <button
            type="button"
            class="btn btn-primary"
            @click="runErrorNoticePrimary()"
          >{{ notice.primaryText || t('common.ok') }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { Info, Timer, Wallet } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import {
  closeErrorNotice,
  runErrorNoticePrimary,
  useErrorNotice,
} from '~/composables/useErrorNotice'

const { t } = useI18n()
const notice = useErrorNotice()
const titleId = 'lotus-error-notice-title'
const descId = 'lotus-error-notice-desc'

function onKeydown(e) {
  if (!notice.open) return
  if (e.key === 'Escape') closeErrorNotice()
  if (e.key === 'Enter') runErrorNoticePrimary()
}

watch(() => notice.open, (v) => {
  if (v) window.addEventListener('keydown', onKeydown)
  else window.removeEventListener('keydown', onKeydown)
})

onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
.notice-dialog {
  width: 420px;
  max-width: calc(100vw - 48px);
  padding: 28px 24px 20px;
  align-items: center;
  text-align: center;
}
.notice-icon {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 14px;
  background: var(--accent-bg);
  color: var(--accent-text);
}
.notice-icon.balance {
  background: color-mix(in srgb, var(--warning, #d97706) 16%, var(--surface-raised));
  color: var(--warning, #d97706);
}
.notice-icon.rateLimit {
  background: color-mix(in srgb, var(--accent) 16%, var(--surface-raised));
  color: var(--accent-text);
}
.notice-title {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--text-0);
}
.notice-message {
  margin-top: 8px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-2);
  max-width: 340px;
  word-break: break-word;
  white-space: pre-line;
}
.notice-actions {
  display: flex;
  gap: 10px;
  width: 100%;
  margin-top: 22px;
}
.notice-actions .btn { flex: 1; }
</style>
