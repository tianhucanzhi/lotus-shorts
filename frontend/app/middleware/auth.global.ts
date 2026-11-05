/**
 * SaaS 全局路由守卫：未登录跳转 /login；独立版直接放行。
 */
export default defineNuxtRouteMiddleware(async (to) => {
  const auth = useAuth()
  await auth.ensureReady()

  if (!auth.isSaas.value) return

  const isLogin = to.path === '/login'
  if (isLogin) {
    if (auth.isLoggedIn.value) {
      const redirect = typeof to.query.redirect === 'string' ? to.query.redirect : '/'
      return navigateTo(redirect || '/')
    }
    return
  }

  if (!auth.isLoggedIn.value) {
    return navigateTo({
      path: '/login',
      query: { redirect: to.fullPath },
    })
  }

  if ((to.path === '/admin' || to.path.startsWith('/admin/')) && auth.user.value?.role !== 'admin') {
    return navigateTo('/')
  }
})
