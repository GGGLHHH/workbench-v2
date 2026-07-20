import { useEffect, useMemo, useRef, useState } from 'react'
import { format, formatDistanceToNow } from 'date-fns'
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
  Share2,
  User,
} from 'lucide-react'

import type { BffProject, BffProjectDetail, BffProjectMetaRequest, BffProjectOptions } from '@/generated/api-types'

import {
  useChangeProjectStatus,
  useInfiniteProjects,
  useProject,
  useProjectOptions,
  useProjectStats,
  useSaveProjectMeta,
} from '@/api/projects/projects'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { AnimatedItem } from '@/components/AnimatedList'
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

// 每个状态可执行的 FSM 动作(对齐 xchangeai-workbench projectStatus.js;后端再校验合法性)
const STATUS_ACTIONS: Record<string, { action: string; label: string; danger?: boolean }[]> = {
  created: [
    { action: 'start_work', label: 'Start work' },
    { action: 'prepare', label: 'Prepare project' },
  ],
  prepared: [
    { action: 'start_work', label: 'Start work' },
    { action: 'assign', label: 'Claim project' },
    { action: 'revert', label: 'Revert to created' },
  ],
  assigned: [
    { action: 'start_work', label: 'Start work' },
    { action: 'revert', label: 'Revert to prepared' },
  ],
  in_progress: [
    { action: 'generate', label: 'Generate' },
    { action: 'fail', label: 'Mark generation failed', danger: true },
    { action: 'revert', label: 'Revert to assigned' },
  ],
  generated: [
    { action: 'submit_review', label: 'Submit for review' },
    { action: 'revert', label: 'Revert to in progress' },
  ],
  ready_for_review: [
    { action: 'start_review', label: 'Start review' },
    { action: 'revert', label: 'Revert to generated' },
  ],
  reviewing: [
    { action: 'approve', label: 'Approve' },
    { action: 'reject', label: 'Reject', danger: true },
    { action: 'revert', label: 'Revert to ready for review' },
  ],
  approved: [
    { action: 'publish', label: 'Publish' },
    { action: 'revert', label: 'Revert to reviewing' },
  ],
  rejected: [{ action: 'reassign', label: 'Send back to creator' }],
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

// 排序选项:created/updated 走服务端;name(A–Z/Z–A)由前端在已加载项上排
// (xchangeai 只支持时间字段服务端排序)。默认按创建时间倒序。
const SORT_OPTIONS = [
  { value: 'created_desc', label: 'Recently created' },
  { value: 'updated_desc', label: 'Recently updated' },
  { value: 'name_asc', label: 'Name (A–Z)' },
  { value: 'name_desc', label: 'Name (Z–A)' },
]

// scroll-fade:按滚动位置给视口加边缘渐隐 mask —— 只有该方向还有更多内容时才隐,
// 到边则不隐(纵向=上下,横向=左右)。用于列表上下阴影 + 状态 tab 左右阴影。
function useScrollFade(ref: React.RefObject<HTMLDivElement | null>, orientation: 'vertical' | 'horizontal') {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const FADE = 24
    const apply = () => {
      const start = orientation === 'vertical' ? el.scrollTop > 1 : el.scrollLeft > 1
      const end =
        orientation === 'vertical'
          ? el.scrollTop + el.clientHeight < el.scrollHeight - 1
          : el.scrollLeft + el.clientWidth < el.scrollWidth - 1
      const dir = orientation === 'vertical' ? 'to bottom' : 'to right'
      const mask = `linear-gradient(${dir}, ${start ? 'transparent' : '#000'}, #000 ${FADE}px, #000 calc(100% - ${FADE}px), ${end ? 'transparent' : '#000'})`
      el.style.setProperty('mask-image', mask)
      el.style.setProperty('-webkit-mask-image', mask)
    }
    apply()
    el.addEventListener('scroll', apply, { passive: true })
    // 视口尺寸不随内容变 —— 只观察 el,内容变高(切 view/edit、加载更多)时不会重算,
    // 遮罩就停在旧状态。连内容容器一起观察才盖得住。
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    return () => {
      el.removeEventListener('scroll', apply)
      ro.disconnect()
    }
  }, [ref, orientation])
}

export function ProjectNav() {
  // active = 哪一栏(该)展开;collapsed = 两栏同时收起。
  // 收起时刻意不动 active —— 它本身就是「收起前展开的是哪个」的记忆,还原直接读它,
  // 无需再存一份"记住谁展开过"(冗余状态迟早和 active 不同步)。
  const [active, setActive] = useState<Panel>('list')
  const [collapsed, setCollapsed] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [sort, setSort] = useState('created_desc')
  // name 排序前端做,服务端固定用时间序拉取(created/updated 二选一)
  const serverSort = sort.startsWith('name') ? 'created_desc' : sort

  const projects = useInfiniteProjects({ search, status, sort: serverSort })
  const stats = useProjectStats()
  const rawItems = (projects.data?.pages.flatMap((p) => p.items) ?? []) as ProjectSummary[]
  const items = useMemo(() => {
    if (sort === 'name_asc') return [...rawItems].sort((a, b) => a.title.localeCompare(b.title))
    if (sort === 'name_desc') return [...rawItems].sort((a, b) => b.title.localeCompare(a.title))
    return rawItems
  }, [rawItems, sort])

  const detail = useProject(selectedId)

  // 点 rail / 选项目 → 展开该栏(顺带解除整体收起)
  const openPanel = (panel: Panel) => {
    setActive(panel)
    setCollapsed(false)
  }

  const selectProject = (id: string) => {
    setSelectedId(id)
    openPanel('detail')
  }

  const listExpanded = !collapsed && active === 'list'
  const detailExpanded = !collapsed && active === 'detail'

  const refresh = () => {
    void projects.refetch()
    void stats.refetch()
  }

  const changeStatus = useChangeProjectStatus()

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
            label="项目"
            onExpand={() => openPanel('list')}
            topAction={<CollapseToggle collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />}
          />
        }
        panel={
          <ListContent
            visible={listExpanded}
            onToggleCollapse={() => setCollapsed(true)}
            items={items}
            total={stats.data?.total ?? projects.data?.pages[0]?.total ?? items.length}
            statusCounts={stats.data?.statusCounts ?? {}}
            loading={projects.isPending}
            error={projects.isError}
            hasNextPage={projects.hasNextPage}
            isFetchingNextPage={projects.isFetchingNextPage}
            fetchNextPage={() => void projects.fetchNextPage()}
            refreshing={projects.isRefetching}
            search={search}
            onSearch={setSearch}
            status={status}
            onStatusChange={setStatus}
            sort={sort}
            onSortChange={setSort}
            onRefresh={refresh}
            onChangeStatus={(id, action) => changeStatus.mutate({ id, action })}
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
            label="详情"
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
  const label = collapsed ? '展开侧边栏' : '收起侧边栏'
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
  return (
    <div className="flex h-full w-full flex-col items-center">
      {topAction ? <div className="flex h-11 shrink-0 items-center">{topAction}</div> : null}
      <button
        type="button"
        disabled={disabled}
        onClick={onExpand}
        className="flex w-full min-h-0 flex-1 flex-col items-center gap-3 py-3 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-40"
        aria-label={`展开${label}`}
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

function ListContent({
  items,
  total,
  statusCounts,
  loading,
  error,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  refreshing,
  search,
  onSearch,
  status,
  onStatusChange,
  sort,
  onSortChange,
  onRefresh,
  onChangeStatus,
  statusChangingId,
  selectedId,
  onSelect,
  onToggleCollapse,
  visible,
}: {
  items: ProjectSummary[]
  total: number
  statusCounts: Record<string, number>
  loading: boolean
  error: boolean
  hasNextPage: boolean
  isFetchingNextPage: boolean
  fetchNextPage: () => void
  refreshing: boolean
  search: string
  onSearch: (value: string) => void
  status: string
  onStatusChange: (value: string) => void
  sort: string
  onSortChange: (value: string) => void
  onRefresh: () => void
  onChangeStatus: (id: string, action: string) => void
  statusChangingId: string | null
  selectedId: string | null
  onSelect: (id: string) => void
  onToggleCollapse: () => void
  visible: boolean
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const tabsViewportRef = useRef<HTMLDivElement>(null)
  useScrollFade(viewportRef, 'vertical') // 列表上下阴影
  useScrollFade(tabsViewportRef, 'horizontal') // 状态 tab 左右阴影

  // 列表现在始终挂载(收起时只是 opacity-0),但 opacity-0 元素照样有布局、照样会命中
  // IntersectionObserver —— 不 gate 住就会在看不见的时候继续拉分页。
  useEffect(() => {
    const root = viewportRef.current
    const sentinel = sentinelRef.current
    if (!root || !sentinel || !hasNextPage || !visible) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isFetchingNextPage) fetchNextPage()
      },
      { root, rootMargin: '160px' },
    )
    io.observe(sentinel)
    return () => io.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, visible])

  return (
    <PanelBody>
      {/* 头部:标题 + 同步 + 搜索 + 状态筛选 tab */}
      <div className="flex flex-col gap-2 border-b p-2">
        <div className="flex items-center gap-2 px-1">
          {/* 与收起态 rail 顶部的 toggle 同一位置(最左),避免来回切时按钮跳位 */}
          <CollapseToggle collapsed={false} onToggle={onToggleCollapse} />
          <span className="flex-1 text-sm font-semibold">项目</span>
          <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" disabled={refreshing} onClick={onRefresh}>
            {refreshing ? <Loader2 className="size-3.5 animate-spin" /> : <CloudDownload className="size-3.5" />} 同步
          </Button>
        </div>
        <SearchInput
          value={search}
          onValueChange={onSearch}
          placeholder="搜索项目…"
          aria-label="搜索项目"
          inputClassName="h-8 text-sm"
        />
        {/* tab 条本来就有左右渐隐,再加一条横向滚动条只会挤掉半行高度 */}
        <ScrollArea viewportRef={tabsViewportRef} scrollbar="none" className="w-full">
          <div className="flex w-max gap-1">
            {STATUS_TABS.map((tab) => {
              const count = tab.id ? (statusCounts[tab.id] ?? 0) : total
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

      <ScrollArea viewportRef={viewportRef} className="min-h-0 flex-1">
        <div className="flex flex-col gap-2 p-2">
          {loading ? (
            <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> 加载中…
            </div>
          ) : error ? (
            <div className="p-3 text-sm text-destructive">加载失败</div>
          ) : items.length === 0 ? (
            <div className="p-3 text-sm text-muted-foreground">没有匹配的项目</div>
          ) : (
            <>
              {/* React Bits AnimatedItem:滚入视野时 scale/opacity 入场。
                  只取它的 item 层 —— 外层滚动容器与渐变由 ScrollArea + useScrollFade 负责,
                  排版交给父级 gap-2,所以 className 置空去掉它默认的 mb-4。 */}
              {items.map((p, i) => (
                <AnimatedItem key={p.id} index={i} delay={0.1} className="">
                  <ProjectCard
                    project={p}
                    active={selectedId === p.id}
                    busy={statusChangingId === p.id}
                    onOpen={() => onSelect(p.id)}
                    onChangeStatus={onChangeStatus}
                  />
                </AnimatedItem>
              ))}
              <div ref={sentinelRef} aria-hidden className="h-px" />
              {isFetchingNextPage ? (
                <div className="flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" /> 加载更多…
                </div>
              ) : null}
            </>
          )}
        </div>
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
  const pill = cn(
    'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium capitalize',
    STATUS_STYLE[status] ?? 'bg-muted text-muted-foreground',
  )
  if (actions.length === 0) return <span className={pill}>{statusLabel(status)}</span>
  return (
    <DropdownMenu>
      <DropdownMenuTrigger disabled={busy} className={cn(pill, 'cursor-pointer outline-none disabled:opacity-60')}>
        {busy ? <Loader2 className="size-3 animate-spin" /> : null}
        {statusLabel(status)}
        <ChevronDown className="size-3 opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-44">
        {actions.map((a) => (
          <DropdownMenuItem
            key={a.action}
            className={cn('text-xs', a.danger && 'text-destructive focus:text-destructive')}
            onClick={() => {
              if (a.danger && !window.confirm(`确定要「${a.label}」吗?`)) return
              onAction(a.action)
            }}
          >
            {a.label}
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

function ProjectCard({
  project,
  active,
  busy,
  onOpen,
  onChangeStatus,
}: {
  project: ProjectSummary
  active: boolean
  busy: boolean
  onOpen: () => void
  onChangeStatus: (id: string, action: string) => void
}) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border bg-card transition-colors',
        active ? 'border-primary ring-1 ring-primary/40' : 'hover:border-ring/40',
      )}
    >
      <button type="button" onClick={onOpen} className="flex w-full gap-3 p-2.5 text-left">
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
}

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
function AssetGrid({ assets }: { assets: NonNullable<BffProjectDetail['assets']> }) {
  const groups = [
    { key: 'creator', label: 'Resources' },
    { key: 'agent', label: 'Clips' },
  ] as const
  return (
    <>
      {groups.map(({ key, label }) => {
        const list = assets.filter((a) => a.group === key)
        if (list.length === 0) return null
        return (
          <Group key={key} title={`${label} (${list.length})`}>
            <div className="grid grid-cols-4 gap-1.5">
              {list.map((a) => (
                <a
                  key={a.id}
                  href={a.url}
                  target="_blank"
                  rel="noreferrer"
                  title={[a.name, a.tags?.join(', ')].filter(Boolean).join(' · ') || undefined}
                  className="relative aspect-square overflow-hidden rounded-md ring-offset-background hover:ring-2 hover:ring-ring focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Thumb url={a.url} kind={a.kind} className="size-full rounded-none" />
                  {a.commentCount > 0 ? (
                    <span className="absolute right-0.5 bottom-0.5 inline-flex items-center gap-0.5 rounded bg-black/70 px-1 text-[10px] text-white">
                      <MessageSquare className="size-2.5" />
                      {a.commentCount}
                    </span>
                  ) : null}
                </a>
              ))}
            </div>
          </Group>
        )
      })}
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

// 编辑表单:1:1 对齐 xchangeai-workbench 的 ProjectMetaPanel(字段、顺序、行分组、下拉、
// Cancel/Save details)。下游是 PUT 整体替换,所以表单持有全量值一起提交。
function MetaForm({
  detail,
  options,
  optionsLoading,
  saving,
  onCancel,
  onSave,
}: {
  detail: BffProjectDetail
  options: BffProjectOptions | undefined
  optionsLoading: boolean
  saving: boolean
  onCancel: () => void
  onSave: (meta: BffProjectMetaRequest) => void
}) {
  const [v, setV] = useState({
    listingUrl: detail.listingUrl ?? '',
    address: detail.address ?? '',
    address2: detail.address2 ?? '',
    city: detail.city ?? '',
    state: detail.state ?? '',
    postalCode: detail.postalCode ?? '',
    propertyType: detail.propertyType ?? '',
    price: detail.price?.toString() ?? '',
    videoStyle: detail.videoStyle ?? '',
    bedrooms: detail.bedrooms?.toString() ?? '',
    bathrooms: detail.bathrooms?.toString() ?? '',
    livingAreaSqft: detail.livingAreaSqft?.toString() ?? '',
    agencyId: detail.agencyId ?? '',
    agentId: detail.agentId ?? '',
    assigneeId: detail.assigneeId ?? '',
  })
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) =>
    setV((cur) => ({ ...cur, [k]: e.target.value }))

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
        if (saving) return
        onSave({
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
        <Button type="button" variant="ghost" size="sm" className="h-8" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" className="h-8 gap-1" disabled={saving}>
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : null} Save details
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
  const [editing, setEditing] = useState(false)
  const options = useProjectOptions(visible && editing)
  const saveMeta = useSaveProjectMeta()
  const viewportRef = useRef<HTMLDivElement>(null)
  useScrollFade(viewportRef, 'vertical') // 详情上下阴影,与列表同一套
  const d = project?.detail

  // 换项目时退出编辑态,免得把 A 的草稿套在 B 上
  const id = project?.id
  useEffect(() => {
    setEditing(false)
  }, [id])

  // 地址两行:街道(address + address2)/ 城市州邮编 —— 与 BFF title() 的拼法同源
  const street = d ? [d.address, d.address2].filter(Boolean).join(' ') : ''
  const locality = d ? [[d.city, d.state].filter(Boolean).join(', '), d.postalCode].filter(Boolean).join(' ') : ''

  return (
    <PanelBody>
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <Info className="size-4" />
        <span className="flex-1 truncate text-sm font-medium">详情</span>
        {d && !editing ? (
          <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => setEditing(true)}>
            <Pencil className="size-3.5" /> 编辑
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={onBack}>
          <ChevronLeft className="size-3.5" /> 列表
        </Button>
      </div>
      <ScrollArea viewportRef={viewportRef} className="min-h-0 flex-1">
        <div className="p-3">
          {loading || !project || !d ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> 加载中…
            </div>
          ) : editing ? (
            <MetaForm
              key={project.id}
              detail={d}
              options={options.data}
              optionsLoading={options.isPending}
              saving={saveMeta.isPending}
              onCancel={() => setEditing(false)}
              onSave={(meta) =>
                saveMeta.mutate({ id: project.id, meta }, { onSuccess: () => setEditing(false) })
              }
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
                <span className="inline-flex items-center gap-1">
                  <Eye className="size-3" /> {statusLabel(d.visibility || 'unknown')}
                </span>
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
                <Field label="Assigned creator" value={d.assignee} />
                <Field label="Created by" value={d.createdBy} />
              </Group>

              {d.assets && d.assets.length > 0 ? (
                <>
                  <Separator />
                  <AssetGrid assets={d.assets} />
                </>
              ) : null}

              <Separator />

              <Group title="Timestamps">
                <Field label="Created" value={absTime(d.createdAt)} />
                <Field label="Updated" value={`${absTime(d.updatedAt)} (${relTime(d.updatedAt)})`} />
              </Group>
            </div>
          )}
        </div>
      </ScrollArea>
    </PanelBody>
  )
}
