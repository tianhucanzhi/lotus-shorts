/**
 * SaaS / 独立版认证状态
 * - standalone：无登录，永远放行
 * - saas：JWT 存在 localStorage，请求头带 Bearer
 */
export type AuthUser = {
  id: number
  username: string
  email?: string | null
  display_name?: string | null
  role?: string
  status?: string
}

export type AuthModeInfo = {
  mode: 'standalone' | 'saas'
  saas: boolean
  allow_register: boolean
}

const TOKEN_KEY = 'lotus:auth_token'
const USER_KEY = 'lotus:auth_user'

function readStoredToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY) } catch { return null }
}

function readStoredUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY)
    return raw ? JSON.parse(raw) as AuthUser : null
  } catch { return null }
}

export function getAuthToken(): string | null {
  return readStoredToken()
}

export function clearAuthStorage() {
  try {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
  } catch { /* ignore */ }
}

export function useAuth() {
  const mode = useState<'standalone' | 'saas'>('auth.mode', () => 'standalone')
  const allowRegister = useState('auth.allowRegister', () => false)
  const token = useState<string | null>('auth.token', () => null)
  const user = useState<AuthUser | null>('auth.user', () => null)
  const ready = useState('auth.ready', () => false)
  const bootstrapping = useState('auth.bootstrapping', () => false)

  const isSaas = computed(() => mode.value === 'saas')
  const isLoggedIn = computed(() => !!token.value && !!user.value)

  function persistSession(nextToken: string, nextUser: AuthUser) {
    token.value = nextToken
    user.value = nextUser
    try {
      localStorage.setItem(TOKEN_KEY, nextToken)
      localStorage.setItem(USER_KEY, JSON.stringify(nextUser))
    } catch { /* ignore */ }
  }

  function logout() {
    token.value = null
    user.value = null
    clearAuthStorage()
  }

  async function ensureReady() {
    if (ready.value) return
    if (bootstrapping.value) {
      // 等待已有引导完成
      while (bootstrapping.value) await new Promise(r => setTimeout(r, 30))
      return
    }
    bootstrapping.value = true
    try {
      // 先恢复本地会话，减少闪烁
      if (!token.value) token.value = readStoredToken()
      if (!user.value) user.value = readStoredUser()

      const info = await $fetch<any>('/api/v1/auth/mode').then(r => r?.data ?? r) as AuthModeInfo
      mode.value = info.saas ? 'saas' : 'standalone'
      allowRegister.value = !!info.allow_register

      if (mode.value === 'saas' && token.value) {
        try {
          const me = await $fetch<any>('/api/v1/auth/me', {
            headers: { Authorization: `Bearer ${token.value}` },
          }).then(r => r?.data ?? r)
          if (me?.user) {
            user.value = me.user
            try { localStorage.setItem(USER_KEY, JSON.stringify(me.user)) } catch { /* ignore */ }
          } else {
            logout()
          }
        } catch {
          logout()
        }
      } else if (mode.value === 'standalone') {
        logout()
      }
    } catch {
      // mode 接口失败时保持 standalone，避免误拦独立版
      mode.value = 'standalone'
    } finally {
      ready.value = true
      bootstrapping.value = false
    }
  }

  async function login(username: string, password: string) {
    const data = await $fetch<any>('/api/v1/auth/login', {
      method: 'POST',
      body: { username, password },
    }).then(r => r?.data ?? r)
    if (!data?.token || !data?.user) throw new Error('登录响应异常')
    persistSession(data.token, {
      id: data.user.id,
      username: data.user.username,
      email: data.user.email,
      display_name: data.user.display_name ?? data.user.displayName,
      role: data.user.role,
      status: data.user.status,
    })
    mode.value = 'saas'
    return data.user as AuthUser
  }

  async function register(payload: { username: string; password: string; display_name?: string; email?: string }) {
    const data = await $fetch<any>('/api/v1/auth/register', {
      method: 'POST',
      body: payload,
    }).then(r => r?.data ?? r)
    if (!data?.token || !data?.user) throw new Error('注册响应异常')
    persistSession(data.token, {
      id: data.user.id,
      username: data.user.username,
      email: data.user.email,
      display_name: data.user.display_name ?? data.user.displayName,
      role: data.user.role,
      status: data.user.status,
    })
    mode.value = 'saas'
    return data.user as AuthUser
  }

  return {
    mode,
    allowRegister,
    token,
    user,
    ready,
    isSaas,
    isLoggedIn,
    ensureReady,
    login,
    register,
    logout,
    persistSession,
  }
}
