import { useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { toast } from 'sonner'
import {
  Building2,
  ChevronDown,
  ChevronLeft,
  Clapperboard,
  Clock,
  CloudDownload,
  FolderClosed,
  Image as ImageIcon,
  Info,
  Loader2,
  User,
} from 'lucide-react'

import { changeBffProjectStatus, getBffProject, getBffProjectStats, listBffProjects } from '@/generated/client'
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
import { SearchInput } from '@/components/form/search-input'

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

const PAGE_SIZE = 20

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
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', apply)
      ro.disconnect()
    }
  }, [ref, orientation])
}

export function ProjectNav() {
  const [active, setActive] = useState<Panel>('list')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [sort, setSort] = useState('created_desc')
  // name 排序前端做,服务端固定用时间序拉取(created/updated 二选一)
  const serverSort = sort.startsWith('name') ? 'created_desc' : sort

  const projects = useInfiniteQuery({
    queryKey: ['bff', 'projects', { search, status, sort: serverSort }],
    queryFn: ({ pageParam }) =>
      listBffProjects({
        query: {
          limit: PAGE_SIZE,
          offset: pageParam,
          search: search || undefined,
          status: status || undefined,
          sort: serverSort,
        },
      }),
    initialPageParam: 0,
    getNextPageParam: (last) => {
      const loaded = last.offset + last.items.length
      return loaded < last.total ? loaded : undefined
    },
  })
  const stats = useQuery({ queryKey: ['bff', 'projects', 'stats'], queryFn: () => getBffProjectStats({}) })
  const rawItems = (projects.data?.pages.flatMap((p) => p.items) ?? []) as ProjectSummary[]
  const items = useMemo(() => {
    if (sort === 'name_asc') return [...rawItems].sort((a, b) => a.title.localeCompare(b.title))
    if (sort === 'name_desc') return [...rawItems].sort((a, b) => b.title.localeCompare(a.title))
    return rawItems
  }, [rawItems, sort])

  const detail = useQuery({
    queryKey: ['bff', 'project', selectedId],
    queryFn: () => getBffProject({ path: { id: selectedId! } }),
    enabled: Boolean(selectedId),
  })

  const selectProject = (id: string) => {
    setSelectedId(id)
    setActive('detail')
  }

  const refresh = () => {
    void projects.refetch()
    void stats.refetch()
  }

  const queryClient = useQueryClient()
  const changeStatus = useMutation({
    mutationFn: (vars: { id: string; action: string }) =>
      changeBffProjectStatus({ path: { id: vars.id }, body: { action: vars.action } }),
    onSuccess: () => {
      // 失效 list + stats(前缀匹配)→ 状态与计数刷新
      void queryClient.invalidateQueries({ queryKey: ['bff', 'projects'] })
    },
    onError: (error: Error) => toast.error(error.message || '状态变更失败'),
  })

  return (
    <div className="flex h-full shrink-0 border-r bg-sidebar text-sidebar-foreground">
      <Section expanded={active === 'list'} bordered>
        {active === 'list' ? (
          <ListContent
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
        ) : (
          <Rail icon={<FolderClosed className="size-4" />} label="项目" onExpand={() => setActive('list')} />
        )}
      </Section>

      <Section expanded={active === 'detail'}>
        {active === 'detail' ? (
          <DetailContent
            loading={detail.isPending && Boolean(selectedId)}
            project={detail.data}
            onBack={() => setActive('list')}
          />
        ) : (
          <Rail
            icon={<Info className="size-4" />}
            label="详情"
            disabled={!selectedId}
            onExpand={() => selectedId && setActive('detail')}
          />
        )}
      </Section>
    </div>
  )
}

function Section({ expanded, bordered, children }: { expanded: boolean; bordered?: boolean; children: React.ReactNode }) {
  return (
    <section
      className={cn(
        'flex shrink-0 flex-col overflow-hidden transition-[width] duration-300 ease-in-out',
        bordered && 'border-r',
        expanded ? 'w-96' : 'w-12',
      )}
    >
      {children}
    </section>
  )
}

function Rail({ icon, label, onExpand, disabled }: { icon: React.ReactNode; label: string; onExpand: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onExpand}
      className="flex h-full w-full flex-col items-center gap-3 py-3 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-40"
      aria-label={`展开${label}`}
    >
      {icon}
      <span className="text-xs tracking-wider text-muted-foreground [writing-mode:vertical-rl]">{label}</span>
    </button>
  )
}

// 展开态内容固定 w-96,避免动画期间随容器宽度回流。
function PanelBody({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full w-96 flex-col">{children}</div>
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
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const tabsViewportRef = useRef<HTMLDivElement>(null)
  useScrollFade(viewportRef, 'vertical') // 列表上下阴影
  useScrollFade(tabsViewportRef, 'horizontal') // 状态 tab 左右阴影

  useEffect(() => {
    const root = viewportRef.current
    const sentinel = sentinelRef.current
    if (!root || !sentinel || !hasNextPage) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isFetchingNextPage) fetchNextPage()
      },
      { root, rootMargin: '160px' },
    )
    io.observe(sentinel)
    return () => io.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  return (
    <PanelBody>
      {/* 头部:标题 + 同步 + 搜索 + 状态筛选 tab */}
      <div className="flex flex-col gap-2 border-b p-2">
        <div className="flex items-center gap-2 px-1">
          <FolderClosed className="size-4" />
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
        <ScrollArea
          viewportRef={tabsViewportRef}
          className="w-full [&_[data-slot=scroll-area-scrollbar]]:hidden"
        >
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
              {items.map((p) => (
                <ProjectCard
                  key={p.id}
                  project={p}
                  active={selectedId === p.id}
                  busy={statusChangingId === p.id}
                  onOpen={() => onSelect(p.id)}
                  onChangeStatus={onChangeStatus}
                />
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
        <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground">
          {project.thumbnailUrl ? (
            project.thumbnailKind === 'video' ? (
              // 视频资产无图片海报 → 用 <video> 首帧(#t=0.1 避开黑帧)当缩略图
              <video
                src={`${project.thumbnailUrl}#t=0.1`}
                muted
                playsInline
                preload="metadata"
                className="size-full object-cover"
              />
            ) : (
              <img
                src={project.thumbnailUrl}
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

function DetailContent({
  loading,
  project,
  onBack,
}: {
  loading: boolean
  project: { id: string; name: string; updatedAt: string; state: unknown } | undefined
  onBack: () => void
}) {
  return (
    <PanelBody>
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <Info className="size-4" />
        <span className="flex-1 truncate text-sm font-medium">详情</span>
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={onBack}>
          <ChevronLeft className="size-3.5" /> 列表
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-3">
          {loading || !project ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> 加载中…
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div>
                <div className="text-base font-semibold">{project.name}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">更新于 {relTime(project.updatedAt)}</div>
              </div>
              <Separator />
              <p className="text-xs text-muted-foreground">详情面板后续再细化(选中项目 → 加载进编辑器等)。</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </PanelBody>
  )
}
