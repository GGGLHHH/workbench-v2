import { useLayoutEffect, useRef, useState } from 'react'
import { differenceInSeconds, format, isThisYear, isToday, isYesterday } from 'date-fns'
import { Check, File as FileIcon, Pencil, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import i18n from '@/i18n'
import type { BffComment } from '@/generated/api-types'
import { useDeleteComment, useEditComment } from '@/api/projects/projects'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { MediaLightbox, useMediaLightbox } from '@/components/media-lightbox'
import { Thumb } from '@/components/media-card'
import { cn, fileSize } from '@/lib/utils'
import { Textarea } from '@/components/ui/textarea'

// 评论的共享叶子:一条评论 CommentItem(list/chat 两种变体,自持编辑/删除 mutation)、日期分隔
// DaySeparator、以及把评论流拆成「日期分隔 + 评论」行的 toCommentRows / dayLabel。
// 容器(滚动 / 虚拟化 / 无限加载 / composer)见 comment-pane —— 项目详情与资产灯箱都挂那个 pane。
//
// 刻意不做的只有一件:未读/红点。legacy 两边都没有,CommentModel 上也没有 read_at 之类的字段 ——
// commentCount 是累计量不是未读量,做成红点是凭空发明一个后端撑不起来的语义。

const LONG_COMMENT_CHARS = 280
const MAX_LENGTH = 5000

// 居中日期分隔条文案(对齐 Telegram):今天/昨天/7月18日/2025年7月18日。CJK 字面量需单引号转义。
export function dayLabel(d: Date): string {
  if (isToday(d)) return i18n.t('commentItem.today')
  if (isYesterday(d)) return i18n.t('commentItem.yesterday')
  return isThisYear(d) ? format(d, i18n.t('commentItem.dateMd')) : format(d, i18n.t('commentItem.dateYmd'))
}

// 评论流拆成「日期分隔 + 评论」的混合行:本地日切换处插一条分隔。list 与 chat 共用一套,
// 日期都靠分隔条承载,气泡内只留 HH:mm(见 CommentItem)。
export type CommentRow =
  | { type: 'sep'; key: string; label: string }
  | { type: 'msg'; key: string; comment: BffComment }

export function toCommentRows(items: BffComment[]): CommentRow[] {
  const out: CommentRow[] = []
  let prevDay: string | null = null
  for (const c of items) {
    const d = new Date(c.createdAt)
    const dayKey = format(d, 'yyyy-MM-dd') // 本地日
    if (dayKey !== prevDay) {
      out.push({ type: 'sep', key: `sep:${dayKey}`, label: dayLabel(d) })
      prevDay = dayKey
    }
    out.push({ type: 'msg', key: c.id, comment: c })
  }
  return out
}

// 居中日期分隔 pill。list 与 chat 共用。
export function DaySeparator({ label }: { label: string }) {
  return (
    <div className="flex justify-center py-0.5">
      <span className="rounded-full bg-muted/70 px-2.5 py-0.5 text-[10px] text-muted-foreground">{label}</span>
    </div>
  )
}

// 单条评论(展示 + 自己的可编辑/删除)。列表与时间线共用,故自持 edit/delete mutation,不靠外面传回调。
export function CommentItem({
  entity,
  id,
  comment,
  mine,
  variant = 'list',
}: {
  entity: 'project' | 'asset'
  id: string | null
  comment: BffComment
  mine: boolean
  // list = 项目面板的紧凑列表;chat = 灯箱的 Telegram 气泡(自己右、别人左)
  variant?: 'list' | 'chat'
}) {
  const { t } = useTranslation()
  const edit = useEditComment(entity)
  const remove = useDeleteComment(entity)
  const [expanded, setExpanded] = useState(false)
  const bodyRef = useRef<HTMLParagraphElement>(null)
  const [clamped, setClamped] = useState(false)
  // 编辑走就地替换成 textarea,不弹层 —— 窄栏里为改一行字开个 modal 太重
  const [editing, setEditing] = useState<string | null>(null)
  // 删除同样就地二次确认,和状态菜单的危险动作一个套路,不用 window.confirm
  const [confirmDelete, setConfirmDelete] = useState(false)
  const media = comment.attachments?.filter((a) => a.kind !== 'file') ?? []
  const files = comment.attachments?.filter((a) => a.kind === 'file') ?? []
  const viewer = useMediaLightbox()

  const submitEdit = () => {
    const next = (editing ?? '').trim()
    setEditing(null)
    if (id && next && next !== comment.content) edit.mutate({ entityId: id, commentId: comment.id, content: next })
  }

  // 字符数只是预筛(便宜);真截没截断得量 —— 281 字但只占两行时不该出现无意义的 "展开"。
  const maybeLong = comment.content.length > LONG_COMMENT_CHARS
  useLayoutEffect(() => {
    const el = bodyRef.current
    if (!maybeLong || !el) return
    setClamped(el.scrollHeight > el.clientHeight)
  }, [maybeLong, comment.content])

  // 气泡内只留时钟(日期靠日期分隔条,list/chat 都有);近处给「刚刚」。hover 看到秒。
  const shortClock =
    differenceInSeconds(new Date(), new Date(comment.createdAt)) < 60
      ? t('commentItem.justNow')
      : format(new Date(comment.createdAt), 'HH:mm')
  const timeText = `${shortClock}${comment.editedAt ? ` · ${t('commentItem.edited')}` : ''}`
  const fullTime = format(new Date(comment.createdAt), 'yyyy-MM-dd HH:mm:ss')

  // 编辑/删除:hover 才显现(两种变体都是),且只在自己的评论上渲染
  const actions =
    mine && editing === null ? (
      <span className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover/msg:opacity-100 focus-within:opacity-100">
        <button
          type="button"
          onClick={() => setEditing(comment.content)}
          aria-label={t('commentItem.editComment')}
          className="text-muted-foreground hover:text-foreground"
        >
          <Pencil className="size-3" />
        </button>
        <button
          type="button"
          onClick={() =>
            confirmDelete ? id && remove.mutate({ entityId: id, commentId: comment.id }) : setConfirmDelete(true)
          }
          onBlur={() => setConfirmDelete(false)}
          aria-label={confirmDelete ? t('commentItem.confirmDeleteComment') : t('commentItem.deleteComment')}
          className={cn('hover:text-destructive', confirmDelete ? 'text-destructive' : 'text-muted-foreground')}
        >
          {confirmDelete ? <Check className="size-3" /> : <Trash2 className="size-3" />}
        </button>
      </span>
    ) : null

  const editForm = (
    <div className="flex flex-col gap-1">
      <Textarea
        autoFocus
        value={editing ?? ''}
        rows={2}
        maxLength={MAX_LENGTH}
        onChange={(event) => setEditing(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setEditing(null)
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            submitEdit()
          }
        }}
        className="min-h-0 resize-none text-xs"
      />
      <div className="flex gap-2 text-[11px]">
        <button type="button" className="text-primary hover:underline" onClick={submitEdit}>
          {t('common.save')}
        </button>
        <button type="button" className="text-muted-foreground hover:underline" onClick={() => setEditing(null)}>
          {t('common.cancel')}
        </button>
      </div>
    </div>
  )

  // 正文 + 展开/收起 + 附件(媒体网格 / 文件行)。两种变体共用,只有正文文字色不同(气泡里用 foreground)。
  const body = (textClass: string) => (
    <>
      <p
        ref={bodyRef}
        className={cn('break-words whitespace-pre-wrap', textClass, !expanded && maybeLong && 'line-clamp-4')}
      >
        {comment.content}
      </p>
      {maybeLong && (clamped || expanded) ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="self-start text-[11px] text-primary hover:underline"
        >
          {expanded ? t('commentItem.collapse') : t('commentItem.expand')}
        </button>
      ) : null}
      {/* 媒体走网格、其余走文件行 —— 一个 pdf 塞进 <img> 只会得到碎图。点媒体开灯箱轮播,只装这条的媒体。 */}
      {media.length ? (
        <div className="mt-1 grid grid-cols-3 gap-1">
          {media.map((a, i) => (
            <button
              key={a.url}
              type="button"
              onClick={(e) => viewer.open(i, e)}
              title={a.name ?? undefined}
              className="aspect-square overflow-hidden rounded ring-offset-background hover:ring-2 hover:ring-ring"
            >
              <Thumb url={a.url} kind={a.kind} className="size-full rounded-none" />
            </button>
          ))}
          <MediaLightbox
            items={media}
            index={viewer.index}
            rect={viewer.rect}
            onIndexChange={viewer.onIndexChange}
            onClose={viewer.close}
            subtitle={t('commentItem.commentAttachments')}
          />
        </div>
      ) : null}
      {files.length ? (
        <div className="mt-1 flex flex-col gap-0.5">
          {files.map((a) => (
            <a
              key={a.url}
              href={a.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 truncate rounded border px-1.5 py-1 text-[11px] hover:border-ring"
            >
              <FileIcon className="size-3 shrink-0" />
              <span className="truncate">{a.name || t('commentItem.attachment')}</span>
              {a.sizeBytes ? (
                <span className="ml-auto shrink-0 text-muted-foreground">{fileSize(a.sizeBytes)}</span>
              ) : null}
            </a>
          ))}
        </div>
      ) : null}
    </>
  )

  // Telegram 气泡:自己右(tinted)、别人左(muted),尾巴用底角收口,时间在气泡内右下,动作 hover 悬在气泡侧边。
  if (variant === 'chat') {
    return (
      <li className={cn('group/msg flex flex-col', mine ? 'items-end' : 'items-start')}>
        {editing !== null ? (
          <div className="w-full max-w-[85%]">{editForm}</div>
        ) : (
          <div className="flex max-w-[85%] items-center gap-1">
            {actions}
            {/* max-w-full 覆盖 Bubble 自带的 max-w-[80%]:否则 own 长气泡卡在「行85% × 气泡80%」的双重上限、
                左排后右侧空一块。改成只由外层 85% 单层封顶,气泡靠右贴边。 */}
            <Bubble variant={mine ? 'tinted' : 'muted'} align={mine ? 'end' : 'start'} className="max-w-full">
              {/* min-w-fit:短正文(如单个 emoji)时,气泡按内容真实 fit-content 兜底,不被 flex 收缩到
                  比 nowrap 的作者名/时间还窄(否则 overflow-hidden 会把它们裁掉)。作者名/时间也 nowrap。 */}
              <BubbleContent
                className={cn('flex min-w-fit flex-col gap-0.5', mine ? 'rounded-br-sm' : 'rounded-bl-sm')}
              >
                {!mine ? (
                  <span className="text-xs font-medium whitespace-nowrap text-primary">{comment.author}</span>
                ) : null}
                {body('text-foreground')}
                <span title={fullTime} className="mt-0.5 self-end text-[10px] whitespace-nowrap text-muted-foreground">
                  {timeText}
                </span>
              </BubbleContent>
            </Bubble>
          </div>
        )}
      </li>
    )
  }

  // list:项目面板的紧凑一列
  return (
    <li className="group/msg flex flex-col gap-0.5 text-xs">
      <div className="flex items-baseline gap-2">
        <span className="truncate font-medium">{comment.author}</span>
        <span title={fullTime} className="shrink-0 text-[11px] text-muted-foreground">
          {timeText}
        </span>
        {actions ? <span className="ml-auto">{actions}</span> : null}
      </div>
      {editing !== null ? editForm : body('text-muted-foreground')}
    </li>
  )
}
