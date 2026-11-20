/**
 * 全局路由守卫：
 * - 公开：/、/login、/admin/login
 * - /admin/**（除 login）：任意 mode 下均需管理员登录
 * - SaaS：其余需登录；独立版主站无需登录
 */
const PUBLIC_PATHS = new Set(['/', '/login', '/admin/login'])

function isPublicPath(path: string) {
  return PUBLIC_PATHS.has(path)
}

function isAdminPath(path: string) {
  return path === '/admin' || path.startsWith('/admin/')
}

export default defineNuxtRouteMiddleware(async (to) => {
  const auth = useAuth()
  await auth.ensureReady()

  const isAdminLogin = to.path === '/admin/login'
  const onAdmin = isAdminPath(to.path)

  // 管理后台：独立登录页；其余必须管理员
  if (onAdmin) {
    if (isAdminLogin) {
      if (auth.isLoggedIn.value && auth.user.value?.role === 'admin') {
        return navigateTo('/admin')
      }
      return
    }
    if (!auth.isLoggedIn.value || auth.user.value?.role !== 'admin') {
      return navigateTo({
        path: '/admin/login',
        query: { redirect: to.fullPath },
      })
    }
    return
  }

  // 独立版：落地页无意义，首页进工作台；主站无多用户
  if (!auth.isSaas.value) {
    if (to.path === '/') return navigateTo('/app')
    if (to.path === '/login') return navigateTo('/app')
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
})
