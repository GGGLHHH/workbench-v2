import { createFileRoute, redirect } from '@tanstack/react-router'
import { validateLoginSearch } from '@/lib/login-redirect'
import { LoginPage } from './-login-page'

// 登录页。已登录访客访问时弹回首页(guest 守卫)。
export const Route = createFileRoute('/login')({
  validateSearch: validateLoginSearch,
  beforeLoad: async ({ context }) => {
    // 游客守卫用软探测:只看「是否已登录」,不触发刷新阶梯 / 不弹「会话已过期」
    const session = await context.auth.getCurrentUserSoft()
    if (session?.authenticated) throw redirect({ to: '/' })
  },
  component: LoginPage,
})
