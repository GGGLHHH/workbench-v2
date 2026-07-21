import { useControllableValue, useDebounceFn } from 'ahooks'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'

import type { InfiniteSelectAdapterProps } from '@/components/select/use-infinite-list'

import {
  InfiniteSelect,
  InfiniteSelectActionsProvider,
  type ControllableSelectionProps,
  type InfiniteSelectActions,
  type InfiniteSelectItemRenderParams,
  type InfiniteSelectOption,
} from '@/components/select/infinite-select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

// 无限下拉组合框:受控 Popover 包住 InfiniteSelect + 防抖搜索 + 「关闭时一次性提交」。对齐 basereact:
// footer 的 clear/cancel/close 经 InfiniteSelectActions context 供给(不再是 render-prop),slots 单通道透传。

export interface InfiniteComboboxStateOptions {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  searchValue?: string
  defaultSearchValue?: string
  onSearchValueChange?: (value: string) => void
  queryValue?: string
  defaultQueryValue?: string
  onQueryValueChange?: (value: string | undefined) => void
  debounceMs?: number
}

export interface InfiniteComboboxState<T = unknown> {
  open: boolean
  setOpen: (open: boolean) => void
  searchValue: string
  setSearchValue: (value: string) => void
  resetSearch: () => void
  queryValue: string | undefined
  selectedValue?: string | string[] | undefined
  selectedItems?: T[]
}

export function useInfiniteComboboxState({
  open,
  defaultOpen,
  onOpenChange,
  searchValue,
  defaultSearchValue,
  onSearchValueChange,
  queryValue,
  defaultQueryValue,
  onQueryValueChange,
  debounceMs = 300,
}: InfiniteComboboxStateOptions = {}): InfiniteComboboxState {
  const openProps: { open?: boolean; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void } = {}
  if (open !== undefined) openProps.open = open
  if (defaultOpen !== undefined) openProps.defaultOpen = defaultOpen
  if (onOpenChange) openProps.onOpenChange = onOpenChange

  const [openState, setOpenState] = useControllableValue<boolean>(openProps, {
    defaultValue: false,
    defaultValuePropName: 'defaultOpen',
    trigger: 'onOpenChange',
    valuePropName: 'open',
  })

  const searchProps: { searchValue?: string; defaultSearchValue?: string; onSearchValueChange?: (value: string) => void } = {}
  if (searchValue !== undefined) searchProps.searchValue = searchValue
  if (defaultSearchValue !== undefined) searchProps.defaultSearchValue = defaultSearchValue
  if (onSearchValueChange) searchProps.onSearchValueChange = onSearchValueChange

  const [inputValue, setInputValue] = useControllableValue<string>(searchProps, {
    defaultValue: '',
    defaultValuePropName: 'defaultSearchValue',
    trigger: 'onSearchValueChange',
    valuePropName: 'searchValue',
  })

  const queryProps: { queryValue?: string; defaultQueryValue?: string; onQueryValueChange?: (value: string | undefined) => void } = {}
  if (queryValue !== undefined) queryProps.queryValue = queryValue
  if (defaultQueryValue !== undefined) queryProps.defaultQueryValue = defaultQueryValue
  if (onQueryValueChange) queryProps.onQueryValueChange = onQueryValueChange

  const [queryState, setQueryState] = useControllableValue<string | undefined>(queryProps, {
    defaultValue: undefined,
    defaultValuePropName: 'defaultQueryValue',
    trigger: 'onQueryValueChange',
    valuePropName: 'queryValue',
  })

  const { run: emitQueryValue, cancel: cancelQueryValue } = useDebounceFn(
    (value: string) => {
      setQueryState(value === '' ? undefined : value)
    },
    { wait: debounceMs },
  )

  useEffect(() => cancelQueryValue, [cancelQueryValue])

  const setSearchValue = useCallback(
    (value: string) => {
      setInputValue(value)
      emitQueryValue(value)
    },
    [emitQueryValue, setInputValue],
  )

  const resetSearch = useCallback(() => {
    cancelQueryValue()
    setInputValue('')
    setQueryState(undefined)
  }, [cancelQueryValue, setInputValue, setQueryState])

  const shouldResetOnNextOpenRef = useRef(false)
  const prevOpenRef = useRef<boolean | undefined>(undefined)

  const setOpen = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen && shouldResetOnNextOpenRef.current) {
        resetSearch()
        shouldResetOnNextOpenRef.current = false
      }
      if (!nextOpen) {
        shouldResetOnNextOpenRef.current = true
      }
      setOpenState(nextOpen)
    },
    [resetSearch, setOpenState],
  )

  useLayoutEffect(() => {
    const wasOpen = prevOpenRef.current
    prevOpenRef.current = openState

    if (wasOpen === true && !openState) {
      shouldResetOnNextOpenRef.current = true
      return
    }

    if (wasOpen === false && openState && shouldResetOnNextOpenRef.current) {
      resetSearch()
      shouldResetOnNextOpenRef.current = false
    }
  }, [openState, resetSearch])

  return {
    open: openState,
    queryValue: queryState,
    resetSearch,
    searchValue: inputValue,
    setOpen,
    setSearchValue,
  }
}

export type InfiniteComboboxChildren<T> = ReactElement | ((params: InfiniteComboboxState<T>) => ReactElement)

interface InfiniteComboboxCommonProps<T> {
  children: InfiniteComboboxChildren<T>
  state: InfiniteComboboxState
  list: InfiniteSelectAdapterProps<T>
  getOption: (item: T) => InfiniteSelectOption
  renderItem?: (params: InfiniteSelectItemRenderParams<T>) => ReactNode
  disabled?: boolean
  contentClassName?: string
  align?: 'start' | 'center' | 'end'
  commitOnClose?: boolean
  searchPlaceholder?: string
  /**
   * 唯一插槽通道:状态插槽 + 底部条,原样透传给 InfiniteSelect 的 children。
   * 文案由上层注入;footer 内的 clear/cancel/close 用 useInfiniteSelectActions()。
   */
  slots?: ReactNode
  maxListHeight?: number
  closeOnSelect?: boolean
  selectClassName?: string
}

export type InfiniteComboboxProps<T> = InfiniteComboboxCommonProps<T> & ControllableSelectionProps<T>

export function getInfiniteComboboxSelectionProps<T>(props: ControllableSelectionProps<T>): ControllableSelectionProps<T> {
  if (props.multiple) {
    return {
      ...(props.value !== undefined ? { value: props.value } : {}),
      ...(props.defaultValue !== undefined ? { defaultValue: props.defaultValue } : {}),
      multiple: true,
      onChange: props.onChange,
    }
  }

  return {
    ...(props.value !== undefined ? { value: props.value } : {}),
    ...(props.defaultValue !== undefined ? { defaultValue: props.defaultValue } : {}),
    onChange: props.onChange,
  }
}

export function InfiniteCombobox<T>(props: InfiniteComboboxProps<T>) {
  const {
    align = 'start',
    children,
    commitOnClose = false,
    contentClassName,
    disabled = false,
    getOption,
    list,
    maxListHeight,
    renderItem,
    searchPlaceholder = 'Search',
    slots,
    state,
    closeOnSelect = true,
    selectClassName,
  } = props

  const isMultiple = props.multiple === true
  const deferredEnabled = isMultiple && commitOnClose
  const [selectedValue, setSelectedValue] = useControllableValue<string | string[] | undefined>(props, {
    defaultValue: isMultiple ? [] : undefined,
    trigger: '__infinite_combobox_no_op__',
  })
  const externalMultiValue = (props as { value?: string[] }).value
  const externalDefaultMulti = (props as { defaultValue?: string[] }).defaultValue
  const externalValueRef = useRef(externalMultiValue)
  externalValueRef.current = externalMultiValue

  const [draftIds, setDraftIds] = useState<string[]>(() => externalMultiValue ?? externalDefaultMulti ?? [])
  const draftItemsRef = useRef<T[]>([])
  const draftIdsRef = useRef<string[]>([])
  const hasChangedRef = useRef(false)
  const prevOpenRef = useRef<boolean | undefined>(undefined)
  const selectedItemsCacheRef = useRef<Map<string, T>>(new Map())

  const effectiveSelectedValue = deferredEnabled ? draftIds : selectedValue
  const selectedIds = isMultiple
    ? ((effectiveSelectedValue as string[] | undefined) ?? [])
    : effectiveSelectedValue
      ? [effectiveSelectedValue as string]
      : []

  for (const item of list.items) {
    const id = getOption(item).id
    if (selectedIds.includes(id)) {
      selectedItemsCacheRef.current.set(id, item)
    }
  }

  const selectedItems = selectedIds
    .map((id) => selectedItemsCacheRef.current.get(id))
    .filter((entry): entry is T => entry !== undefined)

  useEffect(() => {
    const wasOpen = prevOpenRef.current
    prevOpenRef.current = state.open
    if (!deferredEnabled) return

    const justClosed = wasOpen === true && !state.open
    const justCommitted = justClosed && hasChangedRef.current
    if (justCommitted) {
      // draftIdsRef 权威(来自 InfiniteSelect);draftItemsRef 只回显已加载的。
      const ids = draftIdsRef.current
      setSelectedValue(ids)
      ;(props as { onChange?: (items: T[], ids: string[]) => void }).onChange?.(draftItemsRef.current, ids)
      hasChangedRef.current = false
    }

    // 刚提交完不要立刻还原成外部值:父层还没吃到 onChange,externalValueRef 是旧的 —— draftIds 已是提交后的 ids。
    if (!justCommitted && (wasOpen === undefined || justClosed)) {
      const externalValue = externalValueRef.current
      if (externalValue !== undefined) {
        setDraftIds(externalValue)
        if (!justClosed) {
          hasChangedRef.current = false
        }
      }
    }
  }, [deferredEnabled, props, setSelectedValue, state.open])

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (disabled && next) return
      state.setOpen(next)
    },
    [disabled, state],
  )

  const clearSelection = useCallback(() => {
    if (deferredEnabled) {
      // 草稿路:清空草稿并标记「变过」,关弹层的 useEffect 便提交空集。
      setDraftIds([])
      draftIdsRef.current = []
      draftItemsRef.current = []
      hasChangedRef.current = true
      return
    }
    if (props.multiple) {
      setSelectedValue([])
      props.onChange?.([], [])
    } else {
      setSelectedValue(undefined)
      props.onChange?.(undefined)
    }
  }, [deferredEnabled, props, setSelectedValue])

  const cancelSelection = useCallback(() => {
    // 丢弃草稿、还原到已提交值,清「变过」标记 → 关闭时不提交。非草稿路无草稿可丢,直接关。
    if (deferredEnabled) {
      const committed = externalValueRef.current ?? []
      hasChangedRef.current = false
      setDraftIds(committed)
      draftIdsRef.current = committed
    }
    state.setOpen(false)
  }, [deferredEnabled, state])

  // footer 里的 clear/cancel/close 经 Context 供给(shadcn 组合式)。Context 定义在底座 infinite-select
  // (避免反向 import 成环),这里只填值。
  const actions: InfiniteSelectActions<T> = {
    selectedItems,
    selectedIds,
    clear: clearSelection,
    cancel: cancelSelection,
    close: () => state.setOpen(false),
  }

  const trigger =
    typeof children === 'function'
      ? children({ ...state, selectedItems, selectedValue: effectiveSelectedValue as string | string[] | undefined })
      : children

  return (
    <Popover open={state.open} onOpenChange={handleOpenChange}>
      <PopoverTrigger render={trigger} />
      <PopoverContent
        align={align}
        className={cn(
          // 保留 ui/popover 的外观(rounded bg-popover shadow ring),清掉默认内边距,让 InfiniteSelect 贴边;
          // w-(--anchor-width) 跟锚点等宽,ring-inset 把 1px 环画在内侧。
          'w-(--anchor-width) min-w-72 overflow-hidden p-0 ring-inset',
          contentClassName,
        )}
        sideOffset={4}
      >
        <InfiniteSelectActionsProvider value={actions}>
          {props.multiple ? (
            <InfiniteSelect<T>
              {...list}
              getOption={getOption}
              maxListHeight={maxListHeight}
              multiple
              className={selectClassName}
              onChange={(items, ids) => {
                if (deferredEnabled) {
                  setDraftIds(ids)
                  draftItemsRef.current = items
                  draftIdsRef.current = ids
                  hasChangedRef.current = true
                  return
                }
                setSelectedValue(ids)
                props.onChange?.(items, ids)
              }}
              onSearchInputValueChange={state.setSearchValue}
              renderItem={renderItem}
              searchInputValue={state.searchValue}
              searchPlaceholder={searchPlaceholder}
              value={deferredEnabled ? draftIds : ((selectedValue as string[] | undefined) ?? [])}
            >
              {slots}
            </InfiniteSelect>
          ) : (
            <InfiniteSelect<T>
              {...list}
              getOption={getOption}
              maxListHeight={maxListHeight}
              className={selectClassName}
              onChange={(item) => {
                setSelectedValue(item ? getOption(item).id : undefined)
                props.onChange?.(item)
                if (closeOnSelect) {
                  state.setOpen(false)
                }
              }}
              onSearchInputValueChange={state.setSearchValue}
              renderItem={renderItem}
              searchInputValue={state.searchValue}
              searchPlaceholder={searchPlaceholder}
              value={selectedValue as string | undefined}
            >
              {slots}
            </InfiniteSelect>
          )}
        </InfiniteSelectActionsProvider>
      </PopoverContent>
    </Popover>
  )
}
