import { useEffect, useRef, useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import {
  Building2,
  ChevronLeft,
  Clapperboard,
  Clock,
  CloudDownload,
  FolderClosed,
  Image as ImageIcon,
  Info,
  Loader2,
  Search,
  User,
} from 'lucide-react'

import { getBffProject, getBffProjectStats, listBffProjects } from '@/generated/client'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'

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

const statusLabel = (status: string) => status.replaceAll('_', ' ')

const duration = (seconds: number) => {
  const s = Math.max(0, seconds || 0)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.round(s % 60)).padStart(2, '0')}`
}

// "Updated Xm/Xh/Xd ago"(对齐 xchangeai-workbench 的 updatedLabel)
const updatedLabel = (iso: string) => {
  const elapsed = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(elapsed) || elapsed < 0) return 'Recently updated'
  const minutes = Math.max(1, Math.floor(elapsed / 60000))
  if (minutes < 60) return `Updated ${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `Updated ${hours}h ago`
  return `Updated ${Math.floor(hours / 24)}d ago`
}

export function ProjectNav() {
  const [active, setActive] = useState<Panel>('list')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')

  const projects = useInfiniteQuery({
    queryKey: ['bff', 'projects', { search, status }],
    queryFn: ({ pageParam }) =>
      listBffProjects({
        query: { limit: PAGE_SIZE, offset: pageParam, search: search || undefined, status: status || undefined },
      }),
    initialPageParam: 0,
    getNextPageParam: (last) => {
      const loaded = last.offset + last.items.length
      return loaded < last.total ? loaded : undefined
    },
  })
  const stats = useQuery({ queryKey: ['bff', 'projects', 'stats'], queryFn: () => getBffProjectStats({}) })
  const items = (projects.data?.pages.flatMap((p) => p.items) ?? []) as ProjectSummary[]

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
            onRefresh={refresh}
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
  onRefresh,
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
  onRefresh: () => void
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState(search)
  useEffect(() => setDraft(search), [search])

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
        <form
          className="flex items-center gap-2 rounded-md border bg-background px-2"
          onSubmit={(event) => {
            event.preventDefault()
            onSearch(draft.trim())
          }}
        >
          <Search className="size-3.5 text-muted-foreground" />
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="搜索项目…"
            aria-label="搜索项目"
            className="h-8 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </form>
        <div className="flex gap-1 overflow-x-auto pb-1">
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
      </div>

      <div className="flex items-center justify-between px-3 py-2 text-xs text-muted-foreground">
        <span className="font-medium tracking-wide">RECENT PROJECTS</span>
        <span>Recently updated</span>
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
                <ProjectCard key={p.id} project={p} active={selectedId === p.id} onOpen={() => onSelect(p.id)} />
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

function ProjectCard({ project, active, onOpen }: { project: ProjectSummary; active: boolean; onOpen: () => void }) {
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
        <span
          className={cn(
            'rounded-md px-2 py-0.5 text-xs font-medium capitalize',
            STATUS_STYLE[project.status] ?? 'bg-muted text-muted-foreground',
          )}
        >
          {statusLabel(project.status)}
        </span>
        <span className="text-xs text-muted-foreground">{updatedLabel(project.updatedAt)}</span>
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
                <div className="mt-0.5 text-xs text-muted-foreground">更新于 {updatedLabel(project.updatedAt)}</div>
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
