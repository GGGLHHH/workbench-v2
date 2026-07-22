import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearch } from '@tanstack/react-router'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'

import type { Anchor, ProjectSummary } from '@/components/project-nav/types'
import { ROW_GAP, ROW_HEIGHT } from '@/components/project-nav/constants'
import { PanelBody } from '@/components/project-nav/shell'
import { ProjectCard } from '@/components/project-nav/list/project-card'
import { ListHeader } from '@/components/project-nav/list/list-header'
import { useNavActions, useStatusChangingId } from '@/components/project-nav/nav-context'
import { PROJECTS_PAGE_SIZE, useProjectPages } from '@/api/projects/projects'
import { useSession } from '@/api/session/session'
import { useScrollFade } from '@/lib/use-scroll-fade'
import { ScrollArea } from '@/components/ui/scroll-area'

const readAnchor = (key: string): Anchor | null => {
  try {
    return JSON.parse(sessionStorage.getItem(key) ?? 'null') as Anchor | null
  } catch {
    return null
  }
}

export function ListContent({ visible }: { visible: boolean }) {
  const { t } = useTranslation()

  // 易变筛选态就地从 URL 读(ProjectNav 不再穿参);'me' 哨兵解析成会话 user.id,
  // 会话未就绪时退回全部 —— 与旧 ProjectNav 的 apiAssignee/params2 逻辑一致。
  const p = useSearch({ from: '/' })
  const meId = useSession().data?.user?.id
  const search = p.search ?? ''
  const rawAssignee = p.assignee ?? ''
  const apiAssignee = rawAssignee === 'me' ? (meId ?? '') : rawAssignee
  const sort = p.sort ?? 'created_desc'
  const params = useMemo(() => ({ search, assignee: apiAssignee, sort }), [search, apiAssignee, sort])
  const selectedId = p.project ?? null
  // 稳定回调从 context 取(refreshStats 供同步后刷计数);pending id 单独订阅。
  const { refreshStats } = useNavActions()
  const statusChangingId = useStatusChangingId()

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
    refreshStats()
  }, [refetch, refreshStats])

  return (
    <PanelBody>
      <ListHeader
        syncing={isFetching}
        onSync={onSync}
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
