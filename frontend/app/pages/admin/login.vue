<template>
  <div class="login-page">
    <div class="panel">
      <div class="brand">
        <span class="mark">管</span>
        <h1>{{ t('admin.title') }}</h1>
        <p>{{ t('admin.loginSub') }}</p>
      </div>

      <form class="form" @submit.prevent="submit">
        <label class="field">
          <span>{{ t('admin.username') }}</span>
          <input v-model.trim="username" class="input" autocomplete="username" required maxlength="32" />
        </label>
        <label class="field">
          <span>{{ t('admin.password') }}</span>
          <input v-model="password" class="input" type="password" autocomplete="current-password" required minlength="6" />
        </label>
        <p v-if="error" class="error">{{ error }}</p>
        <button class="btn btn-primary submit" type="submit" :disabled="loading">
          {{ loading ? t('auth.submitting') : t('admin.login') }}
        </button>
      </form>

      <NuxtLink class="back" to="/app">{{ t('admin.backApp') }}</NuxtLink>
    </div>
  </div>
</template>

<script setup>
import { useI18n } from 'vue-i18n'

definePageMeta({ layout: false })

const { t } = useI18n()
const route = useRoute()
const auth = useAuth()

const username = ref('admin')
const password = ref('')
const loading = ref(false)
const error = ref('')

onMounted(async () => {
  await auth.ensureReady()
  if (auth.isLoggedIn.value && auth.user.value?.role === 'admin') {
    navigateTo('/admin')
  }
})

async function submit() {
  error.value = ''
  loading.value = true
  try {
    const user = await auth.login(username.value, password.value)
    if (user?.role !== 'admin') {
      auth.logout()
      error.value = t('admin.loginNeedAdmin')
      return
    }
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/admin'
    await navigateTo(redirect.startsWith('/admin') ? redirect : '/admin')
  } catch (e) {
    error.value = e?.message || t('auth.failed')
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
  background:
    radial-gradient(700px 360px at 20% 10%, color-mix(in srgb, var(--accent) 16%, transparent), transparent 65%),
    var(--bg);
}
.panel {
  width: min(400px, 100%);
  padding: 28px 24px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border);
  background: var(--surface-raised);
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.brand { text-align: center; }
.mark {
  width: 44px;
  height: 44px;
  margin: 0 auto 10px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  font-weight: 800;
  background: var(--accent);
  color: var(--accent-contrast, #fff);
}
.brand h1 { margin: 0; font-size: 20px; }
.brand p { margin: 6px 0 0; color: var(--text-3); font-size: 13px; }
.form { display: flex; flex-direction: column; gap: 12px; }
.field { display: flex; flex-direction: column; gap: 6px; font-size: 12.5px; color: var(--text-2); }
.error { margin: 0; color: var(--warn-text); font-size: 13px; }
.submit { width: 100%; height: 40px; }
.back {
  text-align: center;
  font-size: 12.5px;
  color: var(--text-3);
  text-decoration: none;
}
.back:hover { color: var(--text-0); }
</style>
