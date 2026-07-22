import { memo } from 'react'
import { useSearch } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { CloudDownload, Loader2 } from 'lucide-react'

import { ASSIGNEE_FILTERS, SORT_OPTIONS } from '@/components/project-nav/constants'
import { CollapseToggle } from '@/components/project-nav/shell'
import { useNavActions } from '@/components/project-nav/nav-context'
import { useAssigneeCount, useProjectStats } from '@/api/projects/projects'
import { useSession } from '@/api/session/session'
import { LanguageToggle } from '@/components/language-toggle'
import { ThemeToggle } from '@/components/theme-toggle'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SearchInput } from '@/components/form/search-input'

// 头部单独 memo:滚动时虚拟化器每帧都让 ListContent 重渲染,而搜索框、11 个状态 tab、
// 排序下拉这些跟滚动毫无关系 —— 不隔离的话它们每帧都跟着 diff 一遍。
// 头部持有搜索/筛选/排序,本就该随筛选变更重渲染,所以它就地读 useSearch + 计数 hook,
// 回调从稳定的 NavActions context 取。syncing/onSync 是 ListContent 的局部状态,仍走 prop。
export const ListHeader = memo(function ListHeader({
  syncing,
  onSync,
  tabsViewportRef,
}: {
  syncing: boolean
  onSync: () => void
  tabsViewportRef: React.RefObject<HTMLDivElement | null>
}) {
  const { t } = useTranslation()
  const params = useSearch({ from: '/' })
  const search = params.search ?? ''
  const assignee = params.assignee ?? ''
  const sort = params.sort ?? 'created_desc'
  const { onSearch, onAssigneeChange, onSortChange, toggleCollapse } = useNavActions()
  // 三档计数(数字为原始类型;undefined = 尚未加载):All=stats.total;
  // Unassigned/My 各发一个 limit:1 列表读 total(全局,不跟随搜索)。
  const meId = useSession().data?.user?.id
  const allCount = useProjectStats().data?.total
  const unassignedCount = useAssigneeCount('unassigned', true).data
  const mineCount = useAssigneeCount(meId ?? '', Boolean(meId)).data
  return (
    <>
      {/* 头部:标题 + 同步 + 搜索 + 状态筛选 tab */}
      <div className="flex flex-col gap-2 border-b p-2">
        <div className="flex items-center gap-2 px-1">
          {/* 与收起态 rail 顶部的 toggle 同一位置(最左),避免来回切时按钮跳位 */}
          <CollapseToggle collapsed={false} onToggle={toggleCollapse} />
          <span className="flex-1 text-sm font-semibold">{t('projectNav.projects')}</span>
          <ThemeToggle />
          <LanguageToggle />
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            disabled={syncing}
            onClick={onSync}
          >
            {syncing ? <Loader2 className="size-3.5 animate-spin" /> : <CloudDownload className="size-3.5" />} {t('projectNav.sync')}
          </Button>
        </div>
        <SearchInput
          value={search}
          onValueChange={onSearch}
          placeholder={t('projectNav.searchPlaceholder')}
          aria-label={t('projectNav.searchAria')}
          inputClassName="h-8 text-sm"
        />
        {/* tab 条本来就有左右渐隐,再加一条横向滚动条只会挤掉半行高度 */}
        <ScrollArea viewportRef={tabsViewportRef} scrollbar="none" className="w-full">
          <div className="flex w-max gap-1">
            {ASSIGNEE_FILTERS.map((f) => {
              const count = f.id === '' ? allCount : f.id === 'unassigned' ? unassignedCount : mineCount
              const isActive = assignee === f.id
              return (
                <button
                  key={f.id || 'all'}
                  type="button"
                  onClick={() => onAssigneeChange(f.id)}
                  className={cn(
                    'flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs whitespace-nowrap transition-colors',
                    isActive
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                      : 'text-muted-foreground hover:bg-sidebar-accent/50',
                  )}
                >
                  <span>{t(f.labelKey)}</span>
                  {count !== undefined ? (
                    <span className={cn('tabular-nums', isActive && 'font-semibold')}>{count}</span>
                  ) : null}
                </button>
              )
            })}
          </div>
        </ScrollArea>
      </div>

      <div className="flex items-center justify-between px-3 py-2 text-xs text-muted-foreground">
        <span className="font-medium tracking-wide">RECENT PROJECTS</span>
        <Select items={SORT_OPTIONS} value={sort} onValueChange={(value) => onSortChange(String(value))}>
          <SelectTrigger
            size="sm"
            className="h-6 gap-1 border-0 bg-transparent px-1.5 text-xs text-muted-foreground shadow-none hover:text-foreground focus-visible:ring-0 dark:bg-transparent dark:hover:bg-transparent"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {SORT_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

    </>
  )
})
