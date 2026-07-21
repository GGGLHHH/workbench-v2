import { useEffect, useRef, useState } from 'react'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react'

import type { BffTag } from '@/generated/api-types'
import { cn, fileSize } from '@/lib/utils'
import { Button } from '@/components/ui/button'

// 媒体灯箱。对齐 legacy 的 ImageLightbox(原件 / 文件名 / 下载 / Esc 关)+ xchangeai-web 的 MediaPreview。
//
// 动画:整个弹窗层从点中的缩略图放大出现、缩回消失。用 base-ui 原生的过渡态
// (data-starting-style / data-ending-style,官方推荐的 CSS transition 路子)——base-ui 自己管
// 「退出播完再卸载」,不跟它抢挂载(Motion 的 layoutId + AnimatePresence 在这版 base-ui 里退出会被强卸)。
// FLIP:算出「弹窗缩到缩略图大小、平移到缩略图中心」的 transform,当作起始/结束态,base-ui 在两端补间。
export type ViewerItem = {
  url: string
  kind: string
  name?: string | null
  sizeBytes?: number | null
  id?: string
  group?: string
  tags?: BffTag[]
  commentCount?: number
}

type FlipRect = { left: number; top: number; width: number; height: number }

export function MediaLightbox({
  items,
  index,
  rect,
  closing = false,
  onIndexChange,
  onClose,
  subtitle,
  footer,
  sidebar,
  children,
}: {
  items: ViewerItem[]
  index: number | null
  // 点中的缩略图矩形(视口 px)。弹窗从这里长出、缩回。
  rect?: FlipRect | null
  // 关闭动画进行中:内容仍渲染、base-ui Root 仍 open,播 lightbox-out 后由 hook 延时卸载
  closing?: boolean
  onIndexChange: (index: number) => void
  onClose: () => void
  subtitle?: string
  footer?: React.ReactNode
  // 右栏(如评论时间线)。给了就走左右布局 + 宽对话框;不给就是原来的居中堆叠(评论附件轮播用)。
  sidebar?: React.ReactNode
  children?: React.ReactNode
}) {
  const open = index !== null

  // 冻结最后一次展示的 items/index/rect,供 base-ui 退出过渡期间(open 已 false)继续渲染内容。
  const shownRef = useRef<{ items: ViewerItem[]; index: number; rect: FlipRect | null } | null>(null)
  if (open && index !== null) shownRef.current = { items, index, rect: rect ?? null }
  const shown = shownRef.current

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft' && index > 0) onIndexChange(index - 1)
      if (event.key === 'ArrowRight' && index < items.length - 1) onIndexChange(index + 1)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, index, items.length, onIndexChange])

  if (!shown) return null
  const item = shown.items[shown.index]
  if (!item) return null

  // FLIP transform:把弹窗缩到缩略图大小(scale = 缩略图宽 / 弹窗宽)、中心平移到缩略图中心。
  // 弹窗居中(flex),中心 = 视口中心,故平移量 = 缩略图中心 − 视口中心。宽度按布局确定性算出,不用测量。
  const flip = (() => {
    const r = shown.rect
    if (!r || typeof window === 'undefined') return undefined
    const w = window.innerWidth
    const h = window.innerHeight
    const popupW = sidebar ? Math.min(0.95 * w, 1280) : Math.min(w - 32, 672)
    const scale = Math.max(0.04, r.width / popupW)
    const tx = Math.round(r.left + r.width / 2 - w / 2)
    const ty = Math.round(r.top + r.height / 2 - h / 2)
    return `translate(${tx}px, ${ty}px) scale(${scale.toFixed(4)})`
  })()

  const total = shown.items.length
  const idx = shown.index

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          className={cn(
            'fixed inset-0 z-50 bg-black/50 duration-300 supports-backdrop-filter:backdrop-blur-xs',
            closing ? 'opacity-0 transition-opacity' : 'animate-in fade-in-0',
          )}
        />
        {/* Popup 是 Portal 的直接子(不套包裹层)。inset-0 + m-auto 居中,transform 留给 FLIP keyframe。
            enter/exit 由 closing 切换 lightbox-in / lightbox-out —— 自管挂载,不依赖 base-ui 的退出检测。 */}
        <DialogPrimitive.Popup
          // --flip = 缩到缩略图大小 + 平移到缩略图中心的 transform;keyframe 用它做起止。origin 居中配合 translate。
          style={{ '--flip': flip } as React.CSSProperties}
          className={cn(
            'fixed inset-0 z-50 m-auto flex origin-center overflow-hidden rounded-xl bg-popover p-3 text-sm text-popover-foreground ring-1 ring-foreground/10 outline-none',
            closing
              ? '[animation:lightbox-out_.26s_cubic-bezier(.55,.06,.68,.19)_forwards]'
              : '[animation:lightbox-in_.3s_cubic-bezier(.22,1,.36,1)_both]',
            sidebar
              ? 'h-[calc(100vh-4rem)] w-[95vw] flex-row gap-3 sm:max-w-7xl'
              : 'h-fit max-h-[calc(100vh-4rem)] w-fit max-w-2xl flex-col gap-3',
          )}
        >
            {/* 媒体列:标题 + 图/视频 + footer。左右布局时它是左栏,堆叠时它就是主体。 */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
              <div className="flex min-w-0 flex-col gap-0.5 pr-8">
                <DialogPrimitive.Title className="truncate text-sm leading-none font-medium">
                  {item.name || '未命名文件'}
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="text-xs text-muted-foreground">
                  {subtitle ? `${subtitle} · ` : ''}
                  {idx + 1} / {total}
                </DialogPrimitive.Description>
              </div>

              <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-md bg-muted">
                {item.kind === 'video' ? (
                  <video key={item.url} src={item.url} controls playsInline className="max-h-full w-auto max-w-full" />
                ) : (
                  <img src={item.url} alt={item.name ?? ''} className="max-h-full w-auto max-w-full object-contain" />
                )}
                <Nav side="left" disabled={idx === 0} onClick={() => onIndexChange(idx - 1)} />
                <Nav side="right" disabled={idx === total - 1} onClick={() => onIndexChange(idx + 1)} />
              </div>

              <div className="flex items-start gap-2">
                {footer}
                <div className="ml-auto flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
                  {item.sizeBytes ? <span>{fileSize(item.sizeBytes)}</span> : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 px-2 text-xs"
                    render={<a href={item.url} download={item.name ?? undefined} target="_blank" rel="noreferrer" />}
                  >
                    <Download className="size-3.5" /> 下载
                  </Button>
                </div>
              </div>
            </div>

            {sidebar ? (
              // 评论栏与媒体栏等宽(各占一半),不再固定窄栏
              <div className="flex min-w-0 flex-1 flex-col border-l pl-3">{sidebar}</div>
            ) : null}
            {children}

            <DialogPrimitive.Close render={<Button variant="ghost" size="icon-sm" className="absolute top-2 right-2" />}>
              <X className="size-4" />
              <span className="sr-only">关闭</span>
            </DialogPrimitive.Close>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function Nav({ side, disabled, onClick }: { side: 'left' | 'right'; disabled: boolean; onClick: () => void }) {
  if (disabled) return null
  const Icon = side === 'left' ? ChevronLeft : ChevronRight
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onClick}
      aria-label={side === 'left' ? '上一个' : '下一个'}
      className={cn(
        'absolute top-1/2 z-10 size-8 -translate-y-1/2 bg-background/70 hover:bg-background',
        side === 'left' ? 'left-1' : 'right-1',
      )}
    >
      <Icon className="size-4" />
    </Button>
  )
}

// 开合状态挂在这里。open 时记下点中缩略图的矩形 → 弹窗从那里长出、缩回。
// 关闭不立即卸载:先标 closing 播 lightbox-out(base-ui 的 Root 仍 open=true,不会抢先卸载),
// 动画放完(280ms)再真正清空。这版 base-ui 的 Portal 在 open=false 时瞬间卸载、不等退出动画,故自管。
export function useMediaLightbox() {
  const [state, setState] = useState<{ index: number; rect: FlipRect | null; closing?: boolean } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  return {
    index: state?.index ?? null,
    rect: state?.rect ?? null,
    closing: state?.closing ?? false,
    open: (index: number, ev?: { currentTarget: Element }) => {
      clearTimeout(timer.current)
      const r = ev?.currentTarget?.getBoundingClientRect()
      setState({ index, rect: r ? { left: r.left, top: r.top, width: r.width, height: r.height } : null })
    },
    close: () => {
      setState((s) => (s ? { ...s, closing: true } : s))
      timer.current = setTimeout(() => setState(null), 280)
    },
    onIndexChange: (index: number) => setState((s) => (s ? { ...s, index } : s)),
  }
}
