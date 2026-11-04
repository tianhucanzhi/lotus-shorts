import { AsyncLocalStorage } from 'node:async_hooks'

export type RequestStore = {
  userId: number | null
  username?: string | null
  role?: string | null
}

const als = new AsyncLocalStorage<RequestStore>()

export function runWithRequestContext<T>(store: RequestStore, fn: () => T): T {
  return als.run(store, fn)
}

export function getRequestUserId(): number | null {
  return als.getStore()?.userId ?? null
}

export function getRequestUser(): RequestStore | null {
  return als.getStore() ?? null
}
