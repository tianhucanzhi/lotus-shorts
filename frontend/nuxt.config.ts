import { fileURLToPath } from 'node:url'

export default defineNuxtConfig({
  srcDir: 'app/',
  ssr: false,
  devtools: { enabled: false },
  experimental: {
    appManifest: false,
  },
  hooks: {
    // 动态路由页面统一放在 app/views/ 手动注册，避免文件路径中出现 [id] 方括号
    // （方括号路径在 git/shell 中需转义，且部分部署环境不兼容）。URL 保持不变。
    'pages:extend'(pages) {
      pages.push(
        {
          name: 'drama-detail',
          path: '/drama/:id',
          file: fileURLToPath(new URL('./app/views/drama/detail.vue', import.meta.url)),
        },
        {
          name: 'drama-episode',
          path: '/drama/:id/episode/:episodeNumber',
          file: fileURLToPath(new URL('./app/views/drama/episode.vue', import.meta.url)),
        },
      )
    },
  },
  app: {
    head: {
      htmlAttrs: { lang: 'zh-CN' },
      title: '莲花短剧 - 传一本小说，几小时出一部 60 集竖屏短剧',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'description', content: '莲花短剧：上传小说，自动改剧本、拆分镜、生图生视频并拼接成片。相对真人短剧 5–10 万/3 周，这里约数千元、数小时起即可出 60 集竖屏短剧。' },
        { name: 'keywords', content: '莲花短剧,Lotus Shorts,AI短剧,AI漫剧,短剧制作,剧本改写,分镜,文生视频,真人古装,竖屏短剧' },
        { name: 'author', content: '楼图（上海）信息科技有限公司' },
        { name: 'application-name', content: '莲花短剧' },
        { name: 'robots', content: 'index, follow, max-image-preview:large' },
        { name: 'theme-color', content: '#1a1a1a' },
        { property: 'og:type', content: 'website' },
        { property: 'og:site_name', content: '莲花短剧' },
        { property: 'og:locale', content: 'zh_CN' },
        { property: 'og:url', content: 'https://shorts.yunfm.cn/' },
        { property: 'og:title', content: '莲花短剧 - 传一本小说，几小时出一部 60 集竖屏短剧' },
        { property: 'og:description', content: '上传小说，自动改剧本、拆分镜、生图生视频并拼接成片。约数千元、数小时起出 60 集竖屏短剧。' },
        // 微信/社交卡片必需：绝对地址封面图；无 og:image 时微信常只显示纯链接
        { property: 'og:image', content: 'https://shorts.yunfm.cn/og-cover.jpg?v=20261110' },
        { property: 'og:image:url', content: 'https://shorts.yunfm.cn/og-cover.jpg?v=20261110' },
        { property: 'og:image:secure_url', content: 'https://shorts.yunfm.cn/og-cover.jpg?v=20261110' },
        { property: 'og:image:type', content: 'image/jpeg' },
        { property: 'og:image:width', content: '1200' },
        { property: 'og:image:height', content: '630' },
        { property: 'og:image:alt', content: '莲花短剧' },
        { name: 'twitter:card', content: 'summary_large_image' },
        { name: 'twitter:title', content: '莲花短剧 - 传一本小说，几小时出一部 60 集竖屏短剧' },
        { name: 'twitter:description', content: '上传小说，自动改剧本、拆分镜、生图生视频并拼接成片。约数千元、数小时起出 60 集竖屏短剧。' },
        { name: 'twitter:image', content: 'https://shorts.yunfm.cn/og-cover.jpg?v=20261110' },
      ],
      link: [
        { rel: 'canonical', href: 'https://shorts.yunfm.cn/' },
        // v 参数用于 favicon 缓存穿透（浏览器对 favicon 缓存独立于 HTTP 缓存，换图必须 bump）
        { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon.png?v=20261031c' },
        { rel: 'shortcut icon', type: 'image/png', href: '/favicon.png?v=20261031c' },
        { rel: 'apple-touch-icon', href: '/favicon.png?v=20261031c' },
      ],
      script: [
        {
          type: 'application/ld+json',
          innerHTML: JSON.stringify({
            '@context': 'https://schema.org',
            '@graph': [
              {
                '@type': 'WebSite',
                name: '莲花短剧',
                alternateName: 'Lotus Shorts',
                url: 'https://shorts.yunfm.cn/',
                inLanguage: ['zh-CN', 'en', 'ja', 'ko'],
                description: 'AI 短剧与漫剧一站式制作：剧本、分镜、生图、生视频到成片导出。',
              },
              {
                '@type': 'SoftwareApplication',
                name: '莲花短剧',
                alternateName: 'Lotus Shorts',
                applicationCategory: 'MultimediaApplication',
                operatingSystem: 'Web',
                url: 'https://shorts.yunfm.cn/',
                description: '从小说或大纲到成片：剧本改写、角色场景道具提取、分镜拆解、文生图、文生视频与拼接导出。',
                inLanguage: ['zh-CN', 'en', 'ja', 'ko'],
                publisher: {
                  '@type': 'Organization',
                  name: '楼图（上海）信息科技有限公司',
                  url: 'https://shorts.yunfm.cn/',
                },
              },
            ],
          }),
        },
      ],
    },
  },
  vite: {
    server: {
      proxy: {
        '/api': { target: 'http://localhost:5679', changeOrigin: true },
        '/static': { target: 'http://localhost:5679', changeOrigin: true },
      },
    },
  },
  compatibilityDate: '2025-05-15',
})
