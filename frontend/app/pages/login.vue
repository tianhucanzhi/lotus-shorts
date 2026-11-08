<template>
  <div class="login-page">
    <NuxtLink class="login-top-brand" to="/" :aria-label="t('auth.brand')">
      <span class="top-brand-mark">
        <img v-if="showBrandImage" :src="brandLogo" alt="" class="top-brand-logo" @error="showBrandImage = false" />
        <span v-else class="top-brand-fallback">莲</span>
      </span>
      <span class="top-brand-name">{{ t('auth.brand') }}</span>
    </NuxtLink>

    <div class="login-panel">
      <div class="brand-block">
        <div class="brand-mark">
          <img v-if="showBrandImage" :src="brandLogo" alt="莲花短剧" class="brand-logo" @error="showBrandImage = false" />
          <span v-else class="brand-fallback">莲</span>
        </div>
        <h1 class="brand-name">{{ t('auth.brand') }}</h1>
        <p class="brand-sub">{{ t('auth.subtitle') }}</p>
      </div>

      <div class="tabs">
        <button type="button" class="tab" :class="{ on: tab === 'login' }" @click="tab = 'login'">{{ t('auth.login') }}</button>
        <button
          v-if="allowRegister"
          type="button"
          class="tab"
          :class="{ on: tab === 'register' }"
          @click="tab = 'register'"
        >{{ t('auth.register') }}</button>
      </div>

      <form class="form" @submit.prevent="submit">
        <label class="field">
          <span>{{ t('auth.username') }}</span>
          <input v-model.trim="username" class="input" autocomplete="username" required maxlength="32" />
        </label>
        <label class="field">
          <span>{{ t('auth.password') }}</span>
          <input v-model="password" class="input" type="password" autocomplete="current-password" required minlength="6" />
        </label>
        <label v-if="tab === 'register'" class="field">
          <span>{{ t('auth.displayName') }}</span>
          <input v-model.trim="displayName" class="input" autocomplete="nickname" maxlength="32" :placeholder="t('auth.displayNameHint')" />
        </label>

        <p v-if="error" class="error">{{ error }}</p>

        <button class="btn btn-primary submit" type="submit" :disabled="loading">
          {{ loading ? t('auth.submitting') : (tab === 'login' ? t('auth.login') : t('auth.register')) }}
        </button>
      </form>

      <p v-if="!allowRegister && tab === 'login'" class="hint">{{ t('auth.registerClosed') }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import brandLogo from '~/assets/brand-logo.png'

definePageMeta({ layout: false })

const { t } = useI18n()
const route = useRoute()
const auth = useAuth()

const showBrandImage = ref(true)
const tab = ref<'login' | 'register'>('login')
const username = ref('')
const password = ref('')
const displayName = ref('')
const loading = ref(false)
const error = ref('')

const allowRegister = computed(() => auth.allowRegister.value)

function defaultAppPath() {
  return '/app'
}

onMounted(async () => {
  await auth.ensureReady()
  if (!auth.isSaas.value) {
    navigateTo(defaultAppPath())
    return
  }
  // 支持 /login?tab=register 从落地页「免费开始」直达注册
  if (route.query.tab === 'register' && auth.allowRegister.value) tab.value = 'register'
  if (auth.isLoggedIn.value) {
    navigateTo(typeof route.query.redirect === 'string' ? route.query.redirect : defaultAppPath())
  }
})

async function submit() {
  error.value = ''
  loading.value = true
  try {
    if (tab.value === 'login') {
      await auth.login(username.value, password.value)
    } else {
      await auth.register({
        username: username.value,
        password: password.value,
        display_name: displayName.value || undefined,
      })
    }
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : defaultAppPath()
    await navigateTo(redirect || defaultAppPath())
  } catch (e: any) {
    error.value = e?.data?.message || e?.message || t('auth.failed')
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-page {
  position: relative;
  min-height: 100vh;
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: 72px 16px 32px;
  background:
    radial-gradient(ellipse 80% 50% at 20% 10%, rgba(196, 90, 72, 0.14), transparent 55%),
    radial-gradient(ellipse 70% 45% at 90% 80%, rgba(176, 138, 69, 0.12), transparent 50%),
    var(--bg-base, #f6f2e8);
}
.login-top-brand {
  position: absolute;
  top: max(16px, env(safe-area-inset-top));
  left: max(16px, env(safe-area-inset-left));
  z-index: 2;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
  color: inherit;
}
.top-brand-mark {
  width: 30px;
  height: 30px;
  border-radius: 9px;
  overflow: hidden;
  display: grid;
  place-items: center;
  background: var(--accent-bg);
  flex-shrink: 0;
}
.top-brand-logo {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.top-brand-fallback {
  font: 700 14px/1 var(--font-display, Georgia, serif);
  color: var(--accent-text, var(--accent));
}
.top-brand-name {
  font: 700 16px/1 var(--font-display, Georgia, "Noto Serif SC", serif);
  letter-spacing: -0.02em;
  background: var(--accent-gradient, linear-gradient(135deg, #c45a48, #b08a45));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.login-panel {
  width: min(400px, 100%);
  padding: 32px 28px 28px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg, 16px);
  background: var(--panel-bg, #fffdf8);
  box-shadow: var(--shadow-panel);
}
.brand-block {
  text-align: center;
  margin-bottom: 22px;
}
.brand-mark {
  width: 52px;
  height: 52px;
  margin: 0 auto 12px;
  border-radius: 14px;
  overflow: hidden;
  display: grid;
  place-items: center;
  background: var(--accent-bg);
}
.brand-logo { width: 100%; height: 100%; object-fit: cover; }
.brand-fallback {
  font: 700 22px/1 var(--font-display, Georgia, serif);
  color: var(--accent);
}
.brand-name {
  font: 700 22px/1.2 var(--font-display, Georgia, "Noto Serif SC", serif);
  color: var(--text-0);
  letter-spacing: -0.02em;
}
.brand-sub {
  margin-top: 6px;
  color: var(--text-3);
  font: 400 13px/1.4 var(--font-body, system-ui, sans-serif);
}
.tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin-bottom: 18px;
  padding: 4px;
  border-radius: 999px;
  background: var(--surface-muted, #ede6d6);
}
.tabs:has(.tab:only-child) { grid-template-columns: 1fr; }
.tab {
  border: 0;
  background: transparent;
  border-radius: 999px;
  padding: 8px 12px;
  font: 600 13px var(--font-body, system-ui, sans-serif);
  color: var(--text-2);
  cursor: pointer;
}
.tab.on {
  background: var(--surface-raised, #fffdf8);
  color: var(--text-0);
  box-shadow: var(--shadow-xs);
}
.form { display: grid; gap: 14px; }
.field { display: grid; gap: 6px; }
.field span {
  font: 600 12px/1.2 var(--font-body, system-ui, sans-serif);
  color: var(--text-2);
}
.input {
  height: 40px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-input, #fffdf8);
  color: var(--text-0);
  font: 400 14px var(--font-body, system-ui, sans-serif);
  outline: none;
}
.input:focus { border-color: var(--border-focus); box-shadow: 0 0 0 3px var(--button-focus); }
.error {
  margin: 0;
  color: var(--error);
  font-size: 13px;
}
.submit { width: 100%; height: 40px; justify-content: center; }
.hint {
  margin: 14px 0 0;
  text-align: center;
  color: var(--text-3);
  font-size: 12px;
}
@media (max-width: 768px) {
  .login-page {
    padding:
      calc(56px + max(12px, env(safe-area-inset-top)))
      16px
      max(24px, env(safe-area-inset-bottom));
  }
  .login-panel { padding: 24px 18px 20px; }
  .input { font-size: 16px; }
}
</style>
