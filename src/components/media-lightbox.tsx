import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  onIndexChange: (index: number) => void
  onClose: () => void
  subtitle?: string
  footer?: React.ReactNode
  // 右栏(如评论时间线)。给了就走左右布局 + 宽对话框;不给就是原来的居中堆叠(评论附件轮播用)。
  sidebar?: React.ReactNode
  children?: React.ReactNode
}) {
  const { t } = useTranslation()
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

  // 不再在无内容时 return null:base-ui 需要 Root 从一开始就以 open=false 挂着,首次打开(false→true)
  // 才会播进场过渡;否则首次直接以 open=true 全新挂载会被当「初始即开」→ 不播进场 → 首次瞬现。
  // 故 Root/Portal/Popup 常挂,只在有内容时渲染 Popup 内部(关闭时 base-ui 本就不挂 Popup)。
  const item = shown ? shown.items[shown.index] : undefined

  // FLIP transform:把弹窗缩到缩略图大小(scale = 缩略图宽 / 弹窗宽)、中心平移到缩略图中心。
  // 弹窗居中(flex),中心 = 视口中心,故平移量 = 缩略图中心 − 视口中心。宽度按布局确定性算出,不用测量。
  const flip = (() => {
    const r = shown?.rect
    if (!r || typeof window === 'undefined') return 'scale(0.92)' // 无缩略图矩形:回退居中缩放
    const w = window.innerWidth
    const h = window.innerHeight
    const popupW = sidebar ? Math.min(0.95 * w, 1280) : Math.min(w - 32, 672)
    const scale = Math.max(0.04, r.width / popupW)
    const tx = Math.round(r.left + r.width / 2 - w / 2)
    const ty = Math.round(r.top + r.height / 2 - h / 2)
    return `translate(${tx}px, ${ty}px) scale(${scale.toFixed(4)})`
  })()

  const total = shown?.items.length ?? 0
  const idx = shown?.index ?? 0

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          className="fixed inset-0 z-50 bg-black/50 transition-opacity duration-300 supports-backdrop-filter:backdrop-blur-xs data-starting-style:opacity-0 data-ending-style:opacity-0"
        />
        {/* Popup 是 Portal 的直接子(不套包裹层)。inset-0 + m-auto 居中,transform 留给 FLIP。
            enter/exit 走 base-ui 原生 data-starting/ending-style 过渡,base-ui 自己等过渡结束再卸载。 */}
        <DialogPrimitive.Popup
          // --flip = 缩到缩略图大小 + 平移到缩略图中心的 transform;starting/ending 两端用它做 FLIP。
          style={{ '--flip': flip } as React.CSSProperties}
          className={cn(
            'fixed inset-0 z-50 m-auto flex origin-center overflow-hidden rounded-xl bg-popover p-3 text-sm text-popover-foreground ring-1 ring-foreground/10 outline-none',
            // base-ui 原生过渡:进场从 --flip 补到常态、退场补回 --flip;base-ui 自己等过渡结束再卸载。
            'transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] data-starting-style:opacity-0 data-ending-style:opacity-0 data-starting-style:transform-(--flip) data-ending-style:transform-(--flip) data-ending-style:duration-[0.26s] data-ending-style:ease-[cubic-bezier(0.55,0.06,0.68,0.19)]',
            sidebar
              ? 'h-[calc(100vh-4rem)] w-[95vw] flex-row gap-3 sm:max-w-7xl'
              : 'h-fit max-h-[calc(100vh-4rem)] w-fit max-w-2xl flex-col gap-3',
          )}
        >
          {item ? (
            <>
            {/* 媒体列:标题 + 图/视频 + footer。左右布局时它是左栏,堆叠时它就是主体。 */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
              <div className="flex min-w-0 flex-col gap-0.5 pr-8">
                <DialogPrimitive.Title className="truncate text-sm leading-none font-medium">
                  {item.name || t('lightbox.untitledFile')}
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
                    nativeButton={false}
                    render={<a href={item.url} download={item.name ?? undefined} target="_blank" rel="noreferrer" />}
                  >
                    <Download className="size-3.5" /> {t('lightbox.download')}
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
              <span className="sr-only">{t('lightbox.close')}</span>
            </DialogPrimitive.Close>
            </>
          ) : null}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function Nav({ side, disabled, onClick }: { side: 'left' | 'right'; disabled: boolean; onClick: () => void }) {
  const { t } = useTranslation()
  if (disabled) return null
  const Icon = side === 'left' ? ChevronLeft : ChevronRight
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onClick}
      aria-label={side === 'left' ? t('lightbox.prev') : t('lightbox.next')}
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
// 关闭直接置空:base-ui 会给退出中的 Popup/Backdrop 挂 data-ending-style 并等 CSS 过渡结束再卸载
// (见 MediaLightbox 的 transition 类),不必手动计时——之前的 closing+setTimeout 会和 base-ui
// 自带的过渡状态机打架,表现为「关→又开→再关」的抖动。
export function useMediaLightbox() {
  const [state, setState] = useState<{ index: number; rect: FlipRect | null } | null>(null)
  return {
    index: state?.index ?? null,
    rect: state?.rect ?? null,
    open: (index: number, ev?: { currentTarget: Element }) => {
      const r = ev?.currentTarget?.getBoundingClientRect()
      setState({ index, rect: r ? { left: r.left, top: r.top, width: r.width, height: r.height } : null })
    },
    close: () => setState(null),
    onIndexChange: (index: number) => setState((s) => (s ? { ...s, index } : s)),
  }
}
