/**
 * 统一错误提示入口 — 把裸技术错误（Failed to fetch / API error 500: {...} /
 * 上游错误码 / ffmpeg 输出 / SDK 英文原文）映射为用户可读的友好文案。
 *
 * - mapError(err, { fallback? }): 返回友好文案（内联展示复用同一函数）
 * - toastError(err, { fallback?, duration? }): toast / 弹框
 * - 余额不足、请求过频：弹友好说明框（可去充值）
 * - 后端返回的短中文友好 message（如「镜头不存在」）原样透传
 * - 原始错误不展示，排障走 DevTools（useApi 已 console.error）
 */
import { toast } from 'vue-sonner'
import { i18n } from '~/composables/i18n'
import { showErrorNotice } from '~/composables/useErrorNotice'

const t = (key: string, params?: Record<string, unknown>) => i18n.global.t(key, params)

/** 内容审核特征（从 episode.vue 的 videoModerationHint 上移，全站复用） */
export const MODERATION_RE = /sensitive|moderation|真人|人脸|real[\s_-]?person|审核|内容.*(违规|不合规|未通过)|content[\s_-]?policy|risk[\s_-]?control|violation|blocked/i

const NETWORK_RE = /failed to fetch|network ?error|load failed|network request failed|fetch failed/i
const NONJSON_RE = /unexpected token|not valid json|failed to parse/i
const SERVER5XX_RE = /(^|\D)5\d{2}(\D|$)|internal server error|服务器内部错误/i
const AUTH_RE = /(^|\D)40[13](\D|$)|unauthorized|forbidden|invalid[\s_-]?api[\s_-]?key|authentication|鉴权/i
/** 余额/额度不足（含 Real-API 402 Insufficient balance） */
const BALANCE_RE = /insufficient\s*balance|payment\s*required|(^|\D)402(\D|$)|余额不足|额度不足|账户.*欠费|balance.*(low|negative|insufficient)|required\s*\$/i
const RATELIMIT_RE = /(^|\D)429(\D|$)|rate[\s_-]?limit|too many requests|请求过于频繁|限流/i
const TIMEOUT_RE = /timeout|timed out|polling exceeded|超时/i
/** 技术特征：出现即判定不可直接透传给用户 */
const TECHY_RE = /[{}\[\]<>]|https?:\/\/|\b(error|errno|exception|code|stack|undefined|null)\b|[a-z]+_[a-z]+/i
const CJK_RE = /[一-鿿]/

function messageOf(err: unknown): string {
  if (err == null) return ''
  if (typeof err === 'string') return err
  if (err instanceof Error) return err.message || String(err)
  const anyErr = err as { message?: unknown; error_msg?: unknown; errorMsg?: unknown }
  return String(anyErr.message ?? anyErr.error_msg ?? anyErr.errorMsg ?? err)
}

export type ErrorKind = 'network' | 'server' | 'moderation' | 'auth' | 'balance' | 'rateLimit' | 'timeout' | 'plain' | 'unknown'

export function classifyError(err: unknown): ErrorKind {
  const msg = messageOf(err).trim()
  if (!msg) return 'unknown'
  if (NETWORK_RE.test(msg)) return 'network'
  if (err instanceof SyntaxError || NONJSON_RE.test(msg)) return 'server'
  if (MODERATION_RE.test(msg)) return 'moderation'
  if (BALANCE_RE.test(msg)) return 'balance'
  if (AUTH_RE.test(msg)) return 'auth'
  if (RATELIMIT_RE.test(msg)) return 'rateLimit'
  if (SERVER5XX_RE.test(msg)) return 'server'
  if (TIMEOUT_RE.test(msg)) return 'timeout'
  if (msg.length <= 40 && CJK_RE.test(msg) && !TECHY_RE.test(msg)) return 'plain'
  return 'unknown'
}

/**
 * 错误 → 友好文案。分类按优先级短路：
 * 网络 → 非JSON → 审核 → 余额 → 鉴权 → 限频 → 5xx → 超时 → 短中文透传 → 状态码 → 兜底
 */
export function mapError(err: unknown, opts?: { fallback?: string }): string {
  const msg = messageOf(err).trim()
  if (!msg) return opts?.fallback ? t(opts.fallback) : t('errors.unknown')

  const kind = classifyError(err)
  if (kind === 'network') return t('errors.network')
  if (kind === 'server' && (err instanceof SyntaxError || NONJSON_RE.test(msg))) return t('errors.server')
  if (kind === 'moderation') return t('errors.moderation')
  if (kind === 'balance') return t('errors.balance')
  if (kind === 'auth') return t('errors.auth')
  if (kind === 'rateLimit') return t('errors.rateLimit')
  if (SERVER5XX_RE.test(msg)) return t('errors.unavailable')
  if (kind === 'timeout') return t('errors.timeout')

  // 后端友好中文（短、含中文、无技术特征）直接透传
  if (kind === 'plain') return msg

  if (/^\d{3}$/.test(msg)) return t('errors.requestFailed', { status: msg })

  return opts?.fallback ? t(opts.fallback) : t('errors.unknown')
}

function showFriendlyDialog(kind: 'balance' | 'rateLimit'): void {
  if (kind === 'balance') {
    showErrorNotice({
      kind: 'balance',
      title: String(t('errors.balanceTitle')),
      message: String(t('errors.balanceDetail')),
      primaryText: String(t('errors.balanceAction')),
      secondaryText: String(t('common.ok')),
      primaryAction: 'recharge',
    })
    return
  }
  showErrorNotice({
    kind: 'rateLimit',
    title: String(t('errors.rateLimitTitle')),
    message: String(t('errors.rateLimitDetail')),
    primaryText: String(t('common.ok')),
    secondaryText: '',
    primaryAction: 'dismiss',
  })
}

/** 统一错误 toast；余额不足 / 限流改为友好弹框 */
export function toastError(err: unknown, opts?: { fallback?: string; duration?: number }): void {
  const kind = classifyError(err)
  if (kind === 'balance' || kind === 'rateLimit') {
    showFriendlyDialog(kind)
    return
  }
  toast.error(mapError(err, opts), { duration: opts?.duration ?? 5000 })
}
