import { createFileRoute, redirect } from '@tanstack/react-router'
import { validateLoginSearch } from '@/lib/login-redirect'
import { LoginPage } from './-login-page'

// 登录页。已登录访客访问时弹回首页(guest 守卫)。
export const Route = createFileRoute('/login')({
  validateSearch: validateLoginSearch,
  beforeLoad: async ({ context }) => {
    const session = await context.auth.getCurrentUser()
    if (session?.authenticated) throw redirect({ to: '/' })
  },
  component: LoginPage,
})
