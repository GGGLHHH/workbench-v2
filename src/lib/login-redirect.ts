export interface LoginSearch {
  /**
   * 登录成功后回跳的目标。由 401 回弹(路由守卫 + api-client)写入,登录页读取。
   * 始终是经 {@link sanitizeLoginRedirect} 消毒过的 app 内相对路径。
   */
  redirect?: string
}

/**
 * `?redirect=` 的开放重定向防护:仅当值是 app 内相对路径(单个前导斜杠、无 scheme、
 * 无反斜杠)时才返回;拒绝 '//evil.com'、'http://…'、'/\evil.com'(浏览器都会解析成跨源)。
 * 回跳到登录页本身是死循环,也丢弃。
 */
export function sanitizeLoginRedirect(raw: unknown): string | undefined {
  if (typeof raw !== 'string') {
    return undefined
  }
  const value = raw.trim()
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return undefined
  }
  const path = value.split(/[?#]/)[0]
  if (path === '/login') {
    return undefined
  }
  return value
}

/** /login 路由的 validateSearch。 */
export function validateLoginSearch(search: Record<string, unknown>): LoginSearch {
  return { redirect: sanitizeLoginRedirect(search.redirect) }
}
