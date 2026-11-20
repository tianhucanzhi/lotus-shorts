/** 管理后台菜单权限（仅 role=admin 有意义；超级账号 username=admin 拥有全部） */

export const SUPER_ADMIN_USERNAME = 'admin'

export const ADMIN_MENU_KEYS = [
  'overview',
  'users',
  'projects',
  'tasks',
  'styles',
  'aiConfigs',
  'system',
] as const

export type AdminMenuKey = (typeof ADMIN_MENU_KEYS)[number]

const MENU_SET = new Set<string>(ADMIN_MENU_KEYS)

export function isSuperAdminUsername(username: string | null | undefined): boolean {
  return String(username || '').trim() === SUPER_ADMIN_USERNAME
}

export function parseAdminMenus(raw: string | null | undefined): AdminMenuKey[] | null {
  if (raw == null || raw === '') return null
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    const out = parsed
      .map(v => String(v || '').trim())
      .filter((v): v is AdminMenuKey => MENU_SET.has(v))
    return [...new Set(out)]
  } catch {
    return null
  }
}

export function serializeAdminMenus(menus: string[] | null | undefined): string | null {
  if (menus == null) return null
  const out = menus
    .map(v => String(v || '').trim())
    .filter((v): v is AdminMenuKey => MENU_SET.has(v))
  return JSON.stringify([...new Set(out)])
}

/** 解析后实际可用菜单：超管 / 未配置 → 全部；否则按列表 */
export function resolveAdminMenus(input: {
  username: string
  role: string
  adminMenusRaw?: string | null
}): AdminMenuKey[] {
  if (input.role !== 'admin') return []
  if (isSuperAdminUsername(input.username)) return [...ADMIN_MENU_KEYS]
  const parsed = parseAdminMenus(input.adminMenusRaw)
  if (parsed == null) return [...ADMIN_MENU_KEYS]
  return parsed
}

export function hasAdminMenu(
  input: { username: string; role: string; adminMenusRaw?: string | null },
  menu: AdminMenuKey,
): boolean {
  return resolveAdminMenus(input).includes(menu)
}

/** 路径 → 菜单 key；登录页等返回 null 表示不校验菜单 */
export function menuKeyForAdminPath(path: string): AdminMenuKey | null {
  const p = path.replace(/^\/api\/v1\/admin/, '') || '/'
  if (p === '/' || p === '/overview' || p.startsWith('/overview/')) return 'overview'
  if (p.startsWith('/menu-keys')) return 'users'
  if (p.startsWith('/users')) return 'users'
  if (p.startsWith('/dramas')) return 'projects'
  if (p.startsWith('/tasks')) return 'tasks'
  if (p.startsWith('/styles')) return 'styles'
  if (p.startsWith('/ai-configs')) return 'aiConfigs'
  if (p.startsWith('/system')) return 'system'
  return 'overview'
}
