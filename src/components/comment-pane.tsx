import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Loader2 } from 'lucide-react'

import type { BffSession } from '@/generated/api-types'
import { useInfiniteComments } from '@/api/projects/projects'
import { CommentComposer } from '@/components/comment-composer'
import { CommentItem, DaySeparator, toCommentRows } from '@/components/comment-item'
import { queryKeys } from '@/lib/query-keys'
import { useScrollFade } from '@/lib/use-scroll-fade'
import { ScrollArea } from '@/components/ui/scroll-area'

// 评论 pane(公共底层)。资产灯箱右栏、项目详情「评论」Tab 都挂它 —— 一块自持滚动容器的聊天流:
// 反向无限(上拉取更旧)、时间正序、最新在底、开时滚到底。叶子(CommentItem / 分隔)见 comment-item。
//
// 评论是动态高度(长短不一、带附件),所以用 TanStack Virtual 的 dynamic 测量(measureElement),
// 不是 project list 那种定高。反向 prepend 的位置保持交给库原生的两个选项(3.14 的聊天 API):
//   - anchorTo: 'end' —— 内容在视口上方变化(prepend 插旧行、旧行估→实测高)时,钉住底部可见内容不跳;
//   - followOnAppend —— 已在底部时,追加新评论自动跟到底。
//   - getItemKey 稳定键 —— prepend 后索引整体后移,测量仍绑在同一条上,不错位。
// 贴底用外层 flex justify-end:内容不足时把定高的 sizer 推到底(此时无滚动,不与虚拟坐标冲突);
// 内容超屏时归 0,sizer 贴顶,正常虚拟滚动。
export function CommentPane({
  entity,
  id,
  total,
  enabled = true,
  className,
}: {
  entity: 'project' | 'asset'
  id: string | null
  total: number
  enabled?: boolean
  className?: string
}) {
  const { t } = useTranslation()
  const query = useInfiniteComments(entity, id, total, enabled)
  const meId = useQueryClient().getQueryData<BffSession>(queryKeys.session())?.user?.id

  // 各页已按 offset 升序(fetchPreviousPage 前插),拍平即整体时间正序
  const items = useMemo(() => (query.data?.pages ?? []).flatMap((p) => p.items), [query.data])
  const shownTotal = query.data?.pages.at(-1)?.total ?? total
  const { hasPreviousPage, isFetchingPreviousPage, fetchPreviousPage } = query

  // 拆成「分隔 + 评论」的混合行(与 list 面板共用逻辑)。虚拟化按行数走,分隔行也参与动态测量。
  const rows = useMemo(() => toCommentRows(items), [items])

  const viewportRef = useRef<HTMLDivElement>(null)
  const didInitScrollRef = useRef(false)
  useScrollFade(viewportRef, 'vertical') // 评论流上下边缘渐隐,与列表/详情同一套

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => 64, // 一条短评论的粗估,measureElement 会随即校正
    getItemKey: (index) => rows[index]?.key ?? index,
    overscan: 6,
    gap: 12,
    anchorTo: 'end', // 反向列表:内容在上方变化时钉住底部,不跳
    followOnAppend: true, // 在底部时追加新评论自动跟到底
    scrollEndThreshold: 80, // 距底 ≤80px 才算「贴底」—— followOnAppend 的跟随判据,和列表其它处同一档
  })
  const virtualItems = virtualizer.getVirtualItems()

  const scrollToBottom = useCallback(() => {
    if (rows.length > 0) virtualizer.scrollToIndex(rows.length - 1, { align: 'end' })
  }, [virtualizer, rows.length])

  // 触顶 64px 内且还有更旧的 → 取上一页。位置保持交给 anchorTo:'end',这里只负责触发加载。
  useEffect(() => {
    const vp = viewportRef.current
    if (!vp) return
    const onScroll = () => {
      if (vp.scrollTop < 64 && hasPreviousPage && !isFetchingPreviousPage) {
        void fetchPreviousPage()
      }
    }
    vp.addEventListener('scroll', onScroll, { passive: true })
    return () => vp.removeEventListener('scroll', onScroll)
  }, [hasPreviousPage, isFetchingPreviousPage, fetchPreviousPage])

  // 首屏加载完 → 滚到底(尾页 = 最新)。只做一次(followOnAppend 只管追加,不管首屏)。
  useEffect(() => {
    if (!didInitScrollRef.current && !query.isPending && items.length > 0) {
      didInitScrollRef.current = true
      requestAnimationFrame(scrollToBottom) // rAF 等 sizer 有高度再滚
    }
  }, [query.isPending, items.length, scrollToBottom])

  return (
    <div className={className}>
      <ScrollArea viewportRef={viewportRef} className="relative min-h-0 flex-1">
        {isFetchingPreviousPage ? (
          <div className="pointer-events-none absolute inset-x-0 top-1 z-10 flex justify-center">
            <span className="rounded-full bg-background/80 p-1 shadow-sm">
              <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
            </span>
          </div>
        ) : null}
        {/* min-h-full + justify-end:评论少时把 sizer 推到底(最新紧挨输入框),多时贴顶正常滚 */}
        <div className="flex min-h-full flex-col justify-end pr-1">
          {query.isPending ? (
            <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> {t('commentPane.loadingComments')}
            </div>
          ) : query.isError ? (
            <p className="py-2 text-xs text-destructive">{t('commentPane.loadFailed')}</p>
          ) : items.length === 0 ? (
            <p className="py-2 text-xs text-muted-foreground">{t('commentPane.empty')}</p>
          ) : (
            <div style={{ position: 'relative', width: '100%', height: virtualizer.getTotalSize() }}>
              {virtualItems.map((vi) => {
                const row = rows[vi.index]
                if (!row) return null
                return (
                  <div
                    key={vi.key}
                    data-index={vi.index}
                    ref={virtualizer.measureElement}
                    style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vi.start}px)` }}
                  >
                    {row.type === 'sep' ? (
                      <DaySeparator label={row.label} />
                    ) : (
                      <ul>
                        <CommentItem
                          entity={entity}
                          id={id}
                          comment={row.comment}
                          mine={Boolean(meId) && row.comment.authorId === meId}
                          variant="chat"
                        />
                      </ul>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </ScrollArea>
      <CommentComposer entity={entity} id={id} onPosted={() => requestAnimationFrame(scrollToBottom)} className="mt-2" />
      {shownTotal > 0 ? <p className="pt-1 text-[11px] text-muted-foreground">{t('commentPane.totalCount', { count: shownTotal })}</p> : null}
    </div>
  )
}
