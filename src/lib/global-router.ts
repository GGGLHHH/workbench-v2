import type { AnyRouter } from '@tanstack/react-router'

// 发布 router 实例给非 React 调用方(api-client 在 401 时用它跳转登录)。
export const globalRouter: { instance: AnyRouter | null } = {
  instance: null,
}
