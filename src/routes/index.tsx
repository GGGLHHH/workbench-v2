import { createFileRoute, redirect } from '@tanstack/react-router'
import { AppShell } from '@/app-shell'
import { SORT_VALUES } from '@/components/project-nav'

// 侧边栏的「看的是哪个项目 + 哪份筛选」进 URL:可分享、前进后退可用、刷新自然还原。
// 详情内容本身不存 —— 那是 server state,useProject(id) 会自己拉。
// 侧边栏的展开/收起是纯 UI chrome,不进 URL(见 project-nav 的 localStorage)。
export interface ProjectSearch {
  project?: string
  search?: string
  status?: string
  sort?: string
}

// 取默认值时返回 undefined,让 router 把参数从 URL 里剥掉 —— 首页保持干净的 "/"
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined)

export const Route = createFileRoute('/')({
  validateSearch: (raw: Record<string, unknown>): ProjectSearch => ({
    project: str(raw.project),
    search: str(raw.search),
    status: str(raw.status),
    // 排序只认白名单:URL 是用户可改的,脏值会让 Select 显示空白
    sort: SORT_VALUES.includes(String(raw.sort)) ? String(raw.sort) : undefined,
  }),
  beforeLoad: async ({ context, location }) => {
    const session = await context.auth.getCurrentUser()
    if (!session?.authenticated) {
      throw redirect({ replace: true, to: '/login', search: { redirect: location.href } })
    }
  },
  component: AppShell,
})
