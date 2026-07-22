import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useVirtualizer } from '@tanstack/react-virtual'
import useEmblaCarousel from 'embla-carousel-react'
import { useLocalStorageState } from 'ahooks'
import { useTranslation } from 'react-i18next'
import {
  ChevronLeft,
  Clapperboard,
  Clock,
  CloudDownload,
  ExternalLink,
  FolderClosed,
  Image as ImageIcon,
  Info,
  Loader2,
  MessageSquare,
  Pencil,
  Share2,
} from 'lucide-react'

import type { BffProject } from '@/generated/api-types'
// 类型引用,verbatimModuleSyntax 下会被完全擦除 → 与路由不构成运行时循环依赖
import type { ProjectSearch } from '@/routes/index'
import type { Anchor, Panel, ProjectSummary } from '@/components/project-nav/types'
import type { MetaDraft } from '@/components/project-nav/detail/meta-draft'
import { ASSIGNEE_FILTERS, ROW_GAP, ROW_HEIGHT, SORT_OPTIONS } from '@/components/project-nav/constants'
import { CollapseToggle, Layer, PanelBody, Rail, Section } from '@/components/project-nav/shell'
import { Field, Group, Metric, Row } from '@/components/project-nav/fields'
import { ProjectStatusMenu } from '@/components/project-nav/status-menu'
import { ProjectCard } from '@/components/project-nav/list/project-card'
import { VisibilityMenu } from '@/components/project-nav/detail/visibility-menu'
import { AnalyticsPanel, PUBLISHED_STATUSES } from '@/components/project-nav/detail/analytics-panel'
import { detailToDraft, draftToMeta } from '@/components/project-nav/detail/meta-draft'
import { MetaForm } from '@/components/project-nav/detail/meta-form'
import { AssetGrid } from '@/components/project-nav/detail/asset-grid'

import {
  PROJECTS_PAGE_SIZE,
  useAssigneeCount,
  useChangeProjectStatus,
  useProject,
  useProjectOptions,
  useProjectPages,
  useProjectStats,
  useSaveProjectAssignee,
  useSaveProjectMeta,
  useSaveProjectVisibility,
} from '@/api/projects/projects'
import { useSession } from '@/api/session/session'
import { absTime, relTime, usd } from '@/lib/format'
import { LanguageToggle } from '@/components/language-toggle'
import { ThemeToggle } from '@/components/theme-toggle'
import { CommentPane } from '@/components/comment-pane'
import type { ProjectListParams } from '@/lib/query-keys'
import { cn } from '@/lib/utils'
import { useScrollFade } from '@/lib/use-scroll-fade'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Thumb, duration } from '@/components/media-card'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SearchInput } from '@/components/form/search-input'
import { editorProjectRef } from '@/editor-app'
import type { ListingMeta } from '@/lib/video-overlays'
import { refreshBannerText } from '@/lib/video-overlays-store'
import { VideoOverlaysSection } from '@/components/project-nav/overlays/video-overlays-section'

// 手写双层侧边栏(互斥展开):第一层=项目列表(对齐 xchangeai-workbench 卡片:缩略图 +
// 负责人/机构 + resources/clips/时长 + 状态徽章 + 更新时间;搜索 + 状态筛选 tab + 计数 +
// 下拉分页),第二层=项目详情(后续再细化)。展开一个 → 另一个收成窄图标 rail。

const readAnchor = (key: string): Anchor | null => {
  try {
    return JSON.parse(sessionStorage.getItem(key) ?? 'null') as Anchor | null
  } catch {
    return null
  }
}

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
  const openPanel = (panel: Panel) => {
    setActive(panel)
    setCollapsed(false)
  }

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

  return (
    // 宽度走 CSS 变量(对齐官方 sidebar 的 --sidebar-width / --sidebar-width-icon):
    // Section 与其中的层共用同一组值,不会各写各的magic number 而漂移。
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
  )
}

// 头部单独 memo:滚动时虚拟化器每帧都让 ListContent 重渲染,而搜索框、11 个状态 tab、
// 排序下拉这些跟滚动毫无关系 —— 不隔离的话它们每帧都跟着 diff 一遍。
const ListHeader = memo(function ListHeader({
  search,
  onSearch,
  assignee,
  onAssigneeChange,
  sort,
  onSortChange,
  allCount,
  unassignedCount,
  mineCount,
  syncing,
  onSync,
  onToggleCollapse,
  tabsViewportRef,
}: {
  search: string
  onSearch: (value: string) => void
  assignee: string
  onAssigneeChange: (value: string) => void
  sort: string
  onSortChange: (value: string) => void
  // 三档计数(数字为原始类型 → memo 逐值比较稳定;undefined = 尚未加载)
  allCount?: number
  unassignedCount?: number
  mineCount?: number
  syncing: boolean
  onSync: () => void
  onToggleCollapse: () => void
  tabsViewportRef: React.RefObject<HTMLDivElement | null>
}) {
  const { t } = useTranslation()
  return (
    <>
      {/* 头部:标题 + 同步 + 搜索 + 状态筛选 tab */}
      <div className="flex flex-col gap-2 border-b p-2">
        <div className="flex items-center gap-2 px-1">
          {/* 与收起态 rail 顶部的 toggle 同一位置(最左),避免来回切时按钮跳位 */}
          <CollapseToggle collapsed={false} onToggle={onToggleCollapse} />
          <span className="flex-1 text-sm font-semibold">{t('projectNav.projects')}</span>
          <ThemeToggle />
          <LanguageToggle />
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            disabled={syncing}
            onClick={onSync}
          >
            {syncing ? <Loader2 className="size-3.5 animate-spin" /> : <CloudDownload className="size-3.5" />} {t('projectNav.sync')}
          </Button>
        </div>
        <SearchInput
          value={search}
          onValueChange={onSearch}
          placeholder={t('projectNav.searchPlaceholder')}
          aria-label={t('projectNav.searchAria')}
          inputClassName="h-8 text-sm"
        />
        {/* tab 条本来就有左右渐隐,再加一条横向滚动条只会挤掉半行高度 */}
        <ScrollArea viewportRef={tabsViewportRef} scrollbar="none" className="w-full">
          <div className="flex w-max gap-1">
            {ASSIGNEE_FILTERS.map((f) => {
              const count = f.id === '' ? allCount : f.id === 'unassigned' ? unassignedCount : mineCount
              const isActive = assignee === f.id
              return (
                <button
                  key={f.id || 'all'}
                  type="button"
                  onClick={() => onAssigneeChange(f.id)}
                  className={cn(
                    'flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs whitespace-nowrap transition-colors',
                    isActive
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                      : 'text-muted-foreground hover:bg-sidebar-accent/50',
                  )}
                >
                  <span>{t(f.labelKey)}</span>
                  {count !== undefined ? (
                    <span className={cn('tabular-nums', isActive && 'font-semibold')}>{count}</span>
                  ) : null}
                </button>
              )
            })}
          </div>
        </ScrollArea>
      </div>

      <div className="flex items-center justify-between px-3 py-2 text-xs text-muted-foreground">
        <span className="font-medium tracking-wide">RECENT PROJECTS</span>
        <Select items={SORT_OPTIONS} value={sort} onValueChange={(value) => onSortChange(String(value))}>
          <SelectTrigger
            size="sm"
            className="h-6 gap-1 border-0 bg-transparent px-1.5 text-xs text-muted-foreground shadow-none hover:text-foreground focus-visible:ring-0 dark:bg-transparent dark:hover:bg-transparent"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {SORT_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

    </>
  )
})

function ListContent({
  params,
  allCount,
  unassignedCount,
  mineCount,
  search,
  onSearch,
  assignee,
  onAssigneeChange,
  sort,
  onSortChange,
  onRefreshStats,
  onChangeStatus,
  statusChangingId,
  selectedId,
  onSelect,
  onToggleCollapse,
  visible,
}: {
  params: ProjectListParams
  allCount?: number
  unassignedCount?: number
  mineCount?: number
  search: string
  onSearch: (value: string) => void
  assignee: string
  onAssigneeChange: (value: string) => void
  sort: string
  onSortChange: (value: string) => void
  onRefreshStats: () => void
  onChangeStatus: (id: string, action: string) => void
  statusChangingId: string | null
  selectedId: string | null
  onSelect: (id: string) => void
  onToggleCollapse: () => void
  visible: boolean
}) {
  const { t } = useTranslation()
  const viewportRef = useRef<HTMLDivElement>(null)
  const tabsViewportRef = useRef<HTMLDivElement>(null)
  useScrollFade(viewportRef, 'vertical') // 列表上下阴影
  useScrollFade(tabsViewportRef, 'horizontal') // 状态 tab 左右阴影

  // 锚点按筛选分桶:换了筛选就是另一批数据,位置不该串。
  const anchorKey = `nav.anchor:${params.search}|${params.assignee}|${params.sort}`
  const [anchor, setAnchor] = useState<Anchor | null>(() => readAnchor(anchorKey))

  // 该取哪几页。初值直接落在锚点所在页,于是「刷新 → 回到原位」只有一个请求,
  // 与滚动深度无关(第 20 条和第 3847 条一样快)。
  const anchorPage = Math.floor((anchor?.index ?? 0) / PROJECTS_PAGE_SIZE)
  const [pageRange, setPageRange] = useState(() => ({ start: anchorPage, end: anchorPage }))
  const { total, itemAt, isPending, isError, isFetching, refetch } = useProjectPages(params, pageRange)

  // 定高:实测全部 70 行都是 115px(标题 truncate 不换行、面板定宽),
  // 所以不挂 measureElement —— 每行一个 ResizeObserver、每次测量触发重算,
  // 是滚动卡顿的大头。定高还顺带让锚点偏移天然精确,不存在估算漂移。
  const virtualizer = useVirtualizer({
    count: total,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 6,
    gap: ROW_GAP,
  })
  const virtualItems = virtualizer.getVirtualItems()

  // 虚拟化器报告可见区间 → 驱动取页。相等时不 setState,否则每帧一次渲染循环。
  // 有锚点但还没落位时先按兵不动:此刻 scrollTop 还是 0,区间是 [0,13],
  // 照着它取页会白拉一次第 0 页(还原完立刻就作废)。
  useEffect(() => {
    if (anchor && !restoredRef.current) return
    const first = virtualItems[0]?.index
    const last = virtualItems[virtualItems.length - 1]?.index
    if (first === undefined || last === undefined) return
    // 量化到页号再 setState:按条目算的话每滚一行就是一次 setState + useQueries 重建,
    // 等于把渲染摊到每一帧;按页算 20 行才动一次。
    const start = Math.floor(first / PROJECTS_PAGE_SIZE)
    const end = Math.floor(last / PROJECTS_PAGE_SIZE)
    setPageRange((r) => (r.start === start && r.end === end ? r : { start, end }))
  }, [virtualItems, anchor])

  // 切筛选 = 换了一批数据:重读该桶的锚点、解封还原标记(否则回到原筛选也不还原了)、
  // 该桶没存过就回顶(视口不会自己归零,会停在上一份数据的位置上)。
  const restoredRef = useRef(false)
  useEffect(() => {
    const next = readAnchor(anchorKey)
    restoredRef.current = false
    setAnchor(next)
    const page = Math.floor((next?.index ?? 0) / PROJECTS_PAGE_SIZE)
    setPageRange({ start: page, end: page })
    if (!next) viewportRef.current?.scrollTo({ top: 0 })
  }, [anchorKey])

  // 还原。目标像素 = 该行的起始偏移 + 当时视口切在这行的第几像素;
  // 少了后半截只能落到「对的那一行」,落不回「一模一样的画面」。
  //
  // 不能一上来就把 restoredRef 封上:此刻容器可能还没高度、锚点那页可能还在路上,
  // 定位就是空操作。所以每次测量更新都重试,直到 scrollTop 真的落到位才封 ——
  // 封早了会停在顶部,封晚了(不封)用户往回滚会被反复拽回去。
  useEffect(() => {
    const el = viewportRef.current
    if (restoredRef.current || !anchor || !total || !visible || !el?.clientHeight) return
    const target = virtualizer.getOffsetForIndex(anchor.index, 'start')?.[0]
    if (target === undefined) return
    const want = target + anchor.offsetInItem
    virtualizer.scrollToOffset(want)
    if (Math.abs(el.scrollTop - want) <= 1) restoredRef.current = true
  }, [anchor, total, visible, virtualizer, virtualItems])

  // 记锚点:顶部第一条的下标 + 视口切在它内部的偏移(Chrome «Complexities of an
  // infinite scroller» 的做法)。存下标而不是 scrollTop —— 后者在行高被测量修正后就失真了。
  useEffect(() => {
    const el = viewportRef.current
    if (!el || !visible) return
    let raf = 0
    const save = () => {
      raf = 0
      // 还没落位就别存 —— 会把"未还原的位置"覆盖掉真正的锚点
      if (anchor && !restoredRef.current) return
      // 取「视口里真正切到的那一条」,不是 getVirtualItems()[0](后者是 overscan 的头一条,
      // 在视口上方,算出的 offsetInItem 会跨好几行)。
      // 找不到就直接放弃,不兜底 —— 切筛选的瞬间虚拟化器已重置到 index 0 而 scrollTop 还停在
      // 旧位置,这时硬凑会存出 {index:0, offsetInItem:5000} 这种跨桶污染的垃圾。
      const rows = virtualizer.getVirtualItems()
      const first = rows.find((v) => v.start <= el.scrollTop && v.end > el.scrollTop)
      if (!first) return
      sessionStorage.setItem(
        anchorKey,
        JSON.stringify({ index: first.index, offsetInItem: Math.round(el.scrollTop - first.start) }),
      )
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(save)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('pagehide', save)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      el.removeEventListener('scroll', onScroll)
      window.removeEventListener('pagehide', save)
      // 不在 cleanup 里补存:切桶/卸载那一刻虚拟化器已重置而 scrollTop 未变,
      // 此时的几何是不可信的。滚动时的 rAF + pagehide 已经覆盖了真实场景。
    }
  }, [anchorKey, visible, virtualizer, anchor])

  // memo 化的头部要稳定的回调,否则每帧新函数、memo 失效
  const onSync = useCallback(() => {
    refetch()
    onRefreshStats()
  }, [refetch, onRefreshStats])

  return (
    <PanelBody>
      <ListHeader
        search={search}
        onSearch={onSearch}
        assignee={assignee}
        onAssigneeChange={onAssigneeChange}
        sort={sort}
        onSortChange={onSortChange}
        allCount={allCount ?? total}
        unassignedCount={unassignedCount}
        mineCount={mineCount}
        syncing={isFetching}
        onSync={onSync}
        onToggleCollapse={onToggleCollapse}
        tabsViewportRef={tabsViewportRef}
      />

      <ScrollArea viewportRef={viewportRef} className="min-h-0 flex-1">
        {isPending ? (
          <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> {t('common.loading')}
          </div>
        ) : isError ? (
          <div className="p-3 text-sm text-destructive">{t('common.loadFailed')}</div>
        ) : total === 0 ? (
          <div className="p-3 text-sm text-muted-foreground">{t('projectNav.noMatchingProjects')}</div>
        ) : (
          // 撑满整份 total 的高度 —— 滚动条据此忠实反映"在 N 条里的第几条"。
          // 位移只写在外层一个节点上(TanStack Virtual 官方推荐):原先每行各写一个
          // transform,滚动时每帧 20 次样式写入 + 20 次 diff;现在每帧 1 次。
          // 行在常规流里靠定高 + margin 排布,步长与虚拟化器的 gap 配置一致。
          <div className="px-2" style={{ height: virtualizer.getTotalSize() }}>
            <div style={{ transform: `translateY(${virtualItems[0]?.start ?? 0}px)` }}>
            {virtualItems.map((row) => {
              const project = itemAt(row.index)
              return (
                <div
                  key={row.key}
                  data-index={row.index}
                  style={{ height: ROW_HEIGHT, marginBottom: ROW_GAP }}
                >
                  {project ? (
                    <ProjectCard
                      project={project as ProjectSummary}
                      active={selectedId === project.id}
                      busy={statusChangingId === project.id}
                      onOpen={onSelect}
                      onChangeStatus={onChangeStatus}
                    />
                  ) : (
                    // tombstone:该行所在页还在路上。占住估算高度,避免滚动条抽搐
                    <div
                      className="animate-pulse rounded-lg border bg-card/40"
                      style={{ height: ROW_HEIGHT }}
                    />
                  )}
                </div>
              )
            })}
            </div>
          </div>
        )}
      </ScrollArea>
    </PanelBody>
  )
}

// 详情面板:对齐 xchangeai-workbench 的 "Project details" 表单(ProjectMetaPanel)+ TopBar 摘要。
// 那边是弹窗,这里就地切换 view/edit —— 同样的元素,少一层模态。
function DetailContent({
  loading,
  project,
  visible,
  onBack,
  onChangeStatus,
  statusBusy,
}: {
  loading: boolean
  project: BffProject | undefined
  visible: boolean
  onBack: () => void
  onChangeStatus: (id: string, action: string) => void
  statusBusy: boolean
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  // 草稿提在这层(见 MetaDraft):乐观保存立刻关表单,失败原样重开都不丢用户输入。
  const [draft, setDraft] = useState<MetaDraft | null>(null)
  // 详情 / 评论 分两个可滑动 Tab:评论接入 comment-pane(自带滚动/虚拟/无限)需独占一块滚动区。
  // embla 做横向滑动(鼠标拖拽 / 触摸),两 slide 始终挂载 → scroll-fade / 虚拟化器不因切换卸载而失效。
  const [tab, setTab] = useState<'detail' | 'comments'>('detail')
  const [emblaRef, emblaApi] = useEmblaCarousel({ align: 'start' })
  const options = useProjectOptions(visible && editing)
  const saveMeta = useSaveProjectMeta()
  const saveVisibility = useSaveProjectVisibility()
  const saveAssignee = useSaveProjectAssignee()
  const viewportRef = useRef<HTMLDivElement>(null)
  useScrollFade(viewportRef, 'vertical') // 详情上下阴影,与列表同一套
  const d = project?.detail

  // 换项目时退出编辑态,免得把 A 的草稿套在 B 上
  const id = project?.id
  useEffect(() => {
    setEditing(false)
    setTab('detail')
    emblaApi?.scrollTo(0, true) // 换项目回到「详情」slide,不停在上个项目的评论页
  }, [id, emblaApi])

  // embla ↔ Tab 双向同步:滑动落位改高亮;点 Tab 触发滑动(见 onValueChange)
  useEffect(() => {
    if (!emblaApi) return
    const onSelect = () => setTab(emblaApi.selectedScrollSnap() === 1 ? 'comments' : 'detail')
    emblaApi.on('select', onSelect)
    emblaApi.on('reInit', onSelect)
    onSelect()
    return () => {
      emblaApi.off('select', onSelect)
      emblaApi.off('reInit', onSelect)
    }
  }, [emblaApi])

  // 滑动激活线:拖动时按 embla 进度实时插值(跟手),hover 时滑到悬停 tab,松手/移开滑回激活项。
  // 自测 offsetLeft/Width 而非 base-ui Indicator —— 后者只跟随激活值,给不了「跟手 + hover」。
  const tabsListRef = useRef<HTMLDivElement>(null)
  const underlineRef = useRef<HTMLSpanElement>(null)
  const tabRefs = useRef<Array<HTMLElement | null>>([])
  const hoverRef = useRef<number | null>(null)
  const placeUnderline = useCallback(
    (animate: boolean) => {
      const el = underlineRef.current
      const a = tabRefs.current[0]
      const b = tabRefs.current[1]
      if (!el || !a || !b) return
      // 跟手时去掉过渡(逐帧直接设位);hover / 松手时保留过渡让它滑过去
      el.style.transition = animate ? '' : 'none'
      const hovered = hoverRef.current != null ? tabRefs.current[hoverRef.current] : null
      let left: number
      let width: number
      if (hovered) {
        left = hovered.offsetLeft
        width = hovered.offsetWidth
      } else {
        const raw = emblaApi ? emblaApi.scrollProgress() : 0
        const p = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0
        left = a.offsetLeft + (b.offsetLeft - a.offsetLeft) * p
        width = a.offsetWidth + (b.offsetWidth - a.offsetWidth) * p
      }
      el.style.transform = `translateX(${left}px)`
      el.style.width = `${width}px`
    },
    [emblaApi],
  )
  const hoverTab = (i: number | null) => {
    hoverRef.current = i
    placeUnderline(true)
  }
  useLayoutEffect(() => {
    placeUnderline(false)
    const ro = new ResizeObserver(() => placeUnderline(hoverRef.current != null))
    if (tabsListRef.current) ro.observe(tabsListRef.current)
    if (!emblaApi) return () => ro.disconnect()
    // 拖动 + 吸附全程逐帧跟随;但悬停时以 hover 为准 —— 否则 scroll/reInit(含评论 pane 高度变化触发的
    // 重排)会把线从悬停位「无过渡」拽回进度位,和 hover 目标反复打架 = 闪烁。
    const onScroll = () => {
      if (hoverRef.current == null) placeUnderline(false)
    }
    emblaApi.on('scroll', onScroll)
    emblaApi.on('reInit', onScroll)
    return () => {
      ro.disconnect()
      emblaApi.off('scroll', onScroll)
      emblaApi.off('reInit', onScroll)
    }
  }, [emblaApi, placeUnderline])

  // 地址两行:街道(address + address2)/ 城市州邮编 —— 与 BFF title() 的拼法同源
  const street = d ? [d.address, d.address2].filter(Boolean).join(' ') : ''
  const locality = d ? [[d.city, d.state].filter(Boolean).join(', '), d.postalCode].filter(Boolean).join(' ') : ''

  return (
    <PanelBody>
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <Info className="size-4" />
        <span className="flex-1 truncate text-sm font-medium">{t('projectNav.details')}</span>
        {d && !editing ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              onClick={() => {
                setDraft(detailToDraft(d))
                setEditing(true)
                emblaApi?.scrollTo(0) // 编辑表单在「详情」slide,正停在评论页则滑回去
              }}
            >
              <Pencil className="size-3.5" /> {t('common.edit')}
            </Button>
          </>
        ) : null}
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={onBack}>
          <ChevronLeft className="size-3.5" /> {t('projectNav.list')}
        </Button>
      </div>
      <Tabs
        value={tab}
        onValueChange={(v) => emblaApi?.scrollTo(v === 'comments' ? 1 : 0)}
        className="min-h-0 flex-1"
      >
        <TabsList
          ref={tabsListRef}
          variant="line"
          className="mx-3 mt-1.5 shrink-0 justify-start"
          onMouseLeave={() => hoverTab(null)}
        >
          <TabsTrigger
            value="detail"
            ref={(el) => {
              tabRefs.current[0] = el
            }}
            onMouseEnter={() => hoverTab(0)}
          >
            {t('projectNav.details')}
          </TabsTrigger>
          <TabsTrigger
            value="comments"
            ref={(el) => {
              tabRefs.current[1] = el
            }}
            onMouseEnter={() => hoverTab(1)}
          >
            {t('projectNav.comments')}{d?.commentCount ? ` (${d.commentCount})` : ''}
          </TabsTrigger>
          <span
            ref={underlineRef}
            aria-hidden
            className="pointer-events-none absolute bottom-0 left-0 z-0 h-0.5 w-0 rounded-full bg-foreground transition-[transform,width] duration-200 ease-out"
          />
        </TabsList>
        {/* embla 横向滑动切 Tab:两 slide 始终挂载(scroll-fade / 虚拟化器不因切换卸载而失效) */}
        <div ref={emblaRef} className="min-h-0 flex-1 overflow-hidden">
          <div className="flex h-full">
            <div className="flex min-w-0 flex-[0_0_100%] flex-col">
              <ScrollArea viewportRef={viewportRef} className="min-h-0 flex-1">
                <div className="p-3">
                  {loading || !project || !d ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" /> {t('common.loading')}
                    </div>
                  ) : editing && draft ? (
                    <MetaForm
                      value={draft}
                      onChange={setDraft}
                      options={options.data}
                      optionsLoading={options.isPending}
                      onCancel={() => setEditing(false)}
                      // 乐观:立刻关表单(onMutate 已把草稿值 patch 进 detail 缓存,只读视图即时显示);
                      // 失败时 onError 重开表单 —— 草稿提在本层没丢,原样恢复让用户改了重试。
                      onSave={() => {
                        setEditing(false)
                        const meta = draftToMeta(draft)
                        saveMeta.mutate({ id: project.id, meta }, { onError: () => setEditing(true) })
                        // 价格/床浴等改了 → 若横幅开着就重烘焙其文案(仅限编辑器已加载本项目时)
                        if (editorProjectRef.id === project.id) refreshBannerText(meta as ListingMeta)
                      }}
                    />
                  ) : (
                    <div className="flex flex-col gap-4">
                      {/* 概要:缩略图 + 标题 + 状态菜单(与列表卡片同一个 FSM 菜单) */}
                      <div className="flex gap-3">
                        <Thumb url={d.thumbnailUrl ?? null} kind={d.thumbnailKind ?? null} className="size-16" />
                        <div className="flex min-w-0 flex-1 flex-col items-start gap-1.5">
                          <div className="line-clamp-2 text-sm font-semibold" title={project.name}>
                            {project.name}
                          </div>
                          <ProjectStatusMenu
                            status={d.status}
                            busy={statusBusy}
                            onAction={(action) => onChangeStatus(project.id, action)}
                          />
                          {d.statusUpdatedBy ? (
                            <span className="text-[11px] text-muted-foreground">{t('projectNav.changedBy', { by: d.statusUpdatedBy })}</span>
                          ) : null}
                          {/* 被拒时直达 xchangeai 评审页看驳回意见 —— 否则只能自己去后台翻 */}
                          {d.reviewUrl ? (
                            <a
                              href={d.reviewUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                            >
                              {t('projectNav.viewRejection')} <ExternalLink className="size-3" />
                            </a>
                          ) : null}
                        </div>
                      </div>

                      {/* 统计:对齐 TopBar 的 "N photos · N clips · duration",再补评论/转发/可见性 */}
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <ImageIcon className="size-3" /> {d.resourceCount} resources
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Clapperboard className="size-3" /> {d.clipCount} clips
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Clock className="size-3" /> {duration(d.durationSeconds)}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <MessageSquare className="size-3" /> {d.commentCount} comments
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Share2 className="size-3" /> {d.forwardCount} forwards
                        </span>
                        <VisibilityMenu
                          visibility={d.visibility ?? null}
                          busy={saveVisibility.isPending}
                          onChange={(visibility) => saveVisibility.mutate({ id: project.id, visibility })}
                        />
                      </div>

                      <Separator />

                      <Group title="Listing">
                        <Field label="List price" value={usd(d.price)} />
                        <Field label="Address" value={street} />
                        <Field label="City / State" value={locality} />
                        <Field label="Property type" value={d.propertyType} />
                        <Field label="Video style" value={d.videoStyle} />
                        <Field
                          label="Listing URL"
                          value={
                            d.listingUrl ? (
                              <a
                                href={d.listingUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex max-w-full items-center gap-1 truncate underline underline-offset-2 hover:text-foreground"
                              >
                                <span className="truncate">{d.listingUrl}</span>
                                <ExternalLink className="size-3 shrink-0" />
                              </a>
                            ) : null
                          }
                        />
                      </Group>

                      <div className="grid grid-cols-3 gap-2">
                        <Metric label="Beds" value={d.bedrooms} />
                        <Metric label="Baths" value={d.bathrooms} />
                        <Metric label="Sqft" value={d.livingAreaSqft?.toLocaleString()} />
                      </div>

                      <Separator />

                      <VideoOverlaysSection project={project} />

                      <Separator />

                      <Group title="People">
                        <Field label="Agency" value={d.agency} />
                        <Field label="Agent" value={d.agent} />
                        {/* 就地认领/取消指派:改一个人不必为此进整张编辑表单(那是 15 个字段的全量替换)。
                            认领只在 prepared 态给 —— 上游 assignProjectToSelf 别的状态一律 409,
                            与其让人点了撞错,不如不给按钮(legacy 的状态菜单也只在 prepared 提供 Claim)。
                            取消指派没有状态约束,任何时候都能撤。 */}
                        <Field
                          label="Assigned creator"
                          value={
                            <span className="inline-flex items-center gap-1.5">
                              {d.assignee}
                              {d.assignee || d.status === 'prepared' ? (
                                <button
                                  type="button"
                                  disabled={saveAssignee.isPending}
                                  onClick={() =>
                                    saveAssignee.mutate({ id: project.id, assigneeId: d.assignee ? null : 'me' })
                                  }
                                  className="text-primary hover:underline disabled:opacity-50"
                                >
                                  {saveAssignee.isPending ? '…' : d.assignee ? t('projectNav.unassign') : t('projectNav.claim')}
                                </button>
                              ) : null}
                            </span>
                          }
                        />
                        <Field label="Created by" value={d.createdBy} />
                      </Group>

                      {d.assets && d.assets.length > 0 ? (
                        <>
                          <Separator />
                          <AssetGrid projectId={project.id} assets={d.assets} />
                        </>
                      ) : null}

                      <Separator />

                      <Group title="Timestamps">
                        <Field label="Created" value={absTime(d.createdAt)} />
                        <Field label="Updated" value={`${absTime(d.updatedAt)} (${relTime(d.updatedAt)})`} />
                      </Group>

                      {/* 只有发布过的项目才有观看数据,没发布的连请求都不发 */}
                      {PUBLISHED_STATUSES.has(d.status) ? (
                        <>
                          <Separator />
                          <AnalyticsPanel projectId={project.id} enabled={visible} />
                        </>
                      ) : null}
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
            <div className="flex min-w-0 flex-[0_0_100%] flex-col p-3">
              {/* enabled 跟面板可见即拉 → 首次滑到评论已在底、无加载闪;非激活 slide 也常驻不卸载 */}
              {project && d ? (
                <CommentPane
                  entity="project"
                  id={project.id}
                  total={d.commentCount ?? 0}
                  enabled={visible}
                  className="flex min-h-0 flex-1 flex-col"
                />
              ) : (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> {t('common.loading')}
                </div>
              )}
            </div>
          </div>
        </div>
      </Tabs>
    </PanelBody>
  )
}
