import { useCallback, useMemo, type ReactNode } from 'react'

import type { BffTag } from '@/generated/api-types'
import { useInfiniteTagOptions } from '@/api/tags'
import {
  InfiniteCombobox,
  getInfiniteComboboxSelectionProps,
  useInfiniteComboboxState,
  type InfiniteComboboxChildren,
} from '@/components/select/infinite-combobox'
import { type ControllableSelectionProps, type InfiniteSelectOption } from '@/components/select/infinite-select'

// tag 专用 select:把 tag 目录查询与 InfiniteCombobox 缝在一起。从 xchangeai-web 移植,
// 去掉建标签(v2 只从已有目录绑定)。没有按 id 批量拉标签的端点,故不做 entity resolver ——
// 由消费方持有已选的 tag 实体(如资产当前绑定的 tags)、渲染自己的标签、再作为 selectedItems 传回。

interface TagInfiniteSelectCommonProps {
  children: InfiniteComboboxChildren<BffTag>
  disabled?: boolean

  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void

  contentClassName?: string
  align?: 'start' | 'center' | 'end'

  pageSize?: number

  /** 多选时把 onChange 延到 Popover 关闭:每次会话一次提交,而非每次勾选一次写入。 */
  commitOnClose?: boolean

  /**
   * 当前 value 对应的 tag 实体。预选标签可能落在已加载页之外,而 select 只对「见过」的项解析
   * 已提交的 id —— 解析不到的 id 会被静默从 onChange 剔掉,整组替换的消费方就会把它当删除持久化。
   * 把已知的选中项传进来,保证每个预选 id 都可解析。
   */
  selectedItems?: BffTag[]

  searchPlaceholder: string
  emptyLabel?: ReactNode
  loadingLabel?: ReactNode
  loadingMoreLabel?: ReactNode
  errorLabel?: ReactNode
  retryLabel?: ReactNode
  footer?: ReactNode
}

export type TagInfiniteSelectProps = TagInfiniteSelectCommonProps & ControllableSelectionProps<BffTag>

export function TagInfiniteSelect(props: TagInfiniteSelectProps) {
  const {
    children,
    disabled = false,
    contentClassName,
    align = 'start',
    pageSize,
    commitOnClose = false,
    searchPlaceholder,
    selectedItems,
    emptyLabel,
    loadingLabel,
    loadingMoreLabel,
    errorLabel,
    retryLabel,
    footer,
  } = props

  const combobox = useInfiniteComboboxState({
    defaultOpen: props.defaultOpen,
    onOpenChange: props.onOpenChange,
    open: props.open,
  })

  const list = useInfiniteTagOptions({
    search: combobox.queryValue,
    pageSize,
    enabled: combobox.open,
  })

  // 见 selectedItems 的说明:不做这层合并,落在已加载页之外的预选标签就会从每次提交里静默掉。
  const listProps = useMemo(() => {
    const loadedIds = new Set(list.selectProps.items.map((tag) => tag.id))
    const missing = (selectedItems ?? []).filter((tag) => !loadedIds.has(tag.id))
    if (missing.length === 0) return list.selectProps
    return { ...list.selectProps, items: [...list.selectProps.items, ...missing] }
  }, [list.selectProps, selectedItems])

  const getOption = useCallback(
    (tag: BffTag): InfiniteSelectOption => ({ id: tag.id, label: tag.displayName || tag.name }),
    [],
  )

  const selectionProps = getInfiniteComboboxSelectionProps<BffTag>(props)

  return (
    <InfiniteCombobox<BffTag>
      align={align}
      commitOnClose={props.multiple ? commitOnClose : false}
      contentClassName={contentClassName}
      disabled={disabled}
      emptyLabel={emptyLabel}
      errorLabel={errorLabel}
      getOption={getOption}
      list={listProps}
      loadingLabel={loadingLabel}
      loadingMoreLabel={loadingMoreLabel}
      retryLabel={retryLabel}
      footer={footer}
      searchPlaceholder={searchPlaceholder}
      state={combobox}
      {...selectionProps}
    >
      {children}
    </InfiniteCombobox>
  )
}
