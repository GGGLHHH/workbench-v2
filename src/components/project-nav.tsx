import { useCallback, useMemo } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useLocalStorageState } from 'ahooks'
import { useTranslation } from 'react-i18next'
import { FolderClosed, Info } from 'lucide-react'

// 类型引用,verbatimModuleSyntax 下会被完全擦除 → 与路由不构成运行时循环依赖
import type { ProjectSearch } from '@/routes/index'
import type { Panel } from '@/components/project-nav/types'
import { CollapseToggle, Rail, Section } from '@/components/project-nav/shell'
import { ListContent } from '@/components/project-nav/list/list-content'
import { DetailContent } from '@/components/project-nav/detail/detail-content'
import type { NavActions } from '@/components/project-nav/nav-context'
import { NavActionsProvider, StatusChangingProvider } from '@/components/project-nav/nav-context'

import {
  useAssigneeCount,
  useChangeProjectStatus,
  useProject,
  useProjectStats,
} from '@/api/projects/projects'
import { useSession } from '@/api/session/session'

// 手写双层侧边栏(互斥展开):第一层=项目列表(对齐 xchangeai-workbench 卡片:缩略图 +
// 负责人/机构 + resources/clips/时长 + 状态徽章 + 更新时间;搜索 + 状态筛选 tab + 计数 +
// 下拉分页),第二层=项目详情(后续再细化)。展开一个 → 另一个收成窄图标 rail。

export function ProjectNav() {
  const { t } = useTranslation()
  // 「看的是哪个项目 + 哪份筛选」进 URL(见 routes/index.tsx),刷新/后退天然还原。
  const params = useSearch({ from: '/' })
  const navigate = useNavigate({ from: '/' })
  const selectedId = params.project ?? null
  const search = params.search ?? ''
  const assignee = params.assignee ?? '' // URL 哨兵:'' | 'unassigned' | 'me'
  const sort = params.sort ?? 'created_desc'

  // 改筛选用 replace:搜索框每 300ms 防抖发一次,push 会把历史记录塞满。
  // 选项目用 push:后退键回到上一个看的项目(见 AskUserQuestion 里选的那条)。
  const setFilter = useCallback(
    (patch: ProjectSearch) => void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true }),
    [navigate],
  )
  // 这三个一路传到 memo 化的 ListHeader,必须稳定
  const onSearch = useCallback((v: string) => setFilter({ search: v || undefined }), [setFilter])
  const onAssigneeChange = useCallback((v: string) => setFilter({ assignee: v || undefined }), [setFilter])
  const onSortChange = useCallback((v: string) => setFilter({ sort: v }), [setFilter])

  // active = 哪一栏(该)展开;collapsed = 两栏同时收起。
  // 收起时刻意不动 active —— 它本身就是「收起前展开的是哪个」的记忆,还原直接读它,
  // 无需再存一份"记住谁展开过"(冗余状态迟早和 active 不同步)。
  // 这两个是纯 UI chrome:不进 URL(没人想分享"我把侧边栏收起来了"),存 localStorage。
  const [active = 'list', setActive] = useLocalStorageState<Panel>('nav.active', {
    defaultValue: 'list',
  })
  const [collapsed = false, setCollapsed] = useLocalStorageState<boolean>('nav.collapsed', {
    defaultValue: false,
  })

  // 「我的项目」= 指派给当前会话用户 → 查询时把哨兵 'me' 解析成自身 id;会话未就绪时退回全部。
  const meId = useSession().data?.user?.id
  const apiAssignee = assignee === 'me' ? (meId ?? '') : assignee

  // 列表数据由 ListContent 自己按可见区间取(虚拟化 → 随机访问),这里只留 stats + 两个计数供筛选行。
  const params2 = useMemo(() => ({ search, assignee: apiAssignee, sort }), [search, apiAssignee, sort])
  const stats = useProjectStats()
  // 筛选行计数:All=stats.total;Unassigned/My 各发一个 limit:1 列表读 total(全局,不跟随搜索)。
  const allCount = stats.data?.total
  const unassignedCount = useAssigneeCount('unassigned', true).data
  const mineCount = useAssigneeCount(meId ?? '', Boolean(meId)).data
  const statsRefetch = stats.refetch
  const refreshStats = useCallback(() => void statsRefetch(), [statsRefetch])
  const detail = useProject(selectedId)

  // 点 rail / 选项目 → 展开该栏(顺带解除整体收起)
  // useCallback:要进 actions memo,身份必须稳,否则 memo 每次重建、Task 12/13 的消费者白订阅
  const openPanel = useCallback(
    (panel: Panel) => {
      setActive(panel)
      setCollapsed(false)
    },
    [setActive, setCollapsed],
  )
  const collapse = useCallback(() => setCollapsed(true), [setCollapsed])
  const toggleCollapse = useCallback(() => setCollapsed((v) => !v), [setCollapsed])
  const backToList = useCallback(() => setActive('list'), [setActive])

  // useCallback:这两个会一路传到 memo 化的 ProjectCard,身份不稳 memo 就失效
  const selectProject = useCallback(
    (id: string) => {
      void navigate({ search: (prev) => ({ ...prev, project: id }) })
      setActive('detail')
      setCollapsed(false)
    },
    [navigate, setActive, setCollapsed],
  )

  const listExpanded = !collapsed && active === 'list'
  const detailExpanded = !collapsed && active === 'detail'

  const changeStatus = useChangeProjectStatus()
  const changeStatusMutate = changeStatus.mutate
  const changeProjectStatus = useCallback(
    (id: string, action: string) => changeStatusMutate({ id, action }),
    [changeStatusMutate],
  )

  // 稳定回调聚成一个 identity 恒定的 value(deps 覆盖全 10 个字段);消费在 Task 12/13。
  const actions = useMemo<NavActions>(
    () => ({
      selectProject,
      changeProjectStatus,
      onSearch,
      onAssigneeChange,
      onSortChange,
      refreshStats,
      openPanel,
      collapse,
      toggleCollapse,
      backToList,
    }),
    [
      selectProject,
      changeProjectStatus,
      onSearch,
      onAssigneeChange,
      onSortChange,
      refreshStats,
      openPanel,
      collapse,
      toggleCollapse,
      backToList,
    ],
  )
  const statusChangingId = changeStatus.isPending ? (changeStatus.variables?.id ?? null) : null

  // 宽度走 CSS 变量(对齐官方 sidebar 的 --sidebar-width / --sidebar-width-icon):
  // Section 与其中的层共用同一组值,不会各写各的magic number 而漂移。
  return (
    <NavActionsProvider value={actions}>
      <StatusChangingProvider value={statusChangingId}>
        <div
      className="flex h-full shrink-0 border-r bg-sidebar text-sidebar-foreground"
      style={{ '--panel-w': '24rem', '--panel-w-icon': '3rem' } as React.CSSProperties}
    >
      <Section
        expanded={listExpanded}
        bordered
        rail={
          // toggle 固定挂在最左侧 section 顶部 —— 无论展开/收起,它在屏幕上的位置基本不动
          <Rail
            icon={<FolderClosed className="size-4" />}
            label={t('projectNav.projects')}
            onExpand={() => openPanel('list')}
            topAction={<CollapseToggle collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />}
          />
        }
        panel={
          <ListContent
            visible={listExpanded}
            onToggleCollapse={() => setCollapsed(true)}
            params={params2}
            allCount={allCount}
            unassignedCount={unassignedCount}
            mineCount={mineCount}
            search={search}
            onSearch={onSearch}
            assignee={assignee}
            onAssigneeChange={onAssigneeChange}
            sort={sort}
            onSortChange={onSortChange}
            onRefreshStats={refreshStats}
            onChangeStatus={changeProjectStatus}
            statusChangingId={changeStatus.isPending ? (changeStatus.variables?.id ?? null) : null}
            selectedId={selectedId}
            onSelect={selectProject}
          />
        }
      />

      <Section
        expanded={detailExpanded}
        rail={
          <Rail
            icon={<Info className="size-4" />}
            label={t('projectNav.details')}
            disabled={!selectedId}
            onExpand={() => selectedId && openPanel('detail')}
          />
        }
        panel={
          <DetailContent
            loading={detail.isPending && Boolean(selectedId)}
            project={detail.data}
            visible={detailExpanded}
            onBack={() => setActive('list')}
            onChangeStatus={(id, action) => changeStatus.mutate({ id, action })}
            statusBusy={changeStatus.isPending && changeStatus.variables?.id === selectedId}
          />
        }
      />
    </div>
      </StatusChangingProvider>
    </NavActionsProvider>
  )
}
