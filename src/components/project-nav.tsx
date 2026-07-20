import { useEffect, useRef, useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { ChevronLeft, FolderClosed, Info, Loader2 } from 'lucide-react'

import { getBffProject, listBffProjects } from '@/generated/client'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'

// 手写双层侧边栏(互斥展开):第一层=项目列表(下拉分页加载),第二层=项目详情。
// 展开一个 → 另一个收成窄图标 rail(点 rail 即展开);选项目自动切到详情。
// 动画:外层 section 动 width(w-72 ↔ w-12)+ overflow-hidden → 滑动过渡。
// 滚动:shadcn ScrollArea(base-ui)控制;底部 sentinel + IntersectionObserver 触发下一页。

type Panel = 'list' | 'detail'
type ProjectSummary = { id: string; name: string; updatedAt: string }

const PAGE_SIZE = 20

// state 是不透明的 UndoableState(编辑器原生),按已知形状读摘要即可。
type StateShape = {
  tracks?: unknown[]
  items?: Record<string, unknown>
  assets?: Record<string, unknown>
  fps?: number
  compositionWidth?: number
  compositionHeight?: number
}

const relTime = (iso: string) => {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true })
  } catch {
    return iso
  }
}

export function ProjectNav() {
  const [active, setActive] = useState<Panel>('list')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const projects = useInfiniteQuery({
    queryKey: ['bff', 'projects'],
    queryFn: ({ pageParam }) => listBffProjects({ query: { limit: PAGE_SIZE, offset: pageParam } }),
    initialPageParam: 0,
    getNextPageParam: (last) => {
      const loaded = last.offset + last.items.length
      return loaded < last.total ? loaded : undefined
    },
  })
  const items = projects.data?.pages.flatMap((p) => p.items) ?? []

  const detail = useQuery({
    queryKey: ['bff', 'project', selectedId],
    queryFn: () => getBffProject({ path: { id: selectedId! } }),
    enabled: Boolean(selectedId),
  })

  const selectProject = (id: string) => {
    setSelectedId(id)
    setActive('detail')
  }

  return (
    <div className="flex h-full shrink-0 border-r bg-sidebar text-sidebar-foreground">
      {/* 第一层:项目列表 */}
      <Section expanded={active === 'list'} bordered>
        {active === 'list' ? (
          <ListContent
            items={items}
            total={projects.data?.pages[0]?.total ?? items.length}
            loading={projects.isPending}
            error={projects.isError}
            hasNextPage={projects.hasNextPage}
            isFetchingNextPage={projects.isFetchingNextPage}
            fetchNextPage={() => void projects.fetchNextPage()}
            selectedId={selectedId}
            onSelect={selectProject}
          />
        ) : (
          <Rail icon={<FolderClosed className="size-4" />} label="项目" onExpand={() => setActive('list')} />
        )}
      </Section>

      {/* 第二层:项目详情 */}
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

/** 承载单层的容器:动画 width(展开 w-72 / 收起 w-12),overflow-hidden 让内容滑入滑出。 */
function Section({
  expanded,
  bordered,
  children,
}: {
  expanded: boolean
  bordered?: boolean
  children: React.ReactNode
}) {
  return (
    <section
      className={cn(
        'flex shrink-0 flex-col overflow-hidden transition-[width] duration-300 ease-in-out',
        bordered && 'border-r',
        expanded ? 'w-72' : 'w-12',
      )}
    >
      {children}
    </section>
  )
}

/** 收起态:竖排 rail,点击展开(disabled 时不可点)。中文竖排不加 rotate(否则倒立)。 */
function Rail({
  icon,
  label,
  onExpand,
  disabled,
}: {
  icon: React.ReactNode
  label: string
  onExpand: () => void
  disabled?: boolean
}) {
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

/** 展开态内容固定 w-72,避免动画期间随容器宽度回流(靠 overflow-hidden 揭示)。 */
function PanelBody({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full w-72 flex-col">{children}</div>
}

function PanelHeader({ icon, title, action }: { icon: React.ReactNode; title: string; action?: React.ReactNode }) {
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
      {icon}
      <span className="flex-1 truncate text-sm font-medium">{title}</span>
      {action}
    </div>
  )
}

function ListContent({
  items,
  total,
  loading,
  error,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  selectedId,
  onSelect,
}: {
  items: ProjectSummary[]
  total: number
  loading: boolean
  error: boolean
  hasNextPage: boolean
  isFetchingNextPage: boolean
  fetchNextPage: () => void
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)

  // sentinel 进入 ScrollArea 视口(提前 120px)→ 加载下一页
  useEffect(() => {
    const root = viewportRef.current
    const sentinel = sentinelRef.current
    if (!root || !sentinel || !hasNextPage) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isFetchingNextPage) fetchNextPage()
      },
      { root, rootMargin: '120px' },
    )
    io.observe(sentinel)
    return () => io.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  return (
    <PanelBody>
      <PanelHeader
        icon={<FolderClosed className="size-4" />}
        title="项目"
        action={!loading && !error ? <span className="text-xs text-muted-foreground">{total}</span> : null}
      />
      <ScrollArea viewportRef={viewportRef} className="min-h-0 flex-1">
        <div className="p-2">
          {loading ? (
            <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> 加载中…
            </div>
          ) : error ? (
            <div className="p-3 text-sm text-destructive">加载失败</div>
          ) : items.length === 0 ? (
            <div className="p-3 text-sm text-muted-foreground">暂无项目</div>
          ) : (
            <>
              {items.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onSelect(p.id)}
                  className={cn(
                    'flex w-full flex-col items-start gap-0.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                    selectedId === p.id && 'bg-sidebar-accent text-sidebar-accent-foreground',
                  )}
                >
                  <span className="w-full truncate text-sm font-medium">{p.name}</span>
                  <span className="text-xs text-muted-foreground">{relTime(p.updatedAt)}</span>
                </button>
              ))}
              <div ref={sentinelRef} aria-hidden className="h-px" />
              {isFetchingNextPage ? (
                <div className="flex items-center justify-center gap-2 py-3 text-xs text-muted-foreground">
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

function DetailContent({
  loading,
  project,
  onBack,
}: {
  loading: boolean
  project: { id: string; name: string; updatedAt: string; state: unknown } | undefined
  onBack: () => void
}) {
  const s = project?.state as StateShape | undefined
  return (
    <PanelBody>
      <PanelHeader
        icon={<Info className="size-4" />}
        title="详情"
        action={
          <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={onBack}>
            <ChevronLeft className="size-3.5" /> 列表
          </Button>
        }
      />
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
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                <Meta label="画布" value={s ? `${s.compositionWidth ?? '—'}×${s.compositionHeight ?? '—'}` : '—'} />
                <Meta label="帧率" value={s?.fps ? `${s.fps} fps` : '—'} />
                <Meta label="轨道" value={String(s?.tracks?.length ?? 0)} />
                <Meta label="片段" value={String(Object.keys(s?.items ?? {}).length)} />
                <Meta label="资产" value={String(Object.keys(s?.assets ?? {}).length)} />
              </dl>
              <Separator />
              <p className="text-xs text-muted-foreground">
                选中项目的时间线尚未接入编辑器 —— 接 <code>getBffProject.state</code> 加载是下一步。
              </p>
            </div>
          )}
        </div>
      </ScrollArea>
    </PanelBody>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  )
}
