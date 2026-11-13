/**
 * SaaS 全局路由守卫：
 * - 公开：/、/login
 * - 其余需登录；未登录跳 /login?redirect=
 * - 独立版直接放行（桌面端无多用户）
 */
const PUBLIC_PATHS = new Set(['/', '/login'])

function isPublicPath(path: string) {
  return PUBLIC_PATHS.has(path)
}

export default defineNuxtRouteMiddleware(async (to) => {
  const auth = useAuth()
  await auth.ensureReady()

  // 独立版：落地页无意义，首页进工作台；无多用户，禁止管理后台
  if (!auth.isSaas.value) {
    if (to.path === '/') return navigateTo('/app')
    if (to.path === '/admin' || to.path.startsWith('/admin/')) return navigateTo('/app')
    return
  }

  const isLogin = to.path === '/login'
  if (isLogin) {
    if (auth.isLoggedIn.value) {
      const redirect = typeof to.query.redirect === 'string' ? to.query.redirect : '/app'
      return navigateTo(redirect || '/app')
    }
    return
  }

  if (isPublicPath(to.path)) return

  if (!auth.isLoggedIn.value) {
    return navigateTo({
      path: '/login',
      query: { redirect: to.fullPath },
    })
  }

  if ((to.path === '/admin' || to.path.startsWith('/admin/')) && auth.user.value?.role !== 'admin') {
    return navigateTo('/app')
  }
})
