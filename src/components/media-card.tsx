import type React from 'react'
import { ImageIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

// 缩略图:视频取首帧(#t=0.1),图片贴海报,无则占位图标。项目列表 / 资产网格 / 成片列表共用。
export function Thumb({ url, kind, className }: { url: string | null; kind: string | null; className?: string }) {
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

// 秒 → mm:ss。项目/成片时长共用。
export const duration = (seconds: number): string => {
  const s = Math.max(0, seconds || 0)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.round(s % 60)).padStart(2, '0')}`
}

// 媒体卡:缩略图 + 标题 + meta(children)+ 可选底部动作栏。项目列表卡 / 成片卡共用同一外观。
// 整个上部可点(onOpen 收到事件,供 FLIP 灯箱定位);footer 走 justify-between(左内容 / 右内容)。
export function MediaCard({
  active,
  onOpen,
  thumbnail,
  title,
  titleAttr,
  children,
  footer,
}: {
  active?: boolean
  onOpen?: (ev: React.MouseEvent<HTMLButtonElement>) => void
  thumbnail: React.ReactNode
  title: React.ReactNode
  titleAttr?: string
  children?: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border bg-card transition-colors',
        active ? 'border-primary ring-1 ring-primary/40' : 'hover:border-ring/40',
      )}
    >
      <button type="button" onClick={onOpen} className="flex w-full gap-3 p-2.5 text-left">
        {thumbnail}
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate text-sm font-semibold" title={titleAttr}>
            {title}
          </span>
          {children}
        </span>
      </button>
      {footer ? (
        <div className="flex items-center justify-between gap-2 border-t px-2.5 py-1.5">{footer}</div>
      ) : null}
    </div>
  )
}
