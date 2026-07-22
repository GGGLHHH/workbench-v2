import { ChevronDown, Eye, Loader2 } from 'lucide-react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { statusLabel } from '@/lib/format'
import { cn } from '@/lib/utils'

// 可见性:与状态徽章同一套「药丸即菜单」的形态,免得详情面板里两种可改字段长得不一样。
// 三档取自上游 ProjectVisibility 枚举。
const VISIBILITY_OPTIONS = [
  { value: 'public', label: 'Public' },
  { value: 'agency', label: 'Agency' },
  { value: 'owner_private', label: 'Owner private' },
] as const

export function VisibilityMenu({
  visibility,
  busy,
  onChange,
}: {
  visibility: string | null
  busy: boolean
  onChange: (v: 'public' | 'agency' | 'owner_private') => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={busy}
        className="inline-flex cursor-pointer items-center gap-1 rounded outline-none hover:text-foreground disabled:opacity-60"
      >
        {busy ? <Loader2 className="size-3 animate-spin" /> : <Eye className="size-3" />}
        {statusLabel(visibility || 'unknown')}
        <ChevronDown className="size-3 opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-36">
        {VISIBILITY_OPTIONS.map((o) => (
          <DropdownMenuItem
            key={o.value}
            className={cn('text-xs', o.value === visibility && 'font-medium text-foreground')}
            onClick={() => o.value !== visibility && onChange(o.value)}
          >
            {o.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
