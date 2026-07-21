import ky, { isNetworkError, isTimeoutError } from 'ky'
import type { Options as KyOptions } from 'ky'
import { toast } from 'sonner'
import { refreshBffSession } from '@/generated/api'
import i18n from '@/i18n'
import { globalRouter } from '@/lib/global-router'
import { queryClient } from '@/lib/query-client'
import { queryKeys } from '@/lib/query-keys'

// vite-plugin-openapi-codegen 的 httpClient 模块：src/generated/client.ts 从这里 import
// { requestJson, requestVoid } 与类型 ApiRequestOptions。
// 登录失效处理对齐 xchangeai-web/src/lib/api-client.ts:access token 过期(401)先静默
// POST /bff/session/refresh 刷新 → 重放原请求;refresh 也失败才登出(去重 toast「会话已过期」
// + 清缓存 + 带 redirect 跳登录)。soft 探测 / 登录端点自身的 401 不触发级联。

// 会话软探测头:带此头的 401 只抛错、不触发刷新/登出级联(供 router-auth / 路由守卫用)。
export const SOFT_AUTH_HEADER = 'x-soft-auth-check'
// 标记「刷新后重放」的请求:若它再 401 → 终态失败,不再刷新(防死循环)。
const RETRIED_AFTER_REFRESH_HEADER = 'x-retried-after-refresh'
// 标记「刷新请求」自身:它的 401 由 ensureRefreshed 的 catch 统一登出,afterResponse 不重复处理。
const REFRESH_REQUEST_HEADER = 'x-refresh-request'
// 会话/鉴权端点:登录、登出、探测(GET)在 SESSION_PATH,刷新在 REFRESH_PATH。都不进刷新阶梯。
const SESSION_PATH = '/bff/session'
const REFRESH_PATH = '/bff/session/refresh'

// 生成代码里 octet-stream 上传会带 contentType（ky 未识别会忽略，与 xchangeai-web 行为一致）。
export type ApiRequestOptions = KyOptions & { contentType?: string }
export type ApiErrorKind = 'abort' | 'http' | 'network' | 'timeout'

export class ApiError extends Error {
  code?: string
  details?: Record<string, unknown>
  kind: ApiErrorKind
  status?: number

  constructor(
    message: string,
    options?: {
      code?: string
      details?: Record<string, unknown>
      kind?: ApiErrorKind
      status?: number
    },
  ) {
    super(message)
    this.name = 'ApiError'
    this.code = options?.code
    this.details = options?.details
    this.kind = options?.kind ?? 'http'
    this.status = options?.status
    Object.setPrototypeOf(this, ApiError.prototype)
  }
}

// ---- 登录失效处理:401 刷新阶梯 + 去重登出(对齐 xchangeai-web) ----
let refreshPromise: Promise<void> | null = null
let authFailureHandled = false

function pathnameOf(request: Request): string {
  try {
    return new URL(request.url).pathname
  } catch {
    return request.url
  }
}
const isSoftAuth = (request: Request) => request.headers.get(SOFT_AUTH_HEADER) === '1'
const isRefreshRequest = (request: Request) => request.headers.get(REFRESH_REQUEST_HEADER) === '1'
const isLoginRequest = (request: Request) =>
  request.method === 'POST' && pathnameOf(request) === SESSION_PATH
const isLogoutRequest = (request: Request) =>
  request.method === 'DELETE' && pathnameOf(request) === SESSION_PATH
const isRefreshEndpoint = (request: Request) => pathnameOf(request) === REFRESH_PATH
// 跳过刷新阶梯、且不触发权限提示的「鉴权写端点」:登录 / 登出 / 刷新自身。
// 关键:GET /bff/session(取当前用户)不在此列 —— 它是受保护读,access 过期(401)时必须能走
// 刷新阶梯恢复,否则手动清掉 access 后 F5 会直接掉登录(而 refresh_token 明明还有效)。
const isAuthMutationEndpoint = (request: Request) =>
  isLoginRequest(request) || isLogoutRequest(request) || isRefreshEndpoint(request)
// 成功命中登录/刷新即视为会话恢复:重置去重标志,让下次真失效还能再提示一次。
const isAuthRecoveryRequest = (request: Request) =>
  isLoginRequest(request) || isRefreshEndpoint(request)

// 终态登出:清会话缓存 + toast(稳定 id 去重,多个并发 401 只弹一次)+ 带 redirect 跳登录,
// 导航落地后清全部缓存(下次登录从干净状态开始)。
function handleAuthFailure(): void {
  queryClient.setQueryData(queryKeys.session(), null)
  toast.error(i18n.t('apiClient.sessionExpired'), { id: 'session-expired', description: i18n.t('apiClient.reLogin') })

  const current = globalRouter.instance?.state.location
  let navigation: Promise<unknown> | undefined
  if (current && current.pathname !== '/login') {
    // 暂存过期位置,登录后回跳(登录路由读取时做开放重定向校验)
    navigation = globalRouter.instance?.navigate({ to: '/login', search: { redirect: current.href } })
  }
  void Promise.resolve(navigation).finally(() => queryClient.clear())
}
// 并发 401 只登出一次;成功刷新/登录时 resetAuthFailureState,下次真失效可再触发。
function handleAuthFailureOnce(): void {
  if (authFailureHandled) return
  authFailureHandled = true
  handleAuthFailure()
}
function resetAuthFailureState(): void {
  authFailureHandled = false
}
// 403:会话有效但角色无权 —— 失效会话让守卫下次重评 + 提示,但绝不跳转(可能只是当前页某个操作被禁)。
function handlePermissionDenied(): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.session() })
  toast.error(i18n.t('apiClient.noPermission'), { id: 'permission-denied' })
}

// 生成代码走完整路径(/api/v1/... 与 /bff/...)——两个根,故 ky 不设 prefix；
// dev 由 vite 代理(/api、/bff → BFF)分流,生产同源于 BFF。
export const api = ky.create({
  credentials: 'include',
  timeout: 300_000, // 5 分钟：容纳导入/生成等长任务
  retry: { limit: 1, shouldRetry: () => false },
  hooks: {
    afterResponse: [
      async ({ request, response }) => {
        // 成功命中鉴权恢复端点(登录/刷新)→ 重置去重标志
        if (response.ok && isAuthRecoveryRequest(request)) resetAuthFailureState()

        // 401 处理次序(每个分支必须先于下一个):
        //   1. soft 探测        → 静默抛错(不刷新/不 toast/不跳转),守卫自己判定未登录
        //   2. 登录请求         → 抛错(密码错等由登录页提示),不触发全局登出
        //   3. 登出/刷新端点自身 → 登出一次 + 抛错(刷新请求自身除外,交给 ensureRefreshed 的 catch)
        //   4. 刷新后已重放过   → 终态失败,登出一次 + 抛错
        //   5. 其余(含 GET /bff/session 硬探测、/bff/projects…)→ 静默刷新 → 重放原请求
        if (response.status === 401) {
          if (isSoftAuth(request)) throw await createApiError(response)
          if (isLoginRequest(request)) throw await createApiError(response)
          if (isLogoutRequest(request) || isRefreshEndpoint(request)) {
            if (!isRefreshRequest(request)) handleAuthFailureOnce()
            throw await createApiError(response)
          }
          if (request.headers.get(RETRIED_AFTER_REFRESH_HEADER) === '1') {
            handleAuthFailureOnce()
            throw await createApiError(response)
          }
          try {
            await ensureRefreshed()
          } catch {
            throw await createApiError(response)
          }
          return retryRequestAfterRefresh(request)
        }

        if (response.status === 403) {
          if (!isSoftAuth(request) && !isAuthMutationEndpoint(request)) handlePermissionDenied()
          throw await createApiError(response)
        }

        if (!response.ok) throw await createApiError(response)
        return response
      },
    ],
  },
})

// 单飞刷新:并发 401 共用同一个刷新 promise;失败则登出一次并把错误抛给各等待方。
async function ensureRefreshed(): Promise<void> {
  if (!refreshPromise) {
    refreshPromise = api
      .post(refreshBffSession(), { headers: { [REFRESH_REQUEST_HEADER]: '1' } })
      .json()
      .then(
        () => undefined,
        (error) => {
          handleAuthFailureOnce()
          throw error
        },
      )
      .finally(() => {
        refreshPromise = null
      })
  }
  return refreshPromise
}
// 刷新成功后重放原请求(打上已重放标记,防再次 401 时无限刷新)。
function retryRequestAfterRefresh(request: Request) {
  const headers = new Headers(request.headers)
  headers.set(RETRIED_AFTER_REFRESH_HEADER, '1')
  return ky.retry({
    code: 'AUTH_REFRESHED',
    delay: 0,
    request: new Request(request, { headers }),
  })
}

export async function requestJson<T>(path: string, options: ApiRequestOptions): Promise<T> {
  try {
    return await api(path, options).json<T>()
  } catch (error) {
    throw createClientError(error)
  }
}

export async function requestVoid(path: string, options: ApiRequestOptions): Promise<void> {
  try {
    await api(path, options)
  } catch (error) {
    throw createClientError(error)
  }
}

async function createApiError(response: Response): Promise<ApiError> {
  let message = `Request failed (${response.status})`
  let code: string | undefined
  let details: Record<string, unknown> | undefined
  try {
    const data = (await response.clone().json()) as {
      code?: string
      detail?: string
      details?: Record<string, unknown>
      error?: string
      message?: string
    }
    message = data.message || data.detail || data.error || message
    code = data.code
    details = data.details
  } catch {
    message = response.statusText || message
  }
  return new ApiError(message, { code, details, kind: 'http', status: response.status })
}

function createClientError(error: unknown): ApiError {
  if (error instanceof ApiError) return error
  if (isTimeoutError(error)) {
    return new ApiError('The request timed out. Please try again.', { kind: 'timeout' })
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new ApiError('The request was canceled.', { kind: 'abort' })
  }
  if (isNetworkError(error)) {
    return new ApiError('Unable to reach the server. Check your connection and try again.', {
      kind: 'network',
    })
  }
  return new ApiError('Request failed. Please try again.', { kind: 'network' })
}

export function extractErrorMessage(error: unknown, fallback = 'Request failed'): string {
  if (error instanceof Error && error.message) return error.message
  if (error && typeof error === 'object') {
    const e = error as { detail?: unknown; error?: unknown; message?: unknown }
    for (const v of [e.message, e.detail, e.error]) {
      if (typeof v === 'string' && v) return v
    }
  }
  return fallback
}
