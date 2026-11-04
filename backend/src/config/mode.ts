/**
 * 运行模式：standalone（独立版，默认）/ saas（多用户登录 + 数据隔离）
 * 由环境变量 APP_MODE 控制，大小写不敏感。
 */
export type AppMode = 'standalone' | 'saas'

function normalizeMode(raw?: string | null): AppMode {
  const v = String(raw || 'standalone').trim().toLowerCase()
  return v === 'saas' ? 'saas' : 'standalone'
}

export const APP_MODE: AppMode = normalizeMode(process.env.APP_MODE)

export function isSaas(): boolean {
  return APP_MODE === 'saas'
}

export function isStandalone(): boolean {
  return APP_MODE === 'standalone'
}

/** JWT 签名密钥；SaaS 模式强烈建议通过 JWT_SECRET 显式配置 */
export function jwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim()
  if (secret) return secret
  if (isSaas()) {
    console.warn('[auth] JWT_SECRET 未设置，使用开发默认密钥（生产务必配置）')
  }
  return 'lotus-shorts-dev-secret-change-me'
}

/** JWT 有效期（秒），默认 7 天 */
export function jwtExpiresIn(): number {
  const n = Number(process.env.JWT_EXPIRES_IN || 60 * 60 * 24 * 7)
  return Number.isFinite(n) && n > 60 ? n : 60 * 60 * 24 * 7
}

/** 是否开放注册（仅 SaaS）；默认 true，可用 SAAS_ALLOW_REGISTER=false 关闭 */
export function allowRegister(): boolean {
  if (!isSaas()) return false
  const v = String(process.env.SAAS_ALLOW_REGISTER ?? 'true').trim().toLowerCase()
  return v !== 'false' && v !== '0' && v !== 'no'
}
