<template>
  <div class="shell">
    <!-- Header -->
    <header class="header">
      <div class="header-left">
        <button class="brand" @click="navigateTo('/')">
          <div class="brand-mark">
            <img v-if="showBrandImage" :src="brandLogo" alt="莲花短剧" class="brand-logo" @error="showBrandImage = false" />
            <span v-else class="brand-fallback">莲</span>
          </div>
          <div class="brand-text">
            <span class="brand-name">莲花短剧</span>
            <span class="brand-sub">Lotus Shorts</span>
          </div>
        </button>
      </div>

      <nav class="header-nav">
        <NuxtLink to="/app" class="nav-link" :class="{ active: route.path === '/app' || route.path.startsWith('/app/') }">
          <LayoutGrid :size="15" :stroke-width="1.8" />
          <span>{{ t('layout.nav.projects') }}</span>
        </NuxtLink>
        <NuxtLink to="/settings" class="nav-link" :class="{ active: route.path === '/settings' }">
          <Settings :size="15" :stroke-width="1.8" />
          <span>{{ t('layout.nav.settings') }}</span>
        </NuxtLink>
        <NuxtLink v-if="showAdmin" to="/admin" class="nav-link" :class="{ active: route.path === '/admin' }">
          <Shield :size="15" :stroke-width="1.8" />
          <span>{{ t('layout.nav.admin') }}</span>
        </NuxtLink>
      </nav>

      <div class="header-right">
        <ThemeToggle />
        <LocaleSwitcher />
        <div v-if="auth.isSaas.value && auth.user.value" class="user-chip">
          <span class="user-name">{{ auth.user.value.display_name || auth.user.value.username }}</span>
          <span v-if="auth.user.value.role === 'admin'" class="user-role">{{ t('layout.user.admin') }}</span>
          <button type="button" class="btn btn-ghost user-logout" @click="onLogout">{{ t('layout.user.logout') }}</button>
        </div>
      </div>
    </header>

    <!-- AI 服务未配置引导横幅(缺任一类型即提示) -->
    <div v-if="missingConfigLabels.length" class="config-banner">
      <TriangleAlert :size="14" :stroke-width="1.8" />
      <span>{{ t('layout.banner.missing', { types: missingConfigLabels.join(t('common.listJoin')) }) }}</span>
      <NuxtLink to="/settings" class="config-banner-link">{{ t('layout.banner.goSettings') }}</NuxtLink>
    </div>

    <main class="content">
      <slot />
    </main>

    <footer class="app-footer">
      <span>{{ t('layout.footer.copyright', { year: copyrightYear }) }}</span>
      <span class="footer-sep" aria-hidden="true">·</span>
      <nav class="footer-links" :aria-label="t('layout.footer.linksLabel')">
        <a
          v-for="link in footerLinks"
          :key="link.href"
          class="footer-link"
          :href="link.href"
          target="_blank"
          rel="noopener noreferrer"
        >{{ link.label }}</a>
      </nav>
    </footer>
  </div>
</template>

<script setup>
import { LayoutGrid, Settings, Shield, TriangleAlert } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { aiConfigAPI } from '~/composables/useApi'
import brandLogo from '~/assets/brand-logo.png'

const { t, locale } = useI18n()
const route = useRoute()
const auth = useAuth()
const showAdmin = computed(() => !auth.isSaas.value || auth.user.value?.role === 'admin')
const showBrandImage = ref(true)
const copyrightYear = new Date().getFullYear()
const footerLinks = computed(() => [
  { label: t('layout.footer.realApi'), href: 'https://real-api.yunfm.cn' },
  { label: t('layout.footer.lotusGrowth'), href: 'https://lotus.yunfm.cn' },
])

function onLogout() {
  auth.logout()
  navigateTo('/')
}

// 渲染时求值，语言切换即时生效（不能模块级常量固化）
const SERVICE_TYPE_LABELS = computed(() => ({
  text: t('common.serviceType.text'),
  image: t('common.serviceType.image'),
  video: t('common.serviceType.video'),
}))
const missingConfigLabels = ref([])
const { tick: aiConfigBannerTick } = useAiConfigBanner()

function isConfigActive(c) {
  return c?.is_active === true || c?.is_active === 1 || c?.is_active === '1'
}

async function checkAiConfigs() {
  try {
    const configs = await aiConfigAPI.list()
    const labels = SERVICE_TYPE_LABELS.value
    missingConfigLabels.value = Object.entries(labels)
      .filter(([type]) => !configs.some(c => c.service_type === type && isConfigActive(c)))
      .map(([, label]) => label)
  } catch { /* 配置检查失败不阻塞页面 */ }
}

onMounted(checkAiConfigs)
// 设置页保存配置后返回时重新检查(布局跨页面复用,onMounted 只触发一次)
watch(() => route.path, checkAiConfigs)
// 设置页写入配置后即时刷新横幅（同页不换路由）
watch(aiConfigBannerTick, checkAiConfigs)
// 切换界面语言时横幅中已拼接的类型文案需要重算
watch(locale, checkAiConfigs)
</script>

<style scoped>
.shell {
  display: flex; flex-direction: column;
  height: 100vh; height: 100dvh; overflow: hidden;
  background: transparent;
}

/* === Header === */
.header {
  display: flex; align-items: center;
  height: 60px; flex-shrink: 0;
  padding: 0 24px;
  gap: 32px;
  background: var(--header-bg);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border-bottom: 1px solid var(--border);
  position: relative; z-index: 10;
}

.header-left { display: flex; align-items: center; }

.brand {
  display: flex; align-items: center; gap: 11px;
  background: transparent; border: none; cursor: pointer; padding: 4px 8px 4px 4px;
  text-decoration: none; border-radius: var(--radius);
  transition: background 0.18s var(--ease-out);
}
.brand:hover { background: var(--bg-hover); }
.brand:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3.5px var(--button-focus);
}
.brand-mark {
  width: 32px; height: 32px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 9px;
  overflow: hidden;
}
.brand-logo {
  width: 28px;
  height: 28px;
  object-fit: contain;
  display: block;
}
.brand-fallback {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-0);
  line-height: 1;
}
.brand-text { display: flex; flex-direction: column; align-items: flex-start; line-height: 1.15; }
.brand-name {
  font-size: 15px; font-weight: 700;
  /* 品牌字标：陶土金渐变 */
  background: var(--accent-gradient);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  letter-spacing: -0.01em;
}
.brand-sub {
  font-size: 10px; font-weight: 400;
  color: var(--text-3); margin-top: 1px;
  letter-spacing: 0.04em;
}

/* Nav — pill segmented group */
.header-nav {
  display: flex; gap: 2px;
  padding: 3px;
  border-radius: var(--radius-pill);
  background: var(--overlay-track);
}

/* Header 右侧 — 语言切换器 / 用户 */
.header-right {
  margin-left: auto;
  display: flex; align-items: center; gap: 8px;
}
.user-chip {
  display: flex; align-items: center; gap: 8px;
  margin-left: 4px;
  padding: 4px 4px 4px 12px;
  border-radius: var(--radius-pill);
  background: var(--overlay-track);
}
.user-name {
  font-size: 12.5px; font-weight: 600; color: var(--text-1);
  max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.user-role {
  font-size: 10.5px; font-weight: 600; color: var(--accent-text);
  padding: 2px 7px; border-radius: var(--radius-pill);
  background: var(--accent-bg);
}
.user-logout {
  height: 28px !important;
  padding: 0 10px !important;
  font-size: 12px !important;
}
.nav-link {
  display: flex; align-items: center; gap: 6px;
  min-height: 32px;
  padding: 0 16px; border-radius: var(--radius-pill);
  font-size: 13px; font-weight: 600;
  color: var(--text-2); text-decoration: none;
  transition: all 0.18s var(--ease-out);
  border: none;
  line-height: 1;
}
.nav-link:hover { color: var(--text-0); }
.nav-link.active {
  background: var(--seg-active-bg);
  color: var(--text-0);
  box-shadow: 0 1px 4px rgba(0,0,0,0.1);
}
.nav-link:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3.5px var(--button-focus);
}

/* Config banner — AI 服务未配置引导 */
.config-banner {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 24px; flex-shrink: 0;
  font-size: 12.5px; color: var(--warn-text);
  background: var(--warn-bg);
  border-bottom: 1px solid var(--warn-border);
  position: relative; z-index: 9;
}
.config-banner-link {
  margin-left: auto;
  font-size: 12.5px; font-weight: 600;
  color: var(--warn-link); text-decoration: none;
  padding: 2px 10px; border-radius: var(--radius-pill);
  border: 1px solid var(--warn-border);
  transition: all 0.18s var(--ease-out);
  line-height: 1.6;
}
.config-banner-link:hover { background: var(--warn-link-hover-bg); color: var(--warn-text); }

/* Content */
.content { flex: 1; overflow: hidden; display: flex; flex-direction: column; }

.app-footer {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  height: 36px;
  padding: 0 24px;
  border-top: 1px solid var(--border);
  background: var(--header-bg);
  font-size: 11.5px;
  color: var(--text-3);
  letter-spacing: 0.02em;
  user-select: none;
}
.footer-sep { opacity: 0.55; }
.footer-links {
  display: flex;
  align-items: center;
  gap: 12px;
}
.footer-link {
  color: var(--text-3);
  text-decoration: none;
  transition: color 0.18s var(--ease-out);
}
.footer-link:hover { color: var(--text-1); }
.footer-link:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3.5px var(--button-focus);
  border-radius: 4px;
}

@media (max-width: 768px) {
  .header {
    height: auto;
    min-height: 52px;
    flex-wrap: wrap;
    padding: max(8px, env(safe-area-inset-top)) 12px 8px;
    gap: 8px 10px;
  }
  .brand { gap: 8px; padding: 2px 4px; }
  .brand-sub { display: none; }
  .header-nav {
    order: 3;
    width: 100%;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
  .nav-link { flex-shrink: 0; padding: 0 12px; }
  .header-right { gap: 4px; }
  .user-chip { padding-left: 8px; gap: 6px; }
  .user-name { max-width: 72px; }
  .user-role { display: none; }
  .config-banner {
    flex-wrap: wrap;
    padding: 8px 12px;
    line-height: 1.45;
  }
  .config-banner-link { margin-left: 0; }
  .app-footer {
    height: auto;
    flex-wrap: wrap;
    justify-content: center;
    row-gap: 2px;
    padding: 8px 12px max(8px, env(safe-area-inset-bottom));
    text-align: center;
  }
}
</style>
