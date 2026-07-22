import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useProjectAnalytics } from '@/api/projects/projects'
import { Group, Metric } from '@/components/project-nav/fields'
import { cn } from '@/lib/utils'

// 观看数据只在项目公开出去之后才产生 —— 其余状态连请求都不该发。
export const PUBLISHED_STATUSES = new Set(['published'])

// 项目分析:浏览 / 独立访客 / 分享,各带环比。上游是 frontend 域的端点,workbench 用户不一定
// 有权限 → 失败静默不展示(retry:false),而不是在详情里挂一条红色错误。
export function AnalyticsPanel({ projectId, enabled }: { projectId: string; enabled: boolean }) {
  const { t } = useTranslation()
  const { data, isPending, isError } = useProjectAnalytics(projectId, enabled)
  if (isError) return null
  return (
    <Group title="Audience">
      {isPending ? (
        <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> {t('common.loading')}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          <Metric label="Views" value={<Trend m={data.views} />} />
          <Metric label="Visitors" value={<Trend m={data.uniqueVisitors} />} />
          <Metric label="Shares" value={<Trend m={data.shares} />} />
        </div>
      )}
    </Group>
  )
}

// 值 + 环比。changePercent 为 null(上期为 0,涨幅无从谈起)时只显示值,不写 "+∞%"。
function Trend({ m }: { m: { value: number; changePercent?: number | null } }) {
  const c = m.changePercent
  return (
    <span className="inline-flex items-baseline gap-1">
      {m.value.toLocaleString()}
      {c != null && c !== 0 ? (
        <span className={cn('text-[10px]', c > 0 ? 'text-emerald-500' : 'text-red-500')}>
          {c > 0 ? '+' : ''}
          {Math.round(c)}%
        </span>
      ) : null}
    </span>
  )
}
