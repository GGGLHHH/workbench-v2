import { useControllableValue, useDebounceFn } from 'ahooks'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { reject } from 'ramda'

import type { InfiniteSelectAdapterProps } from '@/lib/use-infinite-list'

import {
  InfiniteSelect,
  type ControllableSelectionProps,
  type InfiniteSelectItemRenderParams,
  type InfiniteSelectOption,
} from '@/components/select/infinite-select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

// 无限下拉组合框:一个受控 Popover 包住 InfiniteSelect,再加防抖搜索 + 「关闭时一次性提交」。
// 从 xchangeai-web 移植(仅换 import 路径;v2 的 Popover 同为 base-ui 封装,render/--anchor-width 兼容)。

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

export type InfiniteComboboxChildren<T> = ReactNode | ((params: InfiniteComboboxState<T>) => ReactNode)

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
  emptyLabel?: ReactNode
  loadingLabel?: ReactNode
  loadingMoreLabel?: ReactNode
  errorLabel?: ReactNode
  retryLabel?: ReactNode
  maxListHeight?: number
  closeOnSelect?: boolean
  footer?: ReactNode
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
    emptyLabel,
    errorLabel,
    getOption,
    list,
    loadingLabel,
    loadingMoreLabel,
    maxListHeight,
    renderItem,
    retryLabel,
    searchPlaceholder = 'Search',
    state,
    closeOnSelect = true,
    footer,
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

  const selectedItems = reject<T | undefined, undefined>(
    (item): item is undefined => item === undefined,
    selectedIds.map((id) => selectedItemsCacheRef.current.get(id)),
  )

  useEffect(() => {
    const wasOpen = prevOpenRef.current
    prevOpenRef.current = state.open
    if (!deferredEnabled) return

    const justClosed = wasOpen === true && !state.open
    if (justClosed && hasChangedRef.current) {
      const nextIds = draftItemsRef.current.map((item) => getOption(item).id)
      setSelectedValue(nextIds)
      ;(props as { onChange?: (items: T[]) => void }).onChange?.(draftItemsRef.current)
      hasChangedRef.current = false
    }

    // 每次打开时(不是挂载/关闭时)播种草稿:受控 value 可能异步落定(服务端态)或因提交本身推进,
    // 挂载/关闭时播种会让下一次会话的草稿落后一次提交 —— 切换就会静默丢掉这中间做的选择。
    if (wasOpen !== true && state.open) {
      const externalValue = externalValueRef.current
      if (externalValue !== undefined) {
        setDraftIds(externalValue)
        hasChangedRef.current = false
      }
    }
  }, [deferredEnabled, getOption, props, setSelectedValue, state.open])

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (disabled && next) return
      state.setOpen(next)
    },
    [disabled, state],
  )

  const trigger =
    typeof children === 'function'
      ? children({ ...state, selectedItems, selectedValue: effectiveSelectedValue as string | string[] | undefined })
      : children

  return (
    <Popover open={state.open} onOpenChange={handleOpenChange}>
      <PopoverTrigger render={trigger as ReactElement} />
      <PopoverContent
        align={align}
        className={cn(
          // 保留 ui/popover 的外观(rounded bg-popover shadow ring),但清掉默认内边距/间距,
          // 让 InfiniteSelect 自己贴边;w-(--anchor-width) 跟锚点(触发字段)等宽,ring-inset 把 1px 环画在内侧。
          'w-(--anchor-width) min-w-72 overflow-hidden p-0 ring-inset',
          contentClassName,
        )}
        sideOffset={4}
      >
        {isMultiple ? (
          <InfiniteSelect<T>
            {...list}
            emptyLabel={emptyLabel}
            errorLabel={errorLabel}
            getOption={getOption}
            loadingLabel={loadingLabel}
            loadingMoreLabel={loadingMoreLabel}
            maxListHeight={maxListHeight}
            multiple
            className={selectClassName}
            footer={footer}
            onChange={(items) => {
              const nextIds = items.map((item) => getOption(item).id)
              if (deferredEnabled) {
                setDraftIds(nextIds)
                draftItemsRef.current = items
                hasChangedRef.current = true
                return
              }
              setSelectedValue(nextIds)
              ;(props as { onChange?: (items: T[]) => void }).onChange?.(items)
            }}
            onSearchInputValueChange={state.setSearchValue}
            renderItem={renderItem}
            retryLabel={retryLabel}
            searchInputValue={state.searchValue}
            searchPlaceholder={searchPlaceholder}
            value={deferredEnabled ? draftIds : ((selectedValue as string[] | undefined) ?? [])}
          />
        ) : (
          <InfiniteSelect<T>
            {...list}
            emptyLabel={emptyLabel}
            errorLabel={errorLabel}
            getOption={getOption}
            loadingLabel={loadingLabel}
            loadingMoreLabel={loadingMoreLabel}
            maxListHeight={maxListHeight}
            className={selectClassName}
            footer={footer}
            onChange={(item) => {
              setSelectedValue(item ? getOption(item).id : undefined)
              ;(props as { onChange?: (item: T | undefined) => void }).onChange?.(item)
              if (closeOnSelect) {
                state.setOpen(false)
              }
            }}
            onSearchInputValueChange={state.setSearchValue}
            renderItem={renderItem}
            retryLabel={retryLabel}
            searchInputValue={state.searchValue}
            searchPlaceholder={searchPlaceholder}
            value={selectedValue as string | undefined}
          />
        )}
      </PopoverContent>
    </Popover>
  )
}
