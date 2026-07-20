import { createFileRoute, redirect } from '@tanstack/react-router'
import { AppShell } from '@/app-shell'

// 主页(双层侧边栏 + 编辑器),受保护:未登录 → 跳 /login 并记回跳路径。
export const Route = createFileRoute('/')({
  beforeLoad: async ({ context, location }) => {
    const session = await context.auth.getCurrentUser()
    if (!session?.authenticated) {
      throw redirect({ replace: true, to: '/login', search: { redirect: location.href } })
    }
  },
  component: AppShell,
})
