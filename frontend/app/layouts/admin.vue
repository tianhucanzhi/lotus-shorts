<template>
  <div class="admin-shell">
    <aside class="sidebar">
      <button type="button" class="brand" @click="navigateTo('/admin')">
        <span class="brand-mark">管</span>
        <div class="brand-text">
          <strong>{{ t('admin.title') }}</strong>
          <span>{{ t('admin.console') }}</span>
        </div>
      </button>

      <nav class="nav">
        <NuxtLink
          v-for="item in nav"
          :key="item.to"
          :to="item.to"
          class="nav-item"
          :class="{ active: isActive(item.to) }"
        >
          <component :is="item.icon" :size="16" :stroke-width="1.8" />
          <span>{{ item.label }}</span>
        </NuxtLink>
      </nav>

      <div class="sidebar-foot">
        <NuxtLink to="/app" class="back-link">{{ t('admin.backApp') }}</NuxtLink>
      </div>
    </aside>

    <div class="main">
      <header class="topbar">
        <div>
          <h1>{{ pageTitle }}</h1>
          <p>{{ t('admin.sub') }}</p>
        </div>
        <div class="top-actions">
          <ThemeToggle />
          <LocaleSwitcher />
          <div v-if="auth.user.value" class="user">
            <span>{{ auth.user.value.display_name || auth.user.value.username }}</span>
            <button type="button" class="btn btn-ghost btn-sm" @click="onLogout">{{ t('layout.user.logout') }}</button>
          </div>
        </div>
      </header>
      <main class="content">
        <slot />
      </main>
    </div>
  </div>
</template>

<script setup>
import {
  Activity,
  Clapperboard,
  LayoutDashboard,
  Palette,
  Server,
  Sparkles,
  Users,
} from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const route = useRoute()
const auth = useAuth()

const nav = computed(() => [
  { to: '/admin', label: t('admin.tabs.overview'), icon: LayoutDashboard },
  { to: '/admin/users', label: t('admin.tabs.users'), icon: Users },
  { to: '/admin/projects', label: t('admin.tabs.projects'), icon: Clapperboard },
  { to: '/admin/tasks', label: t('admin.tabs.tasks'), icon: Activity },
  { to: '/admin/styles', label: t('admin.tabs.styles'), icon: Palette },
  { to: '/admin/ai-configs', label: t('admin.tabs.aiConfigs'), icon: Sparkles },
  { to: '/admin/system', label: t('admin.tabs.system'), icon: Server },
])

const pageTitle = computed(() => {
  const hit = nav.value.find(n => isActive(n.to))
  return hit?.label || t('admin.title')
})

function isActive(to) {
  if (to === '/admin') return route.path === '/admin'
  return route.path === to || route.path.startsWith(`${to}/`)
}

function onLogout() {
  auth.logout()
  navigateTo('/admin/login')
}
</script>

<style scoped>
.admin-shell {
  display: grid;
  grid-template-columns: 232px 1fr;
  height: 100%;
  height: 100dvh;
  overflow: hidden;
  background:
    radial-gradient(900px 420px at 0% 0%, color-mix(in srgb, var(--accent) 10%, transparent), transparent 60%),
    var(--bg);
  color: var(--text-0);
}
.sidebar {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 18px 14px;
  border-right: 1px solid var(--border);
  background: color-mix(in srgb, var(--surface-raised) 88%, transparent);
  backdrop-filter: blur(10px);
  min-height: 0;
  overflow: auto;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: left;
  padding: 4px 6px;
}
.brand-mark {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  font-weight: 800;
  background: var(--accent);
  color: var(--accent-contrast, #fff);
}
.brand-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.brand-text strong { font-size: 14px; }
.brand-text span { font-size: 11px; color: var(--text-3); }
.nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 36px;
  padding: 0 12px;
  border-radius: var(--radius);
  color: var(--text-2);
  text-decoration: none;
  font-size: 13px;
  font-weight: 600;
}
.nav-item:hover { background: var(--overlay-track); color: var(--text-0); }
.nav-item.active {
  background: var(--seg-active-bg);
  color: var(--text-0);
}
.sidebar-foot { padding: 4px 6px 8px; }
.back-link {
  font-size: 12px;
  color: var(--text-3);
  text-decoration: none;
}
.back-link:hover { color: var(--text-0); }
.main {
  min-width: 0;
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.topbar {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
  padding: 18px 24px 10px;
  flex-shrink: 0;
}
.topbar h1 { margin: 0; font-size: 20px; font-weight: 800; letter-spacing: -0.02em; }
.topbar p { margin: 4px 0 0; color: var(--text-3); font-size: 12.5px; }
.top-actions { display: flex; align-items: center; gap: 10px; }
.user {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-2);
}
.content {
  flex: 1;
  min-height: 0;
  padding: 8px 24px 40px;
  overflow: auto;
  -webkit-overflow-scrolling: touch;
}
@media (max-width: 900px) {
  .admin-shell {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr;
  }
  .sidebar {
    border-right: none;
    border-bottom: 1px solid var(--border);
    padding-bottom: 10px;
    overflow: visible;
  }
  .nav { flex-direction: row; overflow-x: auto; flex: 0; }
  .nav-item { flex-shrink: 0; }
  .sidebar-foot { display: none; }
  .content { padding: 8px 14px 32px; }
  .topbar { padding: 14px 14px 6px; flex-wrap: wrap; }
}
</style>
