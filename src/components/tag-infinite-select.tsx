import { useCallback, useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import type { BffTag } from '@/generated/api-types'
import { useInfiniteTagOptions } from '@/api/tags'
import {
  InfiniteCombobox,
  getInfiniteComboboxSelectionProps,
  useInfiniteComboboxState,
  type InfiniteComboboxChildren,
} from '@/components/select/infinite-combobox'
import {
  type ControllableSelectionProps,
  type InfiniteSelectOption,
} from '@/components/select/infinite-select'
import { InfiniteSelectStateSlots } from '@/components/select/infinite-select-state-slots'

// tag 专用 select:tag 目录查询 + InfiniteCombobox 基座。对齐 basereact 的分层:底座零文案,
// 状态文案(空/加载/错误)在本业务层注入(v2 无 i18n,直接中文);slots 由调用方追加(如 footer)。
// 去掉建标签(v2 只从已有目录绑定)。

interface TagInfiniteSelectCommonProps {
  children: InfiniteComboboxChildren<BffTag>
  disabled?: boolean

  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void

  contentClassName?: string
  align?: 'start' | 'center' | 'end'

  pageSize?: number

  /** 多选时把 onChange 推迟到弹层关闭(每次会话一次提交)。 */
  commitOnClose?: boolean

  /**
   * 当前 value 对应的 tag 实体。预选标签可能落在已加载页之外,select 只对「见过」的 id 解析 —— 解析不到
   * 会被静默从提交里剔掉,整组替换的消费方就当成删除。把已知选中项传进来,保证每个预选 id 可解析。
   */
  selectedItems?: BffTag[]

  searchPlaceholder?: string

  /** 追加插槽(如底部条 InfiniteSelectFooter),接在内置状态插槽之后。 */
  slots?: ReactNode
}

export type TagInfiniteSelectProps = TagInfiniteSelectCommonProps & ControllableSelectionProps<BffTag>

export function TagInfiniteSelect(props: TagInfiniteSelectProps) {
  const { t } = useTranslation()
  const {
    children,
    disabled = false,
    contentClassName,
    align = 'start',
    pageSize,
    commitOnClose = false,
    searchPlaceholder = t('tagSelect.searchPlaceholder'),
    selectedItems,
    slots,
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

  // 把落在已加载页之外的预选标签并进来:关闭态查询是禁用的(list 为空),不并入的话触发器 chip 会空;
  // 并入也顺带把它们喂进底座缓存,保证提交时每个预选 id 可解析。但**仅在无活跃搜索时**并 —— 搜索时
  // 结果应纯粹(否则搜「厨房」还看见已选的「主卧」,空态也永不触发);已选项此前已进缓存,搜索期照样可提交。
  const listProps = useMemo(() => {
    if (combobox.queryValue) return list
    const loadedIds = new Set(list.items.map((tag) => tag.id))
    const missing = (selectedItems ?? []).filter((tag) => !loadedIds.has(tag.id))
    if (missing.length === 0) return list
    return { ...list, items: [...list.items, ...missing] }
  }, [list, selectedItems, combobox.queryValue])

  const getOption = useCallback(
    (tag: BffTag): InfiniteSelectOption => ({ id: tag.id, label: tag.displayName || tag.name }),
    [],
  )

  const selectionProps = getInfiniteComboboxSelectionProps<BffTag>(props)

  // 内置中文状态插槽(始终渲染,按状态自显示);调用方 slots 追加在其后(如 footer)。
  const stateSlots = (
    <InfiniteSelectStateSlots emptyText={t('tagSelect.empty')} loadingMoreText={t('tagSelect.loadingMore')} />
  )

  return (
    <InfiniteCombobox<BffTag>
      align={align}
      commitOnClose={props.multiple ? commitOnClose : false}
      contentClassName={contentClassName}
      disabled={disabled}
      getOption={getOption}
      list={listProps}
      searchPlaceholder={searchPlaceholder}
      slots={
        <>
          {stateSlots}
          {slots}
        </>
      }
      state={combobox}
      {...selectionProps}
    >
      {children}
    </InfiniteCombobox>
  )
}
