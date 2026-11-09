<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
  <Toaster position="top-right" :duration="3000" :theme="resolvedTheme" />
  <ErrorNoticeDialog />
  <MigrateOverlay />
  <ContactFloat v-if="!isLandingPath(route.path)" />
  <noscript>
    <div class="seo-noscript">
      <h1>{{ t('seo.noscriptTitle') }}</h1>
      <p>{{ t('seo.noscriptBody') }}</p>
    </div>
  </noscript>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { Toaster, toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import ContactFloat from '~/components/ContactFloat.vue'
import ErrorNoticeDialog from '~/components/ErrorNoticeDialog.vue'
import MigrateOverlay from '~/components/MigrateOverlay.vue'
import { useDesktopBridge } from '~/composables/useDesktopBridge'
import { useMigrateState } from '~/composables/useMigrateState'
import { useTheme } from '~/composables/useTheme'

const { t, locale } = useI18n()
const route = useRoute()
const { resolvedTheme } = useTheme()

const SITE_ORIGIN = 'https://shorts.yunfm.cn'
/** 微信/社交分享封面（绝对地址；换图时 bump 版本号） */
const OG_IMAGE = `${SITE_ORIGIN}/og-cover.jpg?v=20261110`

const HTML_LANG: Record<string, string> = { zh: 'zh-CN', en: 'en', ja: 'ja', ko: 'ko' }
const OG_LOCALE: Record<string, string> = { zh: 'zh_CN', en: 'en_US', ja: 'ja_JP', ko: 'ko_KR' }

function isPublicPath(path: string) {
  return path === '/' || path === '/login'
}

function isLandingPath(path: string) {
  return path === '/'
}

// 静态 head 在 nuxt.config（无 JS 也能被抓到）；这里按路由和界面语言覆盖
useHead(() => {
  const path = route.path
  const publicPage = isPublicPath(path)
  const title = path === '/login'
    ? t('seo.loginTitle')
    : path.startsWith('/admin')
      ? t('seo.adminTitle')
      : path.startsWith('/settings')
        ? t('seo.settingsTitle')
        : path.startsWith('/drama')
          ? t('seo.projectTitle')
          : path.startsWith('/app')
            ? t('seo.appTitle')
            : isLandingPath(path)
              ? t('seo.landingTitle')
              : t('seo.title')
  const description = path === '/login'
    ? t('seo.loginDescription')
    : isLandingPath(path)
      ? t('seo.landingDescription')
      : t('seo.description')
  const ogDescription = path === '/login'
    ? description
    : isLandingPath(path)
      ? t('seo.landingDescription')
      : t('seo.ogDescription')
  const canonical = `${SITE_ORIGIN}${path === '/' ? '/' : path}`
  return {
    htmlAttrs: { lang: HTML_LANG[locale.value] || 'zh-CN' },
    title,
    meta: [
      { name: 'description', content: description },
      { name: 'keywords', content: t('seo.keywords') },
      { name: 'robots', content: publicPage ? 'index, follow, max-image-preview:large' : 'noindex, nofollow' },
      { property: 'og:type', content: 'website' },
      { property: 'og:title', content: title },
      { property: 'og:description', content: ogDescription },
      { property: 'og:url', content: canonical },
      { property: 'og:site_name', content: t('seo.siteName') },
      { property: 'og:locale', content: OG_LOCALE[locale.value] || 'zh_CN' },
      { property: 'og:image', content: OG_IMAGE },
      { property: 'og:image:secure_url', content: OG_IMAGE },
      { property: 'og:image:type', content: 'image/jpeg' },
      { property: 'og:image:width', content: '1200' },
      { property: 'og:image:height', content: '630' },
      { property: 'og:image:alt', content: t('seo.siteName') },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: title },
      { name: 'twitter:description', content: ogDescription },
      { name: 'twitter:image', content: OG_IMAGE },
    ],
    link: [
      { rel: 'canonical', href: canonical },
    ],
  }
})

const bridge = useDesktopBridge()
const { state, begin, update, end } = useMigrateState()

onMounted(() => {
  if (!bridge) return
  bridge.onMigrateProgress((p) => {
    if (p.phase === 'done') {
      update(p)
      // 稍等遮罩展示「完成」，再刷新页面让所有数据源指向新目录
      setTimeout(() => { end(); location.reload() }, 800)
      return
    }
    if (p.phase === 'error') {
      end()
      return // 错误 toast 由触发方（设置页）提示
    }
    if (!state.active) begin()
    update(p)
  })

  // 启动静默检查更新（主进程 20s 后自检一次，这里稍后取结果提示一次）
  setTimeout(async () => {
    try {
      const s = await bridge.getUpdateState()
      if (s?.status === 'available') {
        toast.info(t('app.updateAvailable', { version: s.latestVersion }), { duration: 8000 })
      }
    } catch { /* 静默 */ }
  }, 25_000)
})
</script>

<style>
@import url('./assets/studio.css');

.seo-noscript {
  max-width: 720px;
  margin: 48px auto;
  padding: 0 24px;
  color: #222;
  font: 16px/1.7 system-ui, sans-serif;
}
.seo-noscript h1 { font-size: 28px; margin: 0 0 12px; }

/* === 应用内引导（driver.js）主题覆写 — 跟随设计 token === */
.lotus-tour-popover {
  background: var(--surface-raised) !important;
  color: var(--text-1) !important;
  border: 1px solid var(--border) !important;
  border-radius: var(--radius-lg) !important;
  box-shadow: var(--shadow-elevated) !important;
  max-width: 340px;
}
.lotus-tour-popover .driver-popover-title {
  color: var(--text-0) !important;
  font: 700 14px/1.3 var(--font-body) !important;
  letter-spacing: -0.01em;
}
.lotus-tour-popover .driver-popover-description {
  color: var(--text-2) !important;
  font: 400 12.5px/1.65 var(--font-body) !important;
}
.lotus-tour-popover .driver-popover-progress-text {
  color: var(--text-3) !important;
  font-size: 10.5px !important;
}
.lotus-tour-popover .driver-popover-close-btn {
  color: var(--text-3) !important;
}
.lotus-tour-popover .driver-popover-navigation-btns {
  gap: 6px;
}
.lotus-tour-popover .driver-popover-navigation-btns button {
  background: var(--button-bg) !important;
  color: var(--button-text) !important;
  border: none !important;
  border-radius: var(--radius-pill) !important;
  padding: 5px 14px !important;
  font: 600 12px var(--font-body) !important;
  text-shadow: none !important;
  cursor: pointer;
}
.lotus-tour-popover .driver-popover-navigation-btns button.driver-popover-next-btn,
.lotus-tour-popover .driver-popover-navigation-btns button.driver-popover-done-btn {
  background: var(--accent-gradient) !important;
  color: var(--on-accent) !important;
}
.driver-overlay {
  background: var(--scrim) !important;
  backdrop-filter: blur(2px);
}
/* 高亮框描边用品牌橙 */
.driver-active-element .driver-popover-arrow svg path,
.driver-active-element .driver-popover-arrow svg polygon {
  fill: var(--accent) !important;
}
</style>
