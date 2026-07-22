import type React from 'react'
import { useTranslation } from 'react-i18next'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

// 对齐 shadcn 官方 sidebar 的动画结构。要点(以前的写法三条全踩反了):
//  1. 不做条件渲染 —— 面板与 rail 始终挂载,靠 CSS 交叉淡入。以前是 `expanded ? panel : rail`,
//     点击瞬间内容就换掉了,而宽度还要慢慢动 300ms,于是「内容已变、容器还在爬」= 跳变。
//  2. 两层各自保持固有宽度并绝对定位 —— 收缩时内容被 overflow 裁掉,而不是被挤扁回流
//     (文字换行/元素重排在动画中途最显脏)。
//  3. duration-200 ease-linear —— 官方用线性;宽度动画配 ease-in-out 会显得黏。
export function Section({
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
export function Layer({
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
export function CollapseToggle({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { t } = useTranslation()
  const label = collapsed ? t('projectNav.expandSidebar') : t('projectNav.collapseSidebar')
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
export function Rail({
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
  const { t } = useTranslation()
  return (
    <div className="flex h-full w-full flex-col items-center">
      {topAction ? <div className="flex h-11 shrink-0 items-center">{topAction}</div> : null}
      <button
        type="button"
        disabled={disabled}
        onClick={onExpand}
        className="flex w-full min-h-0 flex-1 flex-col items-center gap-3 py-3 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-40"
        aria-label={t('projectNav.expandPanel', { label })}
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
export function PanelBody({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full w-full flex-col">{children}</div>
}
