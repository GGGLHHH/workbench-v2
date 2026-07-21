import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useVirtualizer } from '@tanstack/react-virtual'
import useEmblaCarousel from 'embla-carousel-react'
import { useLocalStorageState } from 'ahooks'
import { format, formatDistanceToNow } from 'date-fns'
import { useTranslation } from 'react-i18next'
import {
  Building2,
  ChevronDown,
  ChevronLeft,
  Clapperboard,
  Clock,
  CloudDownload,
  ExternalLink,
  Eye,
  FolderClosed,
  Image as ImageIcon,
  Info,
  Loader2,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Share2,
  ThumbsDown,
  ThumbsUp,
  User,
} from 'lucide-react'

import type { BffProject, BffProjectDetail, BffProjectMetaRequest, BffProjectOptions } from '@/generated/api-types'
// 类型引用,verbatimModuleSyntax 下会被完全擦除 → 与路由不构成运行时循环依赖
import type { ProjectSearch } from '@/routes/index'

import {
  PROJECTS_PAGE_SIZE,
  useChangeProjectStatus,
  useProject,
  useProjectAnalytics,
  useProjectOptions,
  useProjectPages,
  useProjectStats,
  useSaveAssetTags,
  useSaveProjectAssignee,
  useSaveProjectMeta,
  useSaveProjectVisibility,
} from '@/api/projects/projects'
import { toast } from 'sonner'
import { addProjectAssetToEditor } from '@/lib/add-to-editor'
import { AssetViewer } from '@/components/asset-viewer'
import { LanguageToggle } from '@/components/language-toggle'
import { useMediaLightbox } from '@/components/media-lightbox'
import { CommentPane } from '@/components/comment-pane'
import type { ProjectListParams } from '@/lib/query-keys'
import { cn } from '@/lib/utils'
import { useScrollFade } from '@/lib/use-scroll-fade'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SearchInput } from '@/components/form/search-input'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'

// 手写双层侧边栏(互斥展开):第一层=项目列表(对齐 xchangeai-workbench 卡片:缩略图 +
// 负责人/机构 + resources/clips/时长 + 状态徽章 + 更新时间;搜索 + 状态筛选 tab + 计数 +
// 下拉分页),第二层=项目详情(后续再细化)。展开一个 → 另一个收成窄图标 rail。

type Panel = 'list' | 'detail'
type ProjectSummary = {
  id: string
  title: string
  assignee: string | null
  agency: string | null
  status: string
  resourceCount: number
  clipCount: number
  durationSeconds: number
  thumbnailUrl: string | null
  thumbnailKind: string | null
  updatedAt: string
}

const STATUS_TABS = [
  { id: '', label: 'All' },
  { id: 'created', label: 'Created' },
  { id: 'prepared', label: 'Prepared' },
  { id: 'assigned', label: 'Assigned' },
  { id: 'in_progress', label: 'In Process' },
  { id: 'generated', label: 'Generated' },
  { id: 'ready_for_review', label: 'Ready' },
  { id: 'reviewing', label: 'Reviewing' },
  { id: 'approved', label: 'Approved' },
  { id: 'published', label: 'Published' },
  { id: 'rejected', label: 'Rejected' },
]

// 状态徽章配色(暗色适配自 xchangeai-workbench 的浅色语义:assigned=蓝 / approved=绿 …)
const STATUS_STYLE: Record<string, string> = {
  created: 'bg-zinc-500/15 text-zinc-300',
  prepared: 'bg-slate-500/15 text-slate-300',
  assigned: 'bg-blue-500/15 text-blue-400',
  in_progress: 'bg-indigo-500/15 text-indigo-400',
  generated: 'bg-violet-500/15 text-violet-400',
  ready_for_review: 'bg-amber-500/15 text-amber-400',
  reviewing: 'bg-sky-500/15 text-sky-400',
  approved: 'bg-emerald-500/15 text-emerald-400',
  published: 'bg-teal-500/15 text-teal-400',
  rejected: 'bg-red-500/15 text-red-400',
}

// 每个状态可执行的 FSM 动作(对齐 xchangeai-workbench projectStatus.js;后端再校验合法性)。
// tone=primary 是该状态下的主推动作;confirm 有值的动作点第一次只把菜单项文案换成问句,
// 再点一次才真发 —— 与 legacy 一致,也比 window.confirm 好:不夺焦点、不阻塞其余菜单项。
type StatusAction = { action: string; label: string; primary?: boolean; confirm?: string }
const STATUS_ACTIONS: Record<string, StatusAction[]> = {
  created: [
    { action: 'start_work', label: 'Start work', primary: true },
    { action: 'prepare', label: 'Prepare project' },
  ],
  prepared: [
    { action: 'start_work', label: 'Start work', primary: true },
    { action: 'assign', label: 'Claim project' },
    { action: 'revert', label: 'Revert to created' },
  ],
  assigned: [
    { action: 'start_work', label: 'Start work', primary: true },
    { action: 'revert', label: 'Revert to prepared' },
  ],
  in_progress: [
    { action: 'generate', label: 'Generate', primary: true },
    { action: 'fail', label: 'Mark generation failed', confirm: 'Mark this project generation as failed?' },
    { action: 'revert', label: 'Revert to assigned' },
  ],
  generated: [
    { action: 'submit_review', label: 'Submit for review', primary: true },
    { action: 'revert', label: 'Revert to in progress' },
  ],
  ready_for_review: [
    { action: 'start_review', label: 'Start review', primary: true },
    { action: 'revert', label: 'Revert to generated' },
  ],
  reviewing: [
    { action: 'approve', label: 'Approve', primary: true },
    { action: 'reject', label: 'Reject', confirm: 'Reject this project and send it back?' },
    { action: 'revert', label: 'Revert to ready for review' },
  ],
  approved: [
    { action: 'publish', label: 'Publish', primary: true },
    { action: 'revert', label: 'Revert to reviewing' },
  ],
  rejected: [{ action: 'reassign', label: 'Send back to creator', primary: true }],
  published: [{ action: 'revert', label: 'Revert to approved' }],
}

const statusLabel = (status: string) => status.replaceAll('_', ' ')

const duration = (seconds: number) => {
  const s = Math.max(0, seconds || 0)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.round(s % 60)).padStart(2, '0')}`
}

// 相对时间(date-fns),如 "5 minutes ago" / "2 days ago"
const relTime = (iso: string) => {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true })
  } catch {
    return iso
  }
}

// 绝对时间。workbench 只有相对时间("Updated 3d ago"),详情面板补上准确时刻。
const absTime = (iso: string) => {
  try {
    return format(new Date(iso), 'yyyy-MM-dd HH:mm')
  } catch {
    return iso
  }
}

// 价格:对齐 xchangeai-workbench 服务端 formatPrice(Intl USD、无小数)
const usd = (n: number | null | undefined) =>
  typeof n === 'number'
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
    : null

// 排序选项。只留服务端支持的两个时间字段(xchangeai 的 SortBy 枚举就只有 created_at /
// updated_at)。按名字排已移除:它原先是在"已加载的那部分"上排,滚出去的部分不参与,
// 本就半残;改成按页随机访问后更没有意义 —— 排序必须整份数据在服务端做。
const SORT_OPTIONS = [
  { value: 'created_desc', label: 'Recently created' },
  { value: 'updated_desc', label: 'Recently updated' },
]

/** 供路由 validateSearch 校验 URL 上的 sort —— 脏值会让 Select 显示空白 */
export const SORT_VALUES = SORT_OPTIONS.map((o) => o.value)

// 卡片定高:缩略图 56 + 两行元信息 + 底栏 = 115,行间距 8。
// 标题是 truncate 不换行、面板定宽,实测 70 行全是 115,故按定高处理。
const ROW_HEIGHT = 115
const ROW_GAP = 8

// 视口顶部那一条 + 视口切在它内部的像素偏移。存这个而不是 scrollTop:
// scrollTop 依赖"上方所有行的真实高度",行高一被实测修正它就失真。
type Anchor = { index: number; offsetInItem: number }

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
  const status = params.status ?? ''
  const sort = params.sort ?? 'created_desc'

  // 改筛选用 replace:搜索框每 300ms 防抖发一次,push 会把历史记录塞满。
  // 选项目用 push:后退键回到上一个看的项目(见 AskUserQuestion 里选的那条)。
  const setFilter = useCallback(
    (patch: ProjectSearch) => void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true }),
    [navigate],
  )
  // 这三个一路传到 memo 化的 ListHeader,必须稳定
  const onSearch = useCallback((v: string) => setFilter({ search: v || undefined }), [setFilter])
  const onStatusChange = useCallback((v: string) => setFilter({ status: v || undefined }), [setFilter])
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

  // 列表数据由 ListContent 自己按可见区间取(虚拟化 → 随机访问),这里只留 stats 供 tab 计数。
  const params2 = useMemo(() => ({ search, status, sort }), [search, status, sort])
  const stats = useProjectStats()
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
            statsTotal={stats.data?.total}
            statusCounts={stats.data?.statusCounts ?? {}}
            search={search}
            onSearch={onSearch}
            status={status}
            onStatusChange={onStatusChange}
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

// 对齐 shadcn 官方 sidebar 的动画结构。要点(以前的写法三条全踩反了):
//  1. 不做条件渲染 —— 面板与 rail 始终挂载,靠 CSS 交叉淡入。以前是 `expanded ? panel : rail`,
//     点击瞬间内容就换掉了,而宽度还要慢慢动 300ms,于是「内容已变、容器还在爬」= 跳变。
//  2. 两层各自保持固有宽度并绝对定位 —— 收缩时内容被 overflow 裁掉,而不是被挤扁回流
//     (文字换行/元素重排在动画中途最显脏)。
//  3. duration-200 ease-linear —— 官方用线性;宽度动画配 ease-in-out 会显得黏。
function Section({
  expanded,
  bordered,
  panel,
  rail,
}: {
  expanded: boolean
  bordered?: boolean
  panel: React.ReactNode
  rail: React.ReactNode
}) {
  return (
    <section
      data-state={expanded ? 'expanded' : 'collapsed'}
      className={cn(
        'relative shrink-0 overflow-hidden transition-[width] duration-200 ease-linear',
        bordered && 'border-r',
        expanded ? 'w-(--panel-w)' : 'w-(--panel-w-icon)',
      )}
    >
      <Layer show={expanded} className="w-(--panel-w)">
        {panel}
      </Layer>
      <Layer show={!expanded} className="w-(--panel-w-icon)">
        {rail}
      </Layer>
    </section>
  )
}

// 隐藏层用 inert 彻底移出交互与无障碍树(React 19 支持布尔 inert),
// 否则「看不见但能 Tab 到」——这是叠层方案最容易漏的坑。
function Layer({
  show,
  className,
  children,
}: {
  show: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      inert={!show}
      aria-hidden={!show}
      className={cn(
        'absolute inset-y-0 left-0 flex flex-col transition-opacity duration-200 ease-linear',
        show ? 'opacity-100' : 'pointer-events-none opacity-0',
        className,
      )}
    >
      {children}
    </div>
  )
}

// 收起/展开整个侧边栏的开关。收起态由它还原到 active 那一栏。
function CollapseToggle({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { t } = useTranslation()
  const label = collapsed ? t('projectNav.expandSidebar') : t('projectNav.collapseSidebar')
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-7"
      onClick={onToggle}
      title={label}
      aria-label={label}
      aria-expanded={!collapsed}
    >
      {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
    </Button>
  )
}

// topAction 固定在 rail 顶部(高度对齐详情面板的 h-11 头部),其下才是「点开本栏」的区域
function Rail({
  icon,
  label,
  onExpand,
  disabled,
  topAction,
}: {
  icon: React.ReactNode
  label: string
  onExpand: () => void
  disabled?: boolean
  topAction?: React.ReactNode
}) {
  const { t } = useTranslation()
  return (
    <div className="flex h-full w-full flex-col items-center">
      {topAction ? <div className="flex h-11 shrink-0 items-center">{topAction}</div> : null}
      <button
        type="button"
        disabled={disabled}
        onClick={onExpand}
        className="flex w-full min-h-0 flex-1 flex-col items-center gap-3 py-3 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-40"
        aria-label={t('projectNav.expandPanel', { label })}
      >
        {icon}
        <span className="text-xs tracking-wider text-muted-foreground [writing-mode:vertical-rl]">
          {label}
        </span>
      </button>
    </div>
  )
}

// 宽度由外层 Layer 给(w-(--panel-w)),这里铺满即可 —— 内容不随容器收缩回流。
function PanelBody({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full w-full flex-col">{children}</div>
}

// 头部单独 memo:滚动时虚拟化器每帧都让 ListContent 重渲染,而搜索框、11 个状态 tab、
// 排序下拉这些跟滚动毫无关系 —— 不隔离的话它们每帧都跟着 diff 一遍。
const ListHeader = memo(function ListHeader({
  search,
  onSearch,
  status,
  onStatusChange,
  sort,
  onSortChange,
  statusCounts,
  allCount,
  syncing,
  onSync,
  onToggleCollapse,
  tabsViewportRef,
}: {
  search: string
  onSearch: (value: string) => void
  status: string
  onStatusChange: (value: string) => void
  sort: string
  onSortChange: (value: string) => void
  statusCounts: Record<string, number>
  allCount: number
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
            {STATUS_TABS.map((tab) => {
              const count = tab.id ? (statusCounts[tab.id] ?? 0) : allCount
              const isActive = status === tab.id
              return (
                <button
                  key={tab.id || 'all'}
                  type="button"
                  onClick={() => onStatusChange(tab.id)}
                  className={cn(
                    'flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs whitespace-nowrap transition-colors',
                    isActive
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                      : 'text-muted-foreground hover:bg-sidebar-accent/50',
                  )}
                >
                  <span>{tab.label}</span>
                  <span className={cn('tabular-nums', isActive && 'font-semibold')}>{count}</span>
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
  statsTotal,
  statusCounts,
  search,
  onSearch,
  status,
  onStatusChange,
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
  statsTotal?: number
  statusCounts: Record<string, number>
  search: string
  onSearch: (value: string) => void
  status: string
  onStatusChange: (value: string) => void
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
  const anchorKey = `nav.anchor:${params.search}|${params.status}|${params.sort}`
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
        status={status}
        onStatusChange={onStatusChange}
        sort={sort}
        onSortChange={onSortChange}
        statusCounts={statusCounts}
        allCount={statsTotal ?? total}
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

// 状态徽章 = 下拉:点击弹出当前状态可执行的 FSM 动作(对齐 xchangeai-workbench 的 ProjectStatusMenu)。
function ProjectStatusMenu({
  status,
  busy,
  onAction,
}: {
  status: string
  busy: boolean
  onAction: (action: string) => void
}) {
  const actions = STATUS_ACTIONS[status] ?? []
  // 待确认的动作。菜单关闭即清空 —— 下次打开必须从头再点一次,不留半截状态。
  const [pendingConfirm, setPendingConfirm] = useState<string | null>(null)
  const pill = cn(
    'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium capitalize',
    STATUS_STYLE[status] ?? 'bg-muted text-muted-foreground',
  )
  if (actions.length === 0) return <span className={pill}>{statusLabel(status)}</span>
  return (
    <DropdownMenu onOpenChange={(open) => !open && setPendingConfirm(null)}>
      <DropdownMenuTrigger disabled={busy} className={cn(pill, 'cursor-pointer outline-none disabled:opacity-60')}>
        {busy ? <Loader2 className="size-3 animate-spin" /> : null}
        {statusLabel(status)}
        <ChevronDown className="size-3 opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-44">
        {actions.map((a) => {
          const confirming = pendingConfirm === a.action
          return (
            <DropdownMenuItem
              key={a.action}
              // 第一次点危险动作只换文案,菜单要留着 → 阻止 Base UI 的默认关闭
              closeOnClick={!a.confirm || confirming}
              className={cn(
                'text-xs',
                a.confirm && 'text-destructive focus:text-destructive',
                confirming && 'font-medium',
                a.primary && 'font-medium text-foreground',
              )}
              onClick={() => {
                if (a.confirm && !confirming) {
                  setPendingConfirm(a.action)
                  return
                }
                setPendingConfirm(null)
                onAction(a.action)
              }}
            >
              {confirming ? a.confirm : a.label}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// 观看数据只在项目公开出去之后才产生 —— 其余状态连请求都不该发。
const PUBLISHED_STATUSES = new Set(['published'])

// 项目分析:浏览 / 独立访客 / 分享,各带环比。上游是 frontend 域的端点,workbench 用户不一定
// 有权限 → 失败静默不展示(retry:false),而不是在详情里挂一条红色错误。
function AnalyticsPanel({ projectId, enabled }: { projectId: string; enabled: boolean }) {
  const { t } = useTranslation()
  const { data, isPending, isError } = useProjectAnalytics(projectId, enabled)
  if (isError) return null
  return (
    <Group title="Audience">
      {isPending ? (
        <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> {t('common.loading')}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          <Metric label="Views" value={<Trend m={data.views} />} />
          <Metric label="Visitors" value={<Trend m={data.uniqueVisitors} />} />
          <Metric label="Shares" value={<Trend m={data.shares} />} />
        </div>
      )}
    </Group>
  )
}

// 值 + 环比。changePercent 为 null(上期为 0,涨幅无从谈起)时只显示值,不写 "+∞%"。
function Trend({ m }: { m: { value: number; changePercent?: number | null } }) {
  const c = m.changePercent
  return (
    <span className="inline-flex items-baseline gap-1">
      {m.value.toLocaleString()}
      {c != null && c !== 0 ? (
        <span className={cn('text-[10px]', c > 0 ? 'text-emerald-500' : 'text-red-500')}>
          {c > 0 ? '+' : ''}
          {Math.round(c)}%
        </span>
      ) : null}
    </span>
  )
}

// 可见性:与状态徽章同一套「药丸即菜单」的形态,免得详情面板里两种可改字段长得不一样。
// 三档取自上游 ProjectVisibility 枚举。
const VISIBILITY_OPTIONS = [
  { value: 'public', label: 'Public' },
  { value: 'agency', label: 'Agency' },
  { value: 'owner_private', label: 'Owner private' },
] as const

function VisibilityMenu({
  visibility,
  busy,
  onChange,
}: {
  visibility: string | null
  busy: boolean
  onChange: (v: 'public' | 'agency' | 'owner_private') => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={busy}
        className="inline-flex cursor-pointer items-center gap-1 rounded outline-none hover:text-foreground disabled:opacity-60"
      >
        {busy ? <Loader2 className="size-3 animate-spin" /> : <Eye className="size-3" />}
        {statusLabel(visibility || 'unknown')}
        <ChevronDown className="size-3 opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-36">
        {VISIBILITY_OPTIONS.map((o) => (
          <DropdownMenuItem
            key={o.value}
            className={cn('text-xs', o.value === visibility && 'font-medium text-foreground')}
            onClick={() => o.value !== visibility && onChange(o.value)}
          >
            {o.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// 缩略图(列表卡片 + 详情共用)。视频资产无图片海报 → 用 <video> 首帧(#t=0.1 避开黑帧)。
function Thumb({ url, kind, className }: { url: string | null; kind: string | null; className?: string }) {
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground',
        className,
      )}
    >
      {url ? (
        kind === 'video' ? (
          <video src={`${url}#t=0.1`} muted playsInline preload="metadata" className="size-full object-cover" />
        ) : (
          <img
            src={url}
            alt=""
            loading="lazy"
            className="size-full object-cover"
            onError={(event) => {
              event.currentTarget.style.display = 'none'
            }}
          />
        )
      ) : (
        <ImageIcon className="size-5" />
      )}
    </span>
  )
}

// memo:滚动时虚拟化器每帧都产出新数组,不 memo 的话这 20 张卡片(连同里面的
// <video preload="metadata">)每帧全部重新协调 —— 这是滚动卡顿的最后一块。
// 回调收 id 而不是闭包,否则每行每帧都是新函数,memo 直接失效。
const ProjectCard = memo(function ProjectCard({
  project,
  active,
  busy,
  onOpen,
  onChangeStatus,
}: {
  project: ProjectSummary
  active: boolean
  busy: boolean
  onOpen: (id: string) => void
  onChangeStatus: (id: string, action: string) => void
}) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border bg-card transition-colors',
        active ? 'border-primary ring-1 ring-primary/40' : 'hover:border-ring/40',
      )}
    >
      <button type="button" onClick={() => onOpen(project.id)} className="flex w-full gap-3 p-2.5 text-left">
        <Thumb url={project.thumbnailUrl} kind={project.thumbnailKind} className="size-14" />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate text-sm font-semibold" title={project.title}>
            {project.title}
          </span>
          <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span className="inline-flex min-w-0 items-center gap-1">
              <User className="size-3 shrink-0" /> <span className="truncate">{project.assignee || 'Unassigned'}</span>
            </span>
            <span className="inline-flex min-w-0 items-center gap-1">
              <Building2 className="size-3 shrink-0" /> <span className="truncate">{project.agency || 'No agency'}</span>
            </span>
          </span>
          <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <ImageIcon className="size-3" /> {project.resourceCount} resources
            </span>
            <span className="inline-flex items-center gap-1">
              <Clapperboard className="size-3" /> {project.clipCount} clips
            </span>
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3" /> {duration(project.durationSeconds)}
            </span>
          </span>
        </span>
      </button>
      <div className="flex items-center justify-between gap-2 border-t px-2.5 py-1.5">
        <ProjectStatusMenu
          status={project.status}
          busy={busy}
          onAction={(action) => onChangeStatus(project.id, action)}
        />
        <span className="text-xs text-muted-foreground">{relTime(project.updatedAt)}</span>
      </div>
    </div>
  )
})

// 分组标题 + 一列 label/value 行。value 为空显示 "—"(只读面板留占位比隐藏行更稳定,
// 不会因为数据缺失而让面板高度乱跳)。
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
      <dl className="flex flex-col gap-1">{children}</dl>
    </section>
  )
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right">{value || <span className="text-muted-foreground">—</span>}</dd>
    </div>
  )
}

// beds/baths/sqft 三格,对齐 workbench 的 .nle-three-fields
function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-0.5 rounded-md border py-2">
      <span className="text-sm font-semibold tabular-nums">{value ?? '—'}</span>
      <span className="text-[10px] tracking-wide text-muted-foreground uppercase">{label}</span>
    </div>
  )
}

// 资产缩略图网格。workbench 项目级没有这个网格(它把远端资产下载成本地照片再进图库),
// 这里 detail 已经带回 url,直接铺出来比只显示 "N resources" 有用得多。
// 审核双签(管理员 + 被指派创作者)折成一个角标:任一方驳回即红,双方通过才绿,其余待定不画。
// 待定不画是刻意的 —— 24rem 的面板里,给"还没发生的事"占像素不划算(legacy 用虚线圈,那是宽屏审核页)。
function ReviewBadge({ admin, assignee }: { admin: string | null; assignee: string | null }) {
  if (!admin && !assignee) return null
  const rejected = admin === 'rejected' || assignee === 'rejected'
  const approved = admin === 'approved' && assignee === 'approved'
  if (!rejected && !approved) return null
  const Icon = rejected ? ThumbsDown : ThumbsUp
  return (
    <span
      title={`admin: ${admin ?? '—'} · assignee: ${assignee ?? '—'}`}
      className={cn(
        'absolute bottom-0.5 left-0.5 inline-flex items-center rounded p-0.5 text-white',
        rejected ? 'bg-red-600/80' : 'bg-emerald-600/80',
      )}
    >
      <Icon className="size-2.5" />
    </span>
  )
}

// 瓦片点开是灯箱而非新标签页(对齐 legacy:点缩略图开 ImageLightbox,下载是灯箱里的动作)。
// 灯箱按扁平下标翻页,所以这里两组共用一份 assets 数组,只是分段渲染。
function AssetGrid({ projectId, assets }: { projectId: string; assets: NonNullable<BffProjectDetail['assets']> }) {
  const { t } = useTranslation()
  const groups = [
    { key: 'creator', label: 'Resources' },
    { key: 'agent', label: 'Clips' },
  ] as const
  const viewer = useMediaLightbox()
  const saveTags = useSaveAssetTags()
  const [adding, setAdding] = useState<string | null>(null)
  // 加入编辑器:探测尺寸 → 建素材 + 时间线条目落到右侧编辑器(见 add-to-editor)
  const handleAdd = async (a: NonNullable<BffProjectDetail['assets']>[number]) => {
    setAdding(a.id)
    try {
      await addProjectAssetToEditor({
        id: a.id,
        url: a.url,
        kind: a.kind,
        name: a.name,
        durationSeconds: a.durationSeconds,
        // contentId 是 BFF 新增字段,生成类型暂未含 → cast
        contentId: (a as { contentId?: string | null }).contentId,
      })
      toast.success(t('projectNav.addedToEditor', { name: a.name || t('projectNav.assetFallback') }))
    } catch {
      toast.error(t('projectNav.addToEditorFailed'))
    } finally {
      setAdding(null)
    }
  }
  return (
    <>
      {groups.map(({ key, label }) => {
        const list = assets.filter((a) => a.group === key)
        if (list.length === 0) return null
        return (
          <Group key={key} title={`${label} (${list.length})`}>
            <div className="grid grid-cols-4 gap-1.5">
              {list.map((a) => (
                <div key={a.id} className="group relative">
                  <button
                    type="button"
                    onClick={(e) => viewer.open(assets.indexOf(a), e)}
                    title={[a.name, a.tags?.map((t) => t.displayName || t.name).join(', ')].filter(Boolean).join(' · ') || undefined}
                    className="relative aspect-square w-full overflow-hidden rounded-md ring-offset-background hover:ring-2 hover:ring-ring focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {/* 有海报就贴海报 —— 一张图比让 20 个 <video> 各自拉 metadata 便宜得多 */}
                    <Thumb
                      url={a.thumbnailUrl || a.url}
                      kind={a.thumbnailUrl ? 'image' : a.kind}
                      className="size-full rounded-none"
                    />
                    <ReviewBadge admin={a.adminReview ?? null} assignee={a.assigneeReview ?? null} />
                    {a.commentCount > 0 ? (
                      <span className="absolute right-0.5 bottom-0.5 inline-flex items-center gap-0.5 rounded bg-black/70 px-1 text-[10px] text-white">
                        <MessageSquare className="size-2.5" />
                        {a.commentCount}
                      </span>
                    ) : null}
                  </button>
                  {/* hover 显现:加入右侧编辑器(独立按钮,与打开灯箱的瓦片同级,避免嵌套) */}
                  <button
                    type="button"
                    aria-label={t('projectNav.addToEditor')}
                    title={t('projectNav.addToEditor')}
                    disabled={adding === a.id}
                    onClick={(e) => {
                      e.stopPropagation()
                      void handleAdd(a)
                    }}
                    className="absolute top-1 left-1 inline-flex size-6 items-center justify-center rounded bg-black/60 text-white opacity-0 shadow transition-opacity group-hover:opacity-100 hover:bg-black/80 focus-visible:opacity-100 disabled:opacity-60"
                  >
                    {adding === a.id ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                  </button>
                </div>
              ))}
            </div>
          </Group>
        )
      })}
      <AssetViewer
        assets={assets}
        index={viewer.index}
        rect={viewer.rect}
        closing={viewer.closing}
        onIndexChange={viewer.onIndexChange}
        onClose={viewer.close}
        onTagsChange={(assetId, tags) => saveTags.mutate({ projectId, assetId, tags })}
      />
    </>
  )
}

// 表单一行。等价 workbench 的 .nle-control-group:label 直接包住控件,
// 天然关联、不用手配 htmlFor/id。
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Label className="flex flex-col items-stretch gap-1">
      <span className="text-xs font-normal text-muted-foreground">{label}</span>
      {children}
    </Label>
  )
}

const num = (v: string) => (v.trim() === '' ? null : Number(v))

// 编辑表单草稿(全字符串,贴合 <input>)。状态提在 DetailContent:乐观保存会立刻关表单,
// 失败要原样重开 —— 草稿若留在 MetaForm 内部,一卸载就没了。detail↔draft↔meta 两个纯转换。
type MetaDraft = {
  listingUrl: string
  address: string
  address2: string
  city: string
  state: string
  postalCode: string
  propertyType: string
  price: string
  videoStyle: string
  bedrooms: string
  bathrooms: string
  livingAreaSqft: string
  agencyId: string
  agentId: string
  assigneeId: string
}

const detailToDraft = (d: BffProjectDetail): MetaDraft => ({
  listingUrl: d.listingUrl ?? '',
  address: d.address ?? '',
  address2: d.address2 ?? '',
  city: d.city ?? '',
  state: d.state ?? '',
  postalCode: d.postalCode ?? '',
  propertyType: d.propertyType ?? '',
  price: d.price?.toString() ?? '',
  videoStyle: d.videoStyle ?? '',
  bedrooms: d.bedrooms?.toString() ?? '',
  bathrooms: d.bathrooms?.toString() ?? '',
  livingAreaSqft: d.livingAreaSqft?.toString() ?? '',
  agencyId: d.agencyId ?? '',
  agentId: d.agentId ?? '',
  assigneeId: d.assigneeId ?? '',
})

const draftToMeta = (v: MetaDraft): BffProjectMetaRequest => ({
  listingUrl: v.listingUrl.trim(),
  address: v.address.trim(),
  address2: v.address2.trim(),
  city: v.city.trim(),
  state: v.state.trim(),
  postalCode: v.postalCode.trim(),
  propertyType: v.propertyType.trim(),
  videoStyle: v.videoStyle.trim(),
  price: Number(v.price) || 0,
  bedrooms: num(v.bedrooms),
  bathrooms: num(v.bathrooms),
  livingAreaSqft: num(v.livingAreaSqft),
  agencyId: v.agencyId || null,
  agentId: v.agentId || null,
  assigneeId: v.assigneeId || null,
})

// 编辑表单:1:1 对齐 xchangeai-workbench 的 ProjectMetaPanel(字段、顺序、行分组、下拉、
// Cancel/Save details)。下游是 PUT 整体替换,所以表单持有全量值一起提交。
function MetaForm({
  value: v,
  onChange,
  options,
  optionsLoading,
  onCancel,
  onSave,
}: {
  value: MetaDraft
  onChange: (v: MetaDraft) => void
  options: BffProjectOptions | undefined
  optionsLoading: boolean
  onCancel: () => void
  onSave: () => void
}) {
  const set = (k: keyof MetaDraft) => (e: { target: { value: string } }) =>
    onChange({ ...v, [k]: e.target.value })

  const selects = [
    { key: 'agencyId', label: 'Agency', empty: 'No agency', items: options?.agencies },
    { key: 'agentId', label: 'Agent', empty: 'No agent', items: options?.agents },
    { key: 'assigneeId', label: 'Assigned creator', empty: 'Unassigned', items: options?.assignees },
  ] as const

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        onSave()
      }}
    >
      <Row label="Listing URL">
        <Input type="url" className="h-8" value={v.listingUrl} onChange={set('listingUrl')} />
      </Row>
      <Row label="Address">
        <Input className="h-8" value={v.address} onChange={set('address')} />
      </Row>
      <Row label="Address line 2">
        <Input className="h-8" value={v.address2} onChange={set('address2')} />
      </Row>
      <div className="grid grid-cols-2 gap-2">
        <Row label="City">
          <Input className="h-8" value={v.city} onChange={set('city')} />
        </Row>
        <Row label="State">
          <Input className="h-8" value={v.state} onChange={set('state')} />
        </Row>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Row label="Postal code">
          <Input className="h-8" value={v.postalCode} onChange={set('postalCode')} />
        </Row>
        <Row label="Property type">
          <Input className="h-8" value={v.propertyType} onChange={set('propertyType')} />
        </Row>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Row label="List price">
          <Input type="number" min="0" className="h-8" value={v.price} onChange={set('price')} />
        </Row>
        <Row label="Video style">
          <Input className="h-8" value={v.videoStyle} onChange={set('videoStyle')} />
        </Row>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Row label="Beds">
          <Input type="number" min="0" step="any" className="h-8" value={v.bedrooms} onChange={set('bedrooms')} />
        </Row>
        <Row label="Baths">
          <Input type="number" min="0" step="any" className="h-8" value={v.bathrooms} onChange={set('bathrooms')} />
        </Row>
        <Row label="Sqft">
          <Input
            type="number"
            min="0"
            className="h-8"
            value={v.livingAreaSqft}
            onChange={set('livingAreaSqft')}
          />
        </Row>
      </div>
      {selects.map((s) => (
        <Row key={s.key} label={s.label}>
          <NativeSelect className="h-8" disabled={optionsLoading} value={v[s.key]} onChange={set(s.key)}>
            <NativeSelectOption value="">{optionsLoading ? 'Loading…' : s.empty}</NativeSelectOption>
            {(s.items ?? []).map((o) => (
              <NativeSelectOption key={o.id} value={o.id}>
                {o.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Row>
      ))}
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" size="sm" className="h-8" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" className="h-8">
          Save details
        </Button>
      </div>
    </form>
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
                        saveMeta.mutate(
                          { id: project.id, meta: draftToMeta(draft) },
                          { onError: () => setEditing(true) },
                        )
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
