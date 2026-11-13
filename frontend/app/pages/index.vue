<template>
  <div class="landing">
    <header class="lp-nav">
      <button type="button" class="lp-brand" @click="scrollToSection('top')">
        <img v-if="showBrand" :src="brandLogo" alt="" class="lp-brand-mark" @error="showBrand = false" />
        <span v-else class="lp-brand-fallback">莲</span>
        <span class="lp-brand-name">{{ t('landing.brand') }}</span>
      </button>
      <nav class="lp-nav-links" aria-label="page">
        <button type="button" class="lp-link" @click="scrollToSection('flow')">{{ t('landing.nav.flow') }}</button>
        <button type="button" class="lp-link" @click="scrollToSection('samples')">{{ t('landing.nav.samples') }}</button>
        <button type="button" class="lp-link" @click="scrollToSection('cost')">{{ t('landing.nav.cost') }}</button>
        <button type="button" class="lp-link" @click="scrollToSection('pricing')">{{ t('landing.nav.pricing') }}</button>
      </nav>
      <div class="lp-nav-actions">
        <LocaleSwitcher />
        <NuxtLink v-if="auth.isLoggedIn.value" class="btn btn-primary" to="/app">{{ t('landing.nav.openApp') }}</NuxtLink>
        <template v-else>
          <NuxtLink class="btn btn-ghost" to="/login">{{ t('landing.nav.login') }}</NuxtLink>
          <NuxtLink class="btn btn-primary" to="/login?tab=register">{{ t('landing.nav.start') }}</NuxtLink>
        </template>
      </div>
    </header>

    <main>
      <!-- Hero：一屏一句话 + 品牌 + CTA + 全幅视觉 -->
      <section id="top" class="lp-hero">
        <div class="lp-hero-copy">
          <p class="lp-brand-hero">{{ t('landing.brand') }}</p>
          <h1 class="lp-headline">{{ t('landing.hero.headline') }}</h1>
          <p class="lp-support">{{ t('landing.hero.support') }}</p>
          <div class="lp-hero-cta">
            <NuxtLink class="btn btn-primary lp-cta-main" to="/login?tab=register">{{ t('landing.hero.ctaPrimary') }}</NuxtLink>
            <button type="button" class="btn lp-cta-secondary" @click="scrollToSection('samples')">{{ t('landing.hero.ctaSecondary') }}</button>
          </div>
        </div>
        <div class="lp-hero-stage">
          <button type="button" class="phone-frame" :aria-label="t('landing.hero.mockTitle')" @click="openSample(heroSample, 'ep1')">
            <div class="phone-notch" />
            <div class="phone-screen">
              <video
                class="phone-video"
                :src="HERO_SAMPLE_VIDEO"
                muted
                autoplay
                loop
                playsinline
                preload="metadata"
              />
              <div class="phone-chip">9:16</div>
              <div class="phone-scene">
                <span class="phone-title">{{ t('landing.hero.mockTitle') }}</span>
                <span class="phone-sub">{{ t('landing.hero.mockSub') }}</span>
              </div>
            </div>
          </button>
          <div class="hero-glow" />
        </div>
      </section>

      <!-- 三步流程 -->
      <section id="flow" class="lp-section">
        <header class="lp-section-head">
          <h2>{{ t('landing.flow.title') }}</h2>
          <p>{{ t('landing.flow.sub') }}</p>
        </header>
        <ol class="flow-grid">
          <li v-for="(step, i) in steps" :key="step.key" class="flow-card">
            <button
              v-if="step.shot"
              type="button"
              class="flow-shot is-zoomable"
              :class="`shot-${i + 1}`"
              :aria-label="t('landing.flow.previewShot', { title: step.title })"
              @click="openShotPreview(step)"
            >
              <div class="shot-chrome">
                <span /><span /><span />
              </div>
              <div class="shot-body">
                <img :src="step.shot" :alt="step.title" class="shot-img" loading="lazy" />
                <span class="shot-zoom" aria-hidden="true">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M11 8v6M8 11h6"/></svg>
                </span>
              </div>
            </button>
            <div v-else class="flow-shot" :class="`shot-${i + 1}`">
              <div class="shot-chrome">
                <span /><span /><span />
              </div>
              <div class="shot-body">
                <component :is="step.mock" />
              </div>
            </div>
            <div class="flow-meta">
              <span class="flow-index">{{ String(i + 1).padStart(2, '0') }}</span>
              <h3>{{ step.title }}</h3>
              <p>{{ step.desc }}</p>
            </div>
          </li>
        </ol>
      </section>

      <!-- 样片墙 -->
      <section id="samples" class="lp-section lp-section-muted">
        <header class="lp-section-head">
          <h2>{{ t('landing.samples.title') }}</h2>
          <p>{{ t('landing.samples.sub') }}</p>
        </header>
        <div class="sample-grid">
          <button
            v-for="s in sampleCards"
            :key="s.id"
            type="button"
            class="sample-card"
            @click="openSample(s)"
          >
            <div class="sample-poster" :style="{ backgroundImage: s.poster ? `url(${s.poster})` : undefined }">
              <span class="sample-play" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
              </span>
              <span class="sample-eps">{{ s.eps }}</span>
            </div>
            <div class="sample-info">
              <strong>{{ s.title }}</strong>
              <span>{{ s.style }}</span>
            </div>
          </button>
        </div>
      </section>

      <!-- 成本对比 -->
      <section id="cost" class="lp-section">
        <header class="lp-section-head">
          <h2>{{ t('landing.cost.title') }}</h2>
          <p>{{ t('landing.cost.sub') }}</p>
        </header>
        <div class="cost-compare">
          <article class="cost-col is-old">
            <h3>{{ t('landing.cost.traditionalTitle') }}</h3>
            <p class="cost-num">{{ t('landing.cost.traditionalMoney') }}</p>
            <p class="cost-time">{{ t('landing.cost.traditionalTime') }}</p>
            <ul>
              <li v-for="(line, i) in traditionalPoints" :key="i">{{ line }}</li>
            </ul>
          </article>
          <article class="cost-col is-new">
            <h3>{{ t('landing.cost.lotusTitle') }}</h3>
            <p class="cost-num">{{ t('landing.cost.lotusMoney') }}</p>
            <p class="cost-time">{{ t('landing.cost.lotusTime') }}</p>
            <ul>
              <li v-for="(line, i) in lotusPoints" :key="i">{{ line }}</li>
            </ul>
          </article>
        </div>
        <p class="cost-note">{{ t('landing.cost.note') }}</p>
      </section>

      <!-- 价格三档 -->
      <section id="pricing" class="lp-section lp-section-muted">
        <header class="lp-section-head">
          <h2>{{ t('landing.pricing.title') }}</h2>
          <p>{{ t('landing.pricing.sub') }}</p>
        </header>
        <div class="price-grid">
          <article
            v-for="plan in plans"
            :key="plan.key"
            class="price-card"
            :class="{ featured: plan.featured }"
          >
            <h3>{{ plan.name }}</h3>
            <p class="price-amount">{{ plan.price }}</p>
            <p class="price-desc">{{ plan.desc }}</p>
            <ul>
              <li v-for="(f, i) in plan.features" :key="i">{{ f }}</li>
            </ul>
            <NuxtLink class="btn" :class="plan.featured ? 'btn-primary' : ''" :to="plan.to">
              {{ plan.cta }}
            </NuxtLink>
          </article>
        </div>
      </section>

      <section class="lp-final">
        <h2>{{ t('landing.final.title') }}</h2>
        <p>{{ t('landing.final.sub') }}</p>
        <NuxtLink class="btn btn-primary lp-cta-main" to="/login?tab=register">{{ t('landing.final.cta') }}</NuxtLink>
      </section>
    </main>

    <footer class="lp-footer">
      <span>{{ t('layout.footer.copyright', { year: year }) }}</span>
      <a href="https://real-api.yunfm.cn" target="_blank" rel="noopener noreferrer">{{ t('layout.footer.realApi') }}</a>
      <a href="https://lotus.yunfm.cn" target="_blank" rel="noopener noreferrer">{{ t('layout.footer.lotusGrowth') }}</a>
    </footer>

    <!-- 流程截图放大 -->
    <div v-if="shotPreview" class="shot-overlay" @click.self="closeShotPreview">
      <div class="shot-lightbox" role="dialog" aria-modal="true" :aria-label="shotPreview.title">
        <header class="shot-lightbox-head">
          <div>
            <strong>{{ shotPreview.title }}</strong>
            <span>{{ shotPreview.desc }}</span>
          </div>
          <button type="button" class="sample-close" :aria-label="t('common.close')" @click="closeShotPreview">×</button>
        </header>
        <div class="shot-lightbox-body">
          <img :src="shotPreview.shot" :alt="shotPreview.title" />
        </div>
      </div>
    </div>

    <!-- 样片播放层 -->
    <div v-if="activeSample" class="sample-overlay" @click.self="closeSample">
      <div class="sample-dialog" role="dialog" aria-modal="true" :aria-label="activeSample.title">
        <header class="sample-dialog-head">
          <div class="sample-dialog-meta">
            <strong>{{ activeSample.title }}</strong>
            <span>{{ activeSample.style }}</span>
          </div>
          <button type="button" class="sample-close" :aria-label="t('common.close')" @click="closeSample">×</button>
        </header>

        <div class="sample-dialog-body">
          <div class="sample-player" :class="{ vertical: !!activeEpisode?.video }">
            <video
              v-if="activeEpisode?.video"
              :key="activeEpisode.id"
              controls
              autoplay
              playsinline
              :poster="activeSample.poster || undefined"
              :src="activeEpisode.video"
            />
            <div v-else class="sample-fallback">
              <p>{{ t('landing.samples.noVideo') }}</p>
              <NuxtLink class="btn btn-primary" to="/login?tab=register" @click="closeSample">{{ t('landing.nav.start') }}</NuxtLink>
            </div>
          </div>

          <aside v-if="activeSample.episodes?.length" class="sample-eps-panel">
            <div class="sample-eps-head">
              <span class="sample-eps-label">{{ t('landing.samples.episodePick') }}</span>
              <span class="sample-eps-count">{{ t('landing.samples.episodeCount', { n: activeSample.episodes.length }) }}</span>
            </div>
            <div class="sample-eps-list" role="listbox" :aria-label="t('landing.samples.episodePick')">
              <button
                v-for="ep in activeSample.episodes"
                :key="ep.id"
                type="button"
                role="option"
                class="sample-ep-chip"
                :class="{ on: ep.id === activeEpisodeId }"
                :aria-selected="ep.id === activeEpisodeId"
                @click="selectEpisode(ep.id)"
              >
                <span class="ep-num">{{ t('landing.samples.episodeN', { n: ep.n }) }}</span>
                <span class="ep-dur">{{ ep.duration }}</span>
                <span v-if="ep.id === activeEpisodeId" class="ep-now">{{ t('landing.samples.playing') }}</span>
              </button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import brandLogo from '~/assets/brand-logo.png'
import LocaleSwitcher from '~/components/LocaleSwitcher.vue'

definePageMeta({ layout: false })

const { t } = useI18n()
const auth = useAuth()
const showBrand = ref(true)
const year = new Date().getFullYear()
const activeSample = ref(null)
const activeEpisodeId = ref('')
const shotPreview = ref(null)

/** 持械入宋 · OSS 成片（顶部手机位） */
const SERIES_CHI_XIE = {
  ep1: 'https://medstatic.oss-cn-shanghai.aliyuncs.com/shorts/01_%E6%8C%81%E6%A2%B0%E5%85%A5%E5%AE%8B_%E7%AC%AC1%E9%9B%86_2%E5%88%8615%E7%A7%92.mp4',
  ep2: 'https://medstatic.oss-cn-shanghai.aliyuncs.com/shorts/02_%E6%8C%81%E6%A2%B0%E5%85%A5%E5%AE%8B_%E7%AC%AC2%E9%9B%86_1%E5%88%8645%E7%A7%92.mp4',
  ep3: 'https://medstatic.oss-cn-shanghai.aliyuncs.com/shorts/03_%E6%8C%81%E6%A2%B0%E5%85%A5%E5%AE%8B_%E7%AC%AC3%E9%9B%86_1%E5%88%8655%E7%A7%92.mp4',
  ep4: 'https://medstatic.oss-cn-shanghai.aliyuncs.com/shorts/04_%E6%8C%81%E6%A2%B0%E5%85%A5%E5%AE%8B_%E7%AC%AC4%E9%9B%86_1%E5%88%8659%E7%A7%92.mp4',
  ep5: 'https://medstatic.oss-cn-shanghai.aliyuncs.com/shorts/05_%E6%8C%81%E6%A2%B0%E5%85%A5%E5%AE%8B_%E7%AC%AC5%E9%9B%86_1%E5%88%8648%E7%A7%92.mp4',
}
/** 北凉憨世子 · OSS 成片 */
const SERIES_BEI_LIANG = {
  ep1: 'https://medstatic.oss-cn-shanghai.aliyuncs.com/shorts/01_%E7%AC%AC1%E9%9B%86.mp4',
  ep2: 'https://medstatic.oss-cn-shanghai.aliyuncs.com/shorts/02_%E7%AC%AC2%E9%9B%86.mp4',
  ep3: 'https://medstatic.oss-cn-shanghai.aliyuncs.com/shorts/03_%E7%AC%AC3%E9%9B%86.mp4',
  ep4: 'https://medstatic.oss-cn-shanghai.aliyuncs.com/shorts/04_%E7%AC%AC4%E9%9B%86.mp4',
  ep5: 'https://medstatic.oss-cn-shanghai.aliyuncs.com/shorts/05_%E7%AC%AC5%E9%9B%86.mp4',
}
/** 寒门枭雄 · OSS 成片 */
const SERIES_HAN_MEN = {
  ep1: 'https://medstatic.oss-cn-shanghai.aliyuncs.com/shorts/01_%E5%AF%92%E9%97%A8%E6%9E%AD%E9%9B%84%E5%AE%9A%E5%A4%A9%E4%B8%8B_%E7%AC%AC1%E9%9B%86_1%E5%88%8605%E7%A7%92.mp4',
  ep2: 'https://medstatic.oss-cn-shanghai.aliyuncs.com/shorts/02_%E5%AF%92%E9%97%A8%E6%9E%AD%E9%9B%84%E5%AE%9A%E5%A4%A9%E4%B8%8B_%E7%AC%AC2%E9%9B%86_1%E5%88%8643%E7%A7%92.mp4',
  ep3: 'https://medstatic.oss-cn-shanghai.aliyuncs.com/shorts/03_%E5%AF%92%E9%97%A8%E6%9E%AD%E9%9B%84%E5%AE%9A%E5%A4%A9%E4%B8%8B_%E7%AC%AC3%E9%9B%86_2%E5%88%8644%E7%A7%92.mp4',
}
/** 问鼎 · OSS 成片 */
const SERIES_WEN_DING = {
  ep1: 'https://medstatic.oss-cn-shanghai.aliyuncs.com/shorts/01_%E9%97%AE%E9%BC%8E%E4%BB%99%E9%80%94_%E7%AC%AC1%E9%9B%86_2%E5%88%8625%E7%A7%92.mp4',
  ep2: 'https://medstatic.oss-cn-shanghai.aliyuncs.com/shorts/02_%E9%97%AE%E9%BC%8E%E4%BB%99%E9%80%94_%E7%AC%AC2%E9%9B%86_1%E5%88%8624%E7%A7%92.mp4',
  ep3: 'https://medstatic.oss-cn-shanghai.aliyuncs.com/shorts/03_%E9%97%AE%E9%BC%8E%E4%BB%99%E9%80%94_%E7%AC%AC3%E9%9B%86_1%E5%88%8644%E7%A7%92.mp4',
}
const HERO_SAMPLE_VIDEO = SERIES_CHI_XIE.ep1

/** 步骤真实截图：public/landing/steps/step-1|2|3.(png|jpg|webp) */
const stepShots = ref(['', '', ''])
const mediaReady = ref(false)
let themeBeforeLanding = ''
/** 还原工作台滚动壳（html/body/#__nuxt 默认 height:100% + overflow:hidden） */
const scrollShellBefore = {
  html: { height: '', overflow: '', overflowY: '' },
  body: { height: '', overflow: '', overflowY: '' },
  nuxt: { height: '', minHeight: '', overflow: '' },
}

function readShellStyles() {
  const html = document.documentElement
  const body = document.body
  const nuxt = document.getElementById('__nuxt')
  scrollShellBefore.html = {
    height: html.style.height,
    overflow: html.style.overflow,
    overflowY: html.style.overflowY,
  }
  scrollShellBefore.body = {
    height: body.style.height,
    overflow: body.style.overflow,
    overflowY: body.style.overflowY,
  }
  if (nuxt) {
    scrollShellBefore.nuxt = {
      height: nuxt.style.height,
      minHeight: nuxt.style.minHeight,
      overflow: nuxt.style.overflow,
    }
  }
}

function unlockLandingScroll() {
  const html = document.documentElement
  const body = document.body
  const nuxt = document.getElementById('__nuxt')
  // 取消 height:100% 壳，让文档按内容增高，窗口可滚
  html.style.height = 'auto'
  html.style.overflow = 'auto'
  html.style.overflowY = 'auto'
  body.style.height = 'auto'
  body.style.overflow = 'visible'
  body.style.overflowY = 'visible'
  if (nuxt) {
    nuxt.style.height = 'auto'
    nuxt.style.minHeight = '100%'
    nuxt.style.overflow = 'visible'
  }
}

function lockPageScroll() {
  document.documentElement.style.overflow = 'hidden'
  document.documentElement.style.overflowY = 'hidden'
  document.body.style.overflow = 'hidden'
  document.body.style.overflowY = 'hidden'
}

function restorePageScroll() {
  if (shotPreview.value || activeSample.value) {
    lockPageScroll()
    return
  }
  unlockLandingScroll()
}

function restoreScrollShell() {
  const html = document.documentElement
  const body = document.body
  const nuxt = document.getElementById('__nuxt')
  html.style.height = scrollShellBefore.html.height
  html.style.overflow = scrollShellBefore.html.overflow
  html.style.overflowY = scrollShellBefore.html.overflowY
  body.style.height = scrollShellBefore.body.height
  body.style.overflow = scrollShellBefore.body.overflow
  body.style.overflowY = scrollShellBefore.body.overflowY
  if (nuxt) {
    nuxt.style.height = scrollShellBefore.nuxt.height
    nuxt.style.minHeight = scrollShellBefore.nuxt.minHeight
    nuxt.style.overflow = scrollShellBefore.nuxt.overflow
  }
}

onMounted(async () => {
  themeBeforeLanding = document.documentElement.dataset.theme || ''
  readShellStyles()
  document.documentElement.dataset.theme = 'light'
  unlockLandingScroll()
  await auth.ensureReady()
  window.addEventListener('keydown', onKey)
  await Promise.all([probeStepShots(), probeSampleMedia()])
  mediaReady.value = true
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKey)
  if (themeBeforeLanding) document.documentElement.dataset.theme = themeBeforeLanding
  else delete document.documentElement.dataset.theme
  restoreScrollShell()
})

function onKey(e) {
  if (e.key !== 'Escape') return
  if (shotPreview.value) closeShotPreview()
  else closeSample()
}

function scrollToSection(id) {
  if (id === 'top') {
    window.scrollTo({ top: 0, behavior: 'smooth' })
    return
  }
  const el = document.getElementById(id)
  if (!el) return
  // 先保证落地页可滚，再定位（避免工作台 overflow:hidden 导致看似无反应）
  unlockLandingScroll()
  requestAnimationFrame(() => {
    const nav = document.querySelector('.lp-nav')
    const offset = (nav instanceof HTMLElement ? nav.offsetHeight : 64) + 8
    const top = el.getBoundingClientRect().top + window.scrollY - offset
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
  })
}

const activeEpisode = computed(() => {
  const eps = activeSample.value?.episodes
  if (!eps?.length) {
    if (!activeSample.value?.video) return null
    return { id: activeSample.value.id, n: 1, duration: '', video: activeSample.value.video }
  }
  return eps.find((ep) => ep.id === activeEpisodeId.value) || eps[0]
})

function openSample(s, episodeId) {
  shotPreview.value = null
  activeSample.value = s
  const eps = s?.episodes
  activeEpisodeId.value = episodeId || eps?.[0]?.id || ''
  lockPageScroll()
}
function selectEpisode(id) {
  activeEpisodeId.value = id
}
function closeSample() {
  activeSample.value = null
  activeEpisodeId.value = ''
  restorePageScroll()
}

function openShotPreview(step) {
  if (!step?.shot) return
  activeSample.value = null
  shotPreview.value = step
  lockPageScroll()
}
function closeShotPreview() {
  shotPreview.value = null
  restorePageScroll()
}

async function headOk(url) {
  try {
    const r = await fetch(url, { method: 'HEAD' })
    if (!r.ok) return false
    // 开发态 SPA 可能对缺失静态资源回落 HTML 且仍 200
    const ct = (r.headers.get('content-type') || '').toLowerCase()
    if (ct.includes('text/html') || ct.includes('text/plain')) return false
    return true
  } catch {
    return false
  }
}

async function firstExisting(urls) {
  for (const url of urls) {
    if (await headOk(url)) return url
  }
  return ''
}

async function probeStepShots() {
  stepShots.value = await Promise.all([1, 2, 3].map((n) => firstExisting([
    `/landing/steps/step-${n}.png`,
    `/landing/steps/step-${n}.jpg`,
    `/landing/steps/step-${n}.webp`,
  ])))
}

async function probeSampleMedia() {
  await Promise.all(samples.value.map(async (s) => {
    // 已有外链成片（如首屏 OSS）不再覆盖
    if (s.video && /^https?:\/\//i.test(s.video)) {
      if (!s.poster) {
        s.poster = await firstExisting([
          `/landing/samples/sample-${s.id}.jpg`,
          `/landing/samples/sample-${s.id}.png`,
          `/landing/samples/sample-${s.id}.webp`,
        ])
      }
      return
    }
    const video = await firstExisting([
      `/landing/samples/sample-${s.id}.mp4`,
      `/landing/samples/sample-${s.id}.webm`,
    ])
    const poster = await firstExisting([
      `/landing/samples/sample-${s.id}.jpg`,
      `/landing/samples/sample-${s.id}.png`,
      `/landing/samples/sample-${s.id}.webp`,
    ])
    s.video = video
    s.poster = poster
  }))
}

/** 无截图文件时用结构化示意；有 step-N 图时自动替换 */
const MockNovel = {
  template: `
    <div class="mock mock-novel">
      <div class="mock-side"><i/><i/><i/><i/></div>
      <div class="mock-doc">
        <b></b><b class="w80"></b><b class="w60"></b><b></b><b class="w70"></b><b class="w50"></b>
      </div>
    </div>`,
}
const MockBoard = {
  template: `
    <div class="mock mock-board">
      <div class="mock-row"><em/><em/><em/></div>
      <div class="mock-tiles"><i/><i/><i/><i/></div>
    </div>`,
}
const MockFilm = {
  template: `
    <div class="mock mock-film">
      <div class="mock-film-stage"><span/></div>
      <div class="mock-film-list"><i/><i/><i/></div>
    </div>`,
}

const steps = computed(() => [
  { key: 'novel', title: t('landing.flow.s1Title'), desc: t('landing.flow.s1Desc'), mock: MockNovel, shot: stepShots.value[0] },
  { key: 'board', title: t('landing.flow.s2Title'), desc: t('landing.flow.s2Desc'), mock: MockBoard, shot: stepShots.value[1] },
  { key: 'film', title: t('landing.flow.s3Title'), desc: t('landing.flow.s3Desc'), mock: MockFilm, shot: stepShots.value[2] },
])

/** 样片墙仅三部：北凉憨世子 / 寒门枭雄 / 问鼎 */
const samples = ref([
  {
    id: '1',
    titleKey: 'i1Title',
    styleKey: 'i1Style',
    epsKey: 'epsNow',
    poster: '',
    video: SERIES_BEI_LIANG.ep1,
    episodes: [
      { id: 'ep1', n: 1, duration: '2:17', video: SERIES_BEI_LIANG.ep1 },
      { id: 'ep2', n: 2, duration: '1:14', video: SERIES_BEI_LIANG.ep2 },
      { id: 'ep3', n: 3, duration: '1:22', video: SERIES_BEI_LIANG.ep3 },
      { id: 'ep4', n: 4, duration: '0:55', video: SERIES_BEI_LIANG.ep4 },
      { id: 'ep5', n: 5, duration: '0:51', video: SERIES_BEI_LIANG.ep5 },
    ],
  },
  {
    id: '2',
    titleKey: 'i2Title',
    styleKey: 'i2Style',
    epsKey: 'epsNow3',
    poster: '',
    video: SERIES_HAN_MEN.ep1,
    episodes: [
      { id: 'ep1', n: 1, duration: '1:05', video: SERIES_HAN_MEN.ep1 },
      { id: 'ep2', n: 2, duration: '1:43', video: SERIES_HAN_MEN.ep2 },
      { id: 'ep3', n: 3, duration: '2:44', video: SERIES_HAN_MEN.ep3 },
    ],
  },
  {
    id: '3',
    titleKey: 'i3Title',
    styleKey: 'i3Style',
    epsKey: 'epsNow3',
    poster: '',
    video: SERIES_WEN_DING.ep1,
    episodes: [
      { id: 'ep1', n: 1, duration: '2:25', video: SERIES_WEN_DING.ep1 },
      { id: 'ep2', n: 2, duration: '1:24', video: SERIES_WEN_DING.ep2 },
      { id: 'ep3', n: 3, duration: '1:44', video: SERIES_WEN_DING.ep3 },
    ],
  },
])

const sampleCards = computed(() => {
  if (!mediaReady.value) return []
  return samples.value.map((s) => ({
    ...s,
    title: t(`landing.samples.items.${s.titleKey}`),
    style: t(`landing.samples.items.${s.styleKey}`),
    eps: t(`landing.samples.items.${s.epsKey}`),
  }))
})

/** 顶部手机位：持械入宋（不进样片墙） */
const heroSample = computed(() => ({
  id: 'hero',
  title: t('landing.hero.mockTitle'),
  style: t('landing.samples.items.i1Style'),
  eps: t('landing.samples.items.epsNow'),
  poster: '',
  video: SERIES_CHI_XIE.ep1,
  episodes: [
    { id: 'ep1', n: 1, duration: '2:15', video: SERIES_CHI_XIE.ep1 },
    { id: 'ep2', n: 2, duration: '1:45', video: SERIES_CHI_XIE.ep2 },
    { id: 'ep3', n: 3, duration: '1:55', video: SERIES_CHI_XIE.ep3 },
    { id: 'ep4', n: 4, duration: '1:59', video: SERIES_CHI_XIE.ep4 },
    { id: 'ep5', n: 5, duration: '1:48', video: SERIES_CHI_XIE.ep5 },
  ],
}))

const traditionalPoints = computed(() => [
  t('landing.cost.t1'),
  t('landing.cost.t2'),
  t('landing.cost.t3'),
])
const lotusPoints = computed(() => [
  t('landing.cost.l1'),
  t('landing.cost.l2'),
  t('landing.cost.l3'),
])

const plans = computed(() => [
  {
    key: 'trial',
    name: t('landing.pricing.trialName'),
    price: t('landing.pricing.trialPrice'),
    desc: t('landing.pricing.trialDesc'),
    features: [t('landing.pricing.trialF1'), t('landing.pricing.trialF2'), t('landing.pricing.trialF3')],
    cta: t('landing.pricing.trialCta'),
    to: '/login?tab=register',
    featured: false,
  },
  {
    key: 'creator',
    name: t('landing.pricing.creatorName'),
    price: t('landing.pricing.creatorPrice'),
    desc: t('landing.pricing.creatorDesc'),
    features: [t('landing.pricing.creatorF1'), t('landing.pricing.creatorF2'), t('landing.pricing.creatorF3')],
    cta: t('landing.pricing.creatorCta'),
    to: '/login?tab=register',
    featured: true,
  },
  {
    key: 'team',
    name: t('landing.pricing.teamName'),
    price: t('landing.pricing.teamPrice'),
    desc: t('landing.pricing.teamDesc'),
    features: [t('landing.pricing.teamF1'), t('landing.pricing.teamF2'), t('landing.pricing.teamF3')],
    cta: t('landing.pricing.teamCta'),
    to: '/login?tab=register',
    featured: false,
  },
])
</script>

<style scoped>
.landing {
  min-height: 100vh;
  min-height: 100dvh;
  color: var(--text-0);
  background:
    radial-gradient(ellipse 90% 55% at 12% -10%, rgba(196, 90, 72, 0.16), transparent 55%),
    radial-gradient(ellipse 70% 45% at 100% 20%, rgba(176, 138, 69, 0.12), transparent 50%),
    var(--bg-base, #f6f2e8);
  font-family: var(--font-body, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif);
}

.lp-nav {
  position: sticky;
  top: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  gap: 20px;
  height: 64px;
  padding: 0 clamp(16px, 4vw, 40px);
  background: color-mix(in srgb, var(--header-bg, #fffdf8) 88%, transparent);
  backdrop-filter: blur(16px) saturate(160%);
  border-bottom: 1px solid var(--border);
}
.lp-brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  border: 0;
  background: transparent;
  cursor: pointer;
  padding: 0;
}
.lp-brand-mark, .lp-brand-fallback {
  width: 30px; height: 30px; border-radius: 9px;
  object-fit: contain;
}
.lp-brand-fallback {
  display: grid; place-items: center;
  background: var(--accent-bg);
  color: var(--accent-text);
  font: 700 14px/1 var(--font-display);
}
.lp-brand-name {
  font: 700 16px/1 var(--font-display);
  background: var(--accent-gradient);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.lp-nav-links { display: flex; gap: 8px; margin-left: 12px; }
.lp-link {
  border: 0; background: transparent; cursor: pointer;
  padding: 8px 10px; color: var(--text-2); font: 600 13px/1 var(--font-body);
}
.lp-link:hover { color: var(--text-0); }
.lp-nav-actions { margin-left: auto; display: flex; align-items: center; gap: 8px; }

.lp-hero {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(280px, 0.95fr);
  gap: clamp(28px, 5vw, 64px);
  align-items: center;
  min-height: calc(100vh - 64px);
  min-height: calc(100dvh - 64px);
  padding: clamp(32px, 6vh, 72px) clamp(16px, 4vw, 40px) clamp(48px, 8vh, 96px);
  max-width: 1180px;
  margin: 0 auto;
}
.lp-brand-hero {
  margin: 0 0 14px;
  font: 700 clamp(28px, 4.5vw, 44px)/1.05 var(--font-display);
  letter-spacing: -0.03em;
  background: var(--accent-gradient);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.lp-headline {
  margin: 0;
  font: 650 clamp(22px, 3.2vw, 34px)/1.35 var(--font-display);
  color: var(--text-0);
  letter-spacing: -0.02em;
  max-width: 16em;
}
.lp-support {
  margin: 16px 0 0;
  max-width: 32em;
  font: 400 15px/1.7 var(--font-body);
  color: var(--text-2);
}
.lp-hero-cta { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 28px; }
.lp-cta-main { min-height: 44px; padding: 0 22px; font-size: 14px; }
.lp-cta-secondary { min-height: 44px; }

.lp-hero-stage {
  position: relative;
  display: grid;
  place-items: center;
  min-height: 420px;
}
.hero-glow {
  position: absolute;
  inset: 18% 12%;
  background: radial-gradient(circle, rgba(196, 90, 72, 0.22), transparent 68%);
  filter: blur(8px);
  z-index: 0;
}
.phone-frame {
  position: relative;
  z-index: 1;
  width: min(280px, 72vw);
  aspect-ratio: 9 / 17;
  padding: 12px;
  border: 0;
  border-radius: 28px;
  background: linear-gradient(160deg, #2a2420, #14110f);
  box-shadow: 0 24px 60px rgba(40, 28, 20, 0.28);
  animation: phone-rise 0.9s var(--ease-out, ease) both;
  cursor: pointer;
  text-align: left;
}
@keyframes phone-rise {
  from { opacity: 0; transform: translateY(18px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.lp-hero-copy {
  animation: copy-fade 0.7s var(--ease-out, ease) both;
}
@keyframes copy-fade {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
.sample-card:nth-child(1) { animation: card-in 0.5s 0.05s both; }
.sample-card:nth-child(2) { animation: card-in 0.5s 0.12s both; }
.sample-card:nth-child(3) { animation: card-in 0.5s 0.18s both; }
.sample-card:nth-child(4) { animation: card-in 0.5s 0.24s both; }
.sample-card:nth-child(5) { animation: card-in 0.5s 0.30s both; }
.sample-card:nth-child(6) { animation: card-in 0.5s 0.36s both; }
@keyframes card-in {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}
.phone-notch {
  position: absolute; top: 18px; left: 50%; transform: translateX(-50%);
  width: 36%; height: 10px; border-radius: 999px; background: #0b0908; z-index: 2;
}
.phone-screen {
  position: relative;
  height: 100%;
  border-radius: 20px;
  overflow: hidden;
  background: #120e0c;
  display: flex; flex-direction: column; justify-content: flex-end;
  padding: 20px 16px 24px;
  color: #f7efe4;
}
.phone-video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  background: #120e0c;
}
.phone-chip {
  position: absolute; top: 28px; left: 24px; z-index: 2;
  font-size: 10px; letter-spacing: 0.08em; opacity: 0.85;
  text-shadow: 0 1px 4px rgba(0,0,0,0.55);
}
.phone-scene {
  position: relative; z-index: 2;
  background: linear-gradient(180deg, transparent, rgba(12, 8, 6, 0.72));
  margin: 0 -16px -24px;
  padding: 36px 16px 24px;
}
.phone-title { font: 700 18px/1.3 var(--font-display); }
.phone-sub { margin-top: 6px; font-size: 12px; opacity: 0.8; }

.lp-section {
  max-width: 1100px;
  margin: 0 auto;
  padding: clamp(56px, 9vh, 96px) clamp(16px, 4vw, 40px);
  scroll-margin-top: 72px;
}
.lp-section-muted {
  background: color-mix(in srgb, var(--surface-muted, #ede6d6) 55%, transparent);
  max-width: none;
  padding-left: max(16px, calc((100% - 1100px) / 2 + 16px));
  padding-right: max(16px, calc((100% - 1100px) / 2 + 16px));
}
.lp-section-head { max-width: 640px; margin-bottom: 36px; }
.lp-section-head h2 {
  margin: 0;
  font: 700 clamp(24px, 3vw, 32px)/1.2 var(--font-display);
  letter-spacing: -0.02em;
}
.lp-section-head p {
  margin: 10px 0 0;
  color: var(--text-2);
  font-size: 14px;
  line-height: 1.7;
}

.flow-grid {
  list-style: none; margin: 0; padding: 0;
  display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px;
}
.flow-card { display: grid; gap: 14px; }
.flow-shot {
  display: block;
  width: 100%;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 14px;
  overflow: hidden;
  background: var(--surface-raised, #fffdf8);
  box-shadow: var(--shadow-xs, 0 1px 2px rgba(0,0,0,0.04));
  color: inherit;
  text-align: left;
}
.flow-shot.is-zoomable {
  cursor: zoom-in;
  transition: transform 0.2s var(--ease-out, ease), box-shadow 0.2s var(--ease-out, ease);
}
.flow-shot.is-zoomable:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 28px rgba(40, 28, 20, 0.1);
}
.shot-body {
  position: relative;
  min-height: 168px;
  padding: 0;
}
.shot-body:has(.mock) { padding: 14px; }
.shot-chrome {
  display: flex; gap: 5px; padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--surface-muted) 70%, transparent);
}
.shot-chrome span {
  width: 8px; height: 8px; border-radius: 50%;
  background: color-mix(in srgb, var(--text-3) 45%, transparent);
}
.shot-img {
  display: block;
  width: 100%;
  height: 100%;
  min-height: 168px;
  max-height: 220px;
  object-fit: cover;
  object-position: top center;
}
.shot-zoom {
  position: absolute;
  right: 10px;
  bottom: 10px;
  width: 32px;
  height: 32px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  color: #fff;
  background: rgba(18, 12, 10, 0.45);
  backdrop-filter: blur(4px);
  opacity: 0.85;
}
.flow-shot.is-zoomable:hover .shot-zoom { opacity: 1; }

.shot-overlay {
  position: fixed; inset: 0; z-index: 85;
  background: rgba(12, 8, 6, 0.78);
  backdrop-filter: blur(8px);
  display: grid; place-items: center;
  padding: 16px;
}
.shot-lightbox {
  width: min(1100px, 100%);
  max-height: min(92vh, 900px);
  border-radius: 18px;
  overflow: hidden;
  background: #16110e;
  border: 1px solid rgba(255, 236, 214, 0.12);
  box-shadow: 0 28px 80px rgba(0, 0, 0, 0.45);
  color: #f6eee4;
  display: flex;
  flex-direction: column;
}
.shot-lightbox-head {
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: 12px; padding: 14px 16px;
}
.shot-lightbox-head strong {
  display: block;
  font: 700 16px/1.25 var(--font-display);
}
.shot-lightbox-head span {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  color: rgba(246, 238, 228, 0.62);
  line-height: 1.5;
}
.shot-lightbox-body {
  padding: 0 16px 16px;
  overflow: auto;
  min-height: 0;
}
.shot-lightbox-body img {
  display: block;
  width: 100%;
  height: auto;
  max-height: min(78vh, 780px);
  object-fit: contain;
  border-radius: 12px;
  background: #0b0908;
}
.flow-meta { padding: 0 2px; }
.flow-index {
  display: inline-block;
  font: 700 12px/1 var(--font-body);
  letter-spacing: 0.08em;
  color: var(--accent-text);
  margin-bottom: 8px;
}
.flow-meta h3 {
  margin: 0;
  font: 700 17px/1.3 var(--font-display);
}
.flow-meta p {
  margin: 8px 0 0;
  color: var(--text-2);
  font-size: 13px;
  line-height: 1.65;
}

.mock { height: 140px; }
.mock-novel { display: grid; grid-template-columns: 52px 1fr; gap: 10px; height: 100%; }
.mock-side { display: grid; gap: 8px; }
.mock-side i, .mock-doc b, .mock-row em, .mock-tiles i, .mock-film-list i {
  display: block; border-radius: 6px;
  background: color-mix(in srgb, var(--text-3) 18%, transparent);
}
.mock-side i { height: 22px; }
.mock-doc { display: grid; align-content: start; gap: 8px; padding-top: 4px; }
.mock-doc b { height: 8px; width: 100%; }
.mock-doc .w80 { width: 80%; } .mock-doc .w70 { width: 70%; }
.mock-doc .w60 { width: 60%; } .mock-doc .w50 { width: 50%; }
.mock-board { display: grid; gap: 12px; height: 100%; }
.mock-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.mock-row em { height: 18px; }
.mock-tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; flex: 1; }
.mock-tiles i { height: 72px; }
.mock-film { display: grid; grid-template-columns: 1.4fr 0.8fr; gap: 10px; height: 100%; }
.mock-film-stage {
  border-radius: 10px;
  background: linear-gradient(145deg, #8b5a45, #2a1a14);
  display: grid; place-items: center;
}
.mock-film-stage span {
  width: 28px; height: 28px; border-radius: 50%;
  background: rgba(255,255,255,0.22);
}
.mock-film-list { display: grid; gap: 8px; align-content: start; }
.mock-film-list i { height: 28px; }

.sample-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  max-width: 1100px;
  margin: 0 auto;
}
.sample-card {
  border: 1px solid var(--border);
  border-radius: 14px;
  overflow: hidden;
  background: var(--surface-raised, #fffdf8);
  text-align: left;
  cursor: pointer;
  padding: 0;
  color: inherit;
  transition: transform 0.2s var(--ease-out), box-shadow 0.2s var(--ease-out);
}
.sample-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 10px 28px rgba(40, 28, 20, 0.1);
}
.sample-poster {
  position: relative;
  aspect-ratio: 9 / 14;
  background:
    linear-gradient(180deg, transparent 45%, rgba(20,14,10,0.75)),
    linear-gradient(145deg, #8a5643, #2a1b15 70%);
  background-size: cover;
  background-position: center;
}
.sample-play {
  position: absolute; inset: 0;
  display: grid; place-items: center;
  color: #fff;
}
.sample-play svg {
  width: 44px; height: 44px; padding: 12px;
  border-radius: 50%;
  background: rgba(0,0,0,0.35);
  backdrop-filter: blur(4px);
}
.sample-eps {
  position: absolute; left: 10px; bottom: 10px;
  font-size: 11px; color: #f6eee4;
  padding: 3px 8px; border-radius: 999px;
  background: rgba(0,0,0,0.35);
}
.sample-info { padding: 12px 12px 14px; display: grid; gap: 4px; }
.sample-info strong { font-size: 14px; }
.sample-info span { font-size: 12px; color: var(--text-3); }

.cost-compare {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.cost-col {
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 22px 20px;
  background: var(--surface-raised, #fffdf8);
}
.cost-col.is-new {
  border-color: color-mix(in srgb, var(--accent) 35%, var(--border));
  background: color-mix(in srgb, var(--accent-bg) 55%, var(--surface-raised, #fffdf8));
}
.cost-col h3 { margin: 0; font: 700 15px/1.3 var(--font-body); color: var(--text-2); }
.cost-num {
  margin: 14px 0 4px;
  font: 700 clamp(26px, 3vw, 34px)/1.1 var(--font-display);
  letter-spacing: -0.02em;
}
.cost-time { margin: 0; color: var(--text-2); font-size: 14px; }
.cost-col ul { margin: 16px 0 0; padding-left: 18px; color: var(--text-2); font-size: 13px; line-height: 1.7; }
.cost-note { margin: 14px 0 0; font-size: 12px; color: var(--text-3); line-height: 1.6; }

.price-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  max-width: 1100px;
  margin: 0 auto;
}
.price-card {
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 22px 20px;
  background: var(--surface-raised, #fffdf8);
  display: grid;
  gap: 10px;
  align-content: start;
}
.price-card.featured {
  border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
  box-shadow: 0 12px 32px rgba(163, 59, 43, 0.12);
  transform: translateY(-4px);
}
.price-card h3 { margin: 0; font: 700 16px/1.2 var(--font-display); }
.price-amount { margin: 0; font: 700 28px/1.1 var(--font-display); letter-spacing: -0.02em; }
.price-desc { margin: 0; color: var(--text-2); font-size: 13px; line-height: 1.6; }
.price-card ul { margin: 4px 0 8px; padding-left: 18px; color: var(--text-2); font-size: 13px; line-height: 1.7; }
.price-card .btn { justify-content: center; margin-top: 6px; }

.lp-final {
  text-align: center;
  padding: clamp(64px, 10vh, 110px) 20px;
  max-width: 720px;
  margin: 0 auto;
}
.lp-final h2 {
  margin: 0;
  font: 700 clamp(24px, 3vw, 34px)/1.25 var(--font-display);
}
.lp-final p { margin: 12px 0 24px; color: var(--text-2); line-height: 1.7; }

.lp-footer {
  display: flex; flex-wrap: wrap; justify-content: center; gap: 12px 18px;
  padding: 20px 16px max(20px, env(safe-area-inset-bottom));
  border-top: 1px solid var(--border);
  font-size: 12px; color: var(--text-3);
}
.lp-footer a { color: var(--text-3); text-decoration: none; }
.lp-footer a:hover { color: var(--text-1); }

.sample-overlay {
  position: fixed; inset: 0; z-index: 80;
  background: rgba(12, 8, 6, 0.72);
  backdrop-filter: blur(8px);
  display: grid; place-items: center;
  padding: 16px;
}
.sample-dialog {
  width: min(860px, 100%);
  max-height: min(92vh, 900px);
  border-radius: 20px;
  overflow: hidden;
  background:
    linear-gradient(180deg, #2a211c 0%, #181210 100%);
  border: 1px solid rgba(255, 236, 214, 0.12);
  box-shadow: 0 28px 80px rgba(0, 0, 0, 0.45);
  color: #f6eee4;
  display: flex;
  flex-direction: column;
}
.sample-dialog-head {
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: 12px; padding: 16px 18px 12px;
}
.sample-dialog-meta strong {
  display: block;
  font: 700 18px/1.25 var(--font-display);
  letter-spacing: -0.02em;
}
.sample-dialog-meta span {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  color: rgba(246, 238, 228, 0.62);
}
.sample-close {
  width: 36px; height: 36px;
  border: 0; border-radius: 999px;
  background: rgba(255,255,255,0.08);
  color: #f6eee4;
  font-size: 22px; line-height: 1;
  cursor: pointer;
  flex-shrink: 0;
}
.sample-close:hover { background: rgba(255,255,255,0.14); }
.sample-dialog-body {
  display: grid;
  grid-template-columns: minmax(0, 0.95fr) minmax(220px, 0.85fr);
  gap: 16px;
  padding: 0 18px 18px;
  min-height: 0;
  overflow: auto;
}
.sample-player {
  background: #0b0908;
  border-radius: 14px;
  overflow: hidden;
  aspect-ratio: 9 / 16;
  max-height: min(72vh, 680px);
  display: grid; place-items: center;
}
.sample-player video {
  width: 100%; height: 100%;
  object-fit: contain;
  background: #000;
}
.sample-eps-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
}
.sample-eps-head {
  display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
}
.sample-eps-label {
  font: 700 13px/1.2 var(--font-body);
  letter-spacing: 0.04em;
  color: rgba(246, 238, 228, 0.92);
}
.sample-eps-count {
  font-size: 12px;
  color: rgba(246, 238, 228, 0.5);
}
.sample-eps-list {
  display: grid;
  gap: 8px;
  overflow: auto;
  padding-right: 2px;
}
.sample-ep-chip {
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-rows: auto auto;
  column-gap: 10px;
  row-gap: 2px;
  align-items: center;
  width: 100%;
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid rgba(255, 236, 214, 0.1);
  background: rgba(255, 255, 255, 0.04);
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 0.18s ease, border-color 0.18s ease, transform 0.18s ease;
}
.sample-ep-chip:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 236, 214, 0.18);
}
.sample-ep-chip.on {
  background: linear-gradient(135deg, rgba(196, 90, 72, 0.28), rgba(176, 138, 69, 0.16));
  border-color: rgba(196, 90, 72, 0.55);
  box-shadow: inset 0 0 0 1px rgba(196, 90, 72, 0.2);
}
.ep-num {
  font: 700 14px/1.2 var(--font-display);
  grid-column: 1;
}
.ep-dur {
  grid-column: 2;
  grid-row: 1 / span 2;
  font: 600 12px/1 var(--font-body);
  color: rgba(246, 238, 228, 0.55);
  padding: 6px 8px;
  border-radius: 999px;
  background: rgba(0,0,0,0.25);
}
.sample-ep-chip.on .ep-dur {
  color: #f7efe4;
  background: rgba(196, 90, 72, 0.35);
}
.ep-now {
  grid-column: 1;
  font-size: 11px;
  color: #e8a090;
  letter-spacing: 0.04em;
}
.sample-fallback {
  text-align: center; color: #f3ebe1; padding: 24px;
  display: grid; gap: 14px; justify-items: center;
}
.sample-fallback p { margin: 0; opacity: 0.85; font-size: 14px; }

@media (max-width: 960px) {
  .lp-hero { grid-template-columns: 1fr; min-height: auto; }
  .lp-hero-stage { min-height: 300px; }
  .phone-frame { width: min(220px, 58vw); }
  .flow-grid, .price-grid { grid-template-columns: 1fr; }
  .sample-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .price-card.featured { transform: none; }
  .sample-dialog-body { grid-template-columns: 1fr; }
  .sample-player {
    max-height: min(52vh, 520px);
    width: min(320px, 100%);
    margin: 0 auto;
  }
}
@media (max-width: 720px) {
  .lp-nav-links { display: none; }
  .cost-compare { grid-template-columns: 1fr; }
  .sample-grid { grid-template-columns: 1fr 1fr; gap: 10px; }
  .sample-eps-list {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
