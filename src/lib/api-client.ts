import ky, { isNetworkError, isTimeoutError } from 'ky'
import type { Options as KyOptions } from 'ky'
import { globalRouter } from '@/lib/global-router'
import { queryClient } from '@/lib/query-client'
import { queryKeys } from '@/lib/query-keys'

// vite-plugin-openapi-codegen 的 httpClient 模块：src/generated/client.ts 从这里 import
// { requestJson, requestVoid } 与类型 ApiRequestOptions。参考 xchangeai-web/src/lib/api-client.ts。
// 401(非 soft 探测)→ 清会话缓存 + 跳 /login;soft 探测由守卫自己处理不在此跳转。

// 会话软探测头:带此头的 401 不触发下面的跳转级联(供 router-auth / 路由守卫用)。
export const SOFT_AUTH_HEADER = 'x-soft-auth-check'

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

// 生成代码走完整路径(/api/v1/... 与 /bff/...)——两个根,故 ky 不设 prefix；
// dev 由 vite 代理(/api、/bff → BFF)分流,生产同源于 BFF。
export const api = ky.create({
  credentials: 'include',
  timeout: 300_000, // 5 分钟：容纳导入/生成等长任务
  retry: { limit: 1, shouldRetry: () => false },
  hooks: {
    afterResponse: [
      async ({ request, response }) => {
        // 401 且非 soft 探测 → 清会话缓存 + 跳登录(携带回跳路径)
        if (response.status === 401 && request.headers.get(SOFT_AUTH_HEADER) !== '1') {
          queryClient.setQueryData(queryKeys.session(), null)
          const current = globalRouter.instance?.state.location
          if (current && current.pathname !== '/login') {
            void globalRouter.instance?.navigate({ to: '/login', search: { redirect: current.href } })
          }
        }
        if (!response.ok) throw await createApiError(response)
        return response
      },
    ],
  },
})

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
