import { useCallback, useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import type { BffPromptPreset } from '@/generated/api-types'
import { useInfinitePromptPresetOptions } from '@/api/prompt-presets'
import {
  InfiniteCombobox,
  getInfiniteComboboxSelectionProps,
  useInfiniteComboboxState,
  type InfiniteComboboxChildren,
} from '@/components/select/infinite-combobox'
import {
  InfiniteSelectEmpty,
  InfiniteSelectError,
  InfiniteSelectLoading,
  InfiniteSelectLoadingMore,
  InfiniteSelectRetry,
  type ControllableSelectionProps,
  type InfiniteSelectOption,
} from '@/components/select/infinite-select'

// 预设 prompt 专用 select:预设目录查询 + InfiniteCombobox 基座。与 TagInfiniteSelect 同构 ——
// 底座零文案,状态文案(空/加载/错误)在本业务层注入(v2 无 i18n,直接中文);slots 由调用方追加。
// 只读目录(v2 不建预设),label 用预设名。

interface PromptPresetInfiniteSelectCommonProps {
  children: InfiniteComboboxChildren<BffPromptPreset>
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
   * 当前 value 对应的预设实体。预选项可能落在已加载页之外,select 只对「见过」的 id 解析 —— 解析不到
   * 会被静默剔掉。把已知选中项传进来,保证每个预选 id 可解析。
   */
  selectedItems?: BffPromptPreset[]

  searchPlaceholder?: string

  /** 追加插槽(如底部条),接在内置状态插槽之后。 */
  slots?: ReactNode
}

export type PromptPresetInfiniteSelectProps = PromptPresetInfiniteSelectCommonProps &
  ControllableSelectionProps<BffPromptPreset>

export function PromptPresetInfiniteSelect(props: PromptPresetInfiniteSelectProps) {
  const { t } = useTranslation()
  const {
    children,
    disabled = false,
    contentClassName,
    align = 'start',
    pageSize,
    commitOnClose = false,
    searchPlaceholder = t('promptPresetSelect.searchPlaceholder'),
    selectedItems,
    slots,
  } = props

  const combobox = useInfiniteComboboxState({
    defaultOpen: props.defaultOpen,
    onOpenChange: props.onOpenChange,
    open: props.open,
  })

  const list = useInfinitePromptPresetOptions({
    search: combobox.queryValue,
    pageSize,
    enabled: combobox.open,
  })

  // 把落在已加载页之外的预选项并进来(仅无活跃搜索时),保证触发器 chip 与提交解析不丢。见 TagInfiniteSelect。
  const listProps = useMemo(() => {
    if (combobox.queryValue) return list
    const loadedIds = new Set(list.items.map((p) => p.id))
    const missing = (selectedItems ?? []).filter((p) => !loadedIds.has(p.id))
    if (missing.length === 0) return list
    return { ...list, items: [...list.items, ...missing] }
  }, [list, selectedItems, combobox.queryValue])

  const getOption = useCallback((p: BffPromptPreset): InfiniteSelectOption => ({ id: p.id, label: p.name }), [])

  const selectionProps = getInfiniteComboboxSelectionProps<BffPromptPreset>(props)

  const stateSlots = (
    <>
      <InfiniteSelectEmpty>{t('promptPresetSelect.empty')}</InfiniteSelectEmpty>
      <InfiniteSelectLoading>{t('common.loading')}</InfiniteSelectLoading>
      <InfiniteSelectLoadingMore>{t('promptPresetSelect.loadingMore')}</InfiniteSelectLoadingMore>
      <InfiniteSelectError>
        {t('common.loadFailed')}
        <InfiniteSelectRetry>{t('common.retry')}</InfiniteSelectRetry>
      </InfiniteSelectError>
    </>
  )

  return (
    <InfiniteCombobox<BffPromptPreset>
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
