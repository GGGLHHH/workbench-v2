import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronsUpDown } from 'lucide-react'

import type { BffOption } from '@/generated/api-types'
import { useInfiniteMemberOptions, type MemberKind } from '@/api/member-options'
import { InfiniteCombobox, useInfiniteComboboxState } from '@/components/select/infinite-combobox'
import { type InfiniteSelectOption } from '@/components/select/infinite-select'
import { InfiniteSelectStateSlots } from '@/components/select/infinite-select-state-slots'
import { cn } from '@/lib/utils'

// 成员单选(agency/agent/assignee):自带触发器的无限下拉,替代原生 <select>。value=id,onChange 回传选中项
// (调用方取 item?.id 存进 draft)。selectedItem 传当前 {id,name} → 收起态触发器能显示标签(选中项可能在
// 已加载页之外,基座只解析「见过」的 id)。与 TagInfiniteSelect 同基座,单选、内置触发器。
export function MemberInfiniteSelect({
  kind,
  value,
  selectedItem,
  placeholder,
  disabled,
  onChange,
}: {
  kind: MemberKind
  value: string
  selectedItem?: BffOption
  placeholder: string
  disabled?: boolean
  onChange: (item: BffOption | undefined) => void
}) {
  const { t } = useTranslation()
  const combobox = useInfiniteComboboxState({})
  const list = useInfiniteMemberOptions(kind, { search: combobox.queryValue, enabled: combobox.open })

  // 把当前选中项并进列表(仅无搜索时),保证收起态触发器解析得到标签。搜索时结果保持纯粹。
  const listProps = useMemo(() => {
    if (combobox.queryValue || !selectedItem) return list
    if (list.items.some((o) => o.id === selectedItem.id)) return list
    return { ...list, items: [...list.items, selectedItem] }
  }, [list, selectedItem, combobox.queryValue])

  const getOption = useCallback((o: BffOption): InfiniteSelectOption => ({ id: o.id, label: o.name }), [])

  return (
    <InfiniteCombobox<BffOption>
      align="start"
      disabled={disabled}
      getOption={getOption}
      list={listProps}
      onChange={onChange}
      searchPlaceholder={t('memberSelect.searchPlaceholder')}
      slots={
        <InfiniteSelectStateSlots emptyText={t('memberSelect.empty')} loadingMoreText={t('memberSelect.loadingMore')} />
      }
      state={combobox}
      value={value || undefined}
    >
      {({ selectedItems }) => {
        const sel = selectedItems?.[0]
        return (
          <button
            type="button"
            disabled={disabled}
            className="flex h-8 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className={cn('truncate', !sel && 'text-muted-foreground')}>{sel ? sel.name : placeholder}</span>
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          </button>
        )
      }}
    </InfiniteCombobox>
  )
}
