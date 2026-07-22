import { useState } from 'react'
import { ChevronDown, Loader2 } from 'lucide-react'

import { STATUS_ACTIONS, STATUS_STYLE, type StatusAction } from '@/components/project-nav/constants'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { statusLabel } from '@/lib/format'
import { cn } from '@/lib/utils'

// 状态徽章 = 下拉:点击弹出当前状态可执行的 FSM 动作(对齐 xchangeai-workbench 的 ProjectStatusMenu)。
export function ProjectStatusMenu({
  status,
  busy,
  onAction,
}: {
  status: string
  busy: boolean
  onAction: (action: string) => void
}) {
  const actions: StatusAction[] = STATUS_ACTIONS[status] ?? []
  // 待确认的动作。菜单关闭即清空 —— 下次打开必须从头再点一次,不留半截状态。
  const [pendingConfirm, setPendingConfirm] = useState<string | null>(null)
  const pill = cn(
    'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium capitalize',
    STATUS_STYLE[status] ?? 'bg-muted text-muted-foreground',
  )
  if (actions.length === 0) return <span className={pill}>{statusLabel(status)}</span>
  return (
    <DropdownMenu onOpenChange={(open) => !open && setPendingConfirm(null)}>
      <DropdownMenuTrigger disabled={busy} className={cn(pill, 'cursor-pointer outline-none disabled:opacity-60')}>
        {busy ? <Loader2 className="size-3 animate-spin" /> : null}
        {statusLabel(status)}
        <ChevronDown className="size-3 opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-44">
        {actions.map((a) => {
          const confirming = pendingConfirm === a.action
          return (
            <DropdownMenuItem
              key={a.action}
              // 第一次点危险动作只换文案,菜单要留着 → 阻止 Base UI 的默认关闭
              closeOnClick={!a.confirm || confirming}
              className={cn(
                'text-xs',
                a.confirm && 'text-destructive focus:text-destructive',
                confirming && 'font-medium',
                a.primary && 'font-medium text-foreground',
              )}
              onClick={() => {
                if (a.confirm && !confirming) {
                  setPendingConfirm(a.action)
                  return
                }
                setPendingConfirm(null)
                onAction(a.action)
              }}
            >
              {confirming ? a.confirm : a.label}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
