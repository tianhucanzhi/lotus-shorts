/**
 * 全局友好错误弹框（额度不足 / 请求过频等），由 app.vue 挂载 ErrorNoticeDialog。
 */
import { navigateTo } from '#app'

export type ErrorNoticeKind = 'balance' | 'rateLimit' | 'info'

export type ErrorNoticeState = {
  open: boolean
  kind: ErrorNoticeKind
  title: string
  message: string
  primaryText: string
  secondaryText: string
  primaryAction: 'dismiss' | 'settings' | 'recharge'
}

const state = reactive<ErrorNoticeState>({
  open: false,
  kind: 'info',
  title: '',
  message: '',
  primaryText: '',
  secondaryText: '',
  primaryAction: 'dismiss',
})

export function useErrorNotice() {
  return state
}

export function showErrorNotice( partial: Omit<Partial<ErrorNoticeState>, 'open'> & Pick<ErrorNoticeState, 'title' | 'message'>): void {
  state.kind = partial.kind || 'info'
  state.title = partial.title
  state.message = partial.message
  state.primaryText = partial.primaryText || ''
  state.secondaryText = partial.secondaryText || ''
  state.primaryAction = partial.primaryAction || 'dismiss'
  state.open = true
}

export function closeErrorNotice(): void {
  state.open = false
}

export async function runErrorNoticePrimary(): Promise<void> {
  const action = state.primaryAction
  state.open = false
  if (action === 'settings') {
    await navigateTo('/settings')
    return
  }
  if (action === 'recharge') {
    await navigateTo('/settings')
    if (typeof window !== 'undefined') {
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent('lotus:open-recharge'))
      }, 300)
    }
  }
}
