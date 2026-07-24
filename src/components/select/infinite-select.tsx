import { useControllableValue } from 'ahooks'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  type ChangeEvent,
  type ComponentProps,
  type ReactNode,
} from 'react'
import { useVirtualizer, type Virtualizer, type VirtualItem } from '@tanstack/react-virtual'
import { Check, Search } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { useScrollFade } from '@/lib/use-scroll-fade'
import { useSelectedItemsCache } from '@/components/select/use-selected-items-cache'

// 可搜索的无限列表内容(单/多选)。对齐 basereact 的组合式设计:底座零文案、零 i18n,状态与底部条
// 都走 children 插槽(context 驱动、按状态自渲染),文案由上层业务组件注入。相较 xchangeai-web 的
// emptyLabel/footer 一堆 prop,这里只有一个 children 通道。图标换 lucide-react、ScrollArea 用 v2 版。

export interface InfiniteSelectOption {
  id: string
  label: ReactNode
  disabled?: boolean
}

/** 自定义行渲染器拿到的上下文。 */
export interface InfiniteSelectItemRenderParams<T> {
  item: T
  option: InfiniteSelectOption
  selected: boolean
  isMultiple: boolean
  onSelect: () => void
}

interface InfiniteSelectCommonProps<T> {
  items: T[]

  isLoading?: boolean
  isFetchingNextPage?: boolean
  hasNextPage?: boolean
  isError?: boolean

  onLoadMore?: () => void
  onRetry?: () => void

  onSearchInputValueChange?: (value: string) => void
  searchInputValue?: string

  getOption: (item: T) => InfiniteSelectOption

  /** 替换默认行渲染,同时保留选中态与动作。 */
  renderItem?: (params: InfiniteSelectItemRenderParams<T>) => ReactNode

  searchPlaceholder?: string

  maxListHeight?: number
  className?: string
  /**
   * 唯一插槽通道:状态插槽(Empty/Loading/Error/LoadingMore,context 驱动、按状态自渲染)+
   * 底部条(InfiniteSelectFooter,作为最后一个子天然落底)。底层零文案 —— 文案由上层注入。
   */
  children?: ReactNode
}

/** 单/多选的受控/非受控选择 props。多选 onChange 双参:ids 权威(含未加载页),items 只回显已加载的。 */
export type ControllableSelectionProps<TItem = unknown> =
  | {
      multiple: true
      value?: string[]
      defaultValue?: string[]
      onChange?: (items: TItem[], ids: string[]) => void
    }
  | {
      multiple?: false
      value?: string
      defaultValue?: string
      onChange?: (item: TItem | undefined) => void
    }

export type InfiniteSelectProps<T> = InfiniteSelectCommonProps<T> & ControllableSelectionProps<T>

interface InfiniteSelectListProps<T> {
  items: T[]
  virtualizer: Virtualizer<HTMLDivElement, Element>
  virtualItems: VirtualItem[]
  getOption: (item: T) => InfiniteSelectOption
  renderItem?: (params: InfiniteSelectItemRenderParams<T>) => ReactNode
  isMultiple: boolean
  isSelected: (id: string) => boolean
  onSelect: (item: T, option: InfiniteSelectOption) => void
}

/** 列表状态消息容器(空/加载/错误/加载更多共用):muted 文字 + data-slot + role=status(a11y 播报)。 */
export function InfiniteSelectStatus({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('px-2 py-3 text-sm text-muted-foreground', className)}
      data-slot="infinite-select-status"
      role="status"
      {...props}
    />
  )
}

// ── 列表状态插槽:context 驱动、底层零文案。状态互斥,同一时刻至多一个 status 渲染;文案由上层注入。 ──
interface InfiniteSelectState {
  isLoading: boolean
  isError: boolean
  isEmpty: boolean
  isFetchingNextPage: boolean
  onRetry?: () => void
}

const InfiniteSelectStateContext = createContext<InfiniteSelectState | null>(null)

function useInfiniteSelectState(): InfiniteSelectState {
  const ctx = useContext(InfiniteSelectStateContext)
  if (!ctx) {
    throw new Error('InfiniteSelect 状态插槽必须用在 InfiniteSelect 的 children 内')
  }
  return ctx
}

/** 空态插槽:无结果时显示 children。 */
export function InfiniteSelectEmpty({ className, ...props }: ComponentProps<'div'>) {
  const { isEmpty } = useInfiniteSelectState()
  return isEmpty ? <InfiniteSelectStatus className={className} {...props} /> : null
}

/** 加载态插槽:首屏加载时显示 children。 */
export function InfiniteSelectLoading({ className, ...props }: ComponentProps<'div'>) {
  const { isLoading } = useInfiniteSelectState()
  return isLoading ? <InfiniteSelectStatus className={className} {...props} /> : null
}

/** 加载更多插槽:拉下一页时显示在列表底部。 */
export function InfiniteSelectLoadingMore({ className, ...props }: ComponentProps<'div'>) {
  const { isFetchingNextPage } = useInfiniteSelectState()
  return isFetchingNextPage ? (
    <InfiniteSelectStatus className={cn('py-1.5 text-center text-xs', className)} {...props} />
  ) : null
}

/** 错误态插槽:容器(内部放错误文案 + InfiniteSelectRetry)。 */
export function InfiniteSelectError({ className, ...props }: ComponentProps<'div'>) {
  const { isError } = useInfiniteSelectState()
  return isError ? (
    <InfiniteSelectStatus className={cn('flex flex-col items-center gap-2 py-4', className)} {...props} />
  ) : null
}

/** 重试按钮:调用底层 onRetry(无则不渲染)。放进 InfiniteSelectError 内,文案走 children。 */
export function InfiniteSelectRetry({ className, onClick, ...props }: ComponentProps<typeof Button>) {
  const { onRetry } = useInfiniteSelectState()
  if (!onRetry) return null
  return (
    <Button
      className={className}
      data-slot="infinite-select-retry"
      onClick={(event) => {
        onRetry()
        onClick?.(event)
      }}
      size="sm"
      type="button"
      variant="outline"
      {...props}
    />
  )
}

function InfiniteSelectList<T>({
  items,
  virtualizer,
  virtualItems,
  getOption,
  renderItem,
  isMultiple,
  isSelected,
  onSelect,
}: InfiniteSelectListProps<T>) {
  // 虚拟列表:relative sizer 撑总高,每行 absolute + translateY 定位,measureElement 动态测真实高度。
  return (
    <div style={{ position: 'relative', width: '100%', height: virtualizer.getTotalSize() }}>
      {virtualItems.map((vi) => {
        const item = items[vi.index]
        if (!item) return null
        const option = getOption(item)
        const selected = isSelected(option.id)
        const handleSelect = () => onSelect(item, option)
        return (
          <div
            key={vi.key}
            data-index={vi.index}
            ref={virtualizer.measureElement}
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vi.start}px)` }}
          >
            {renderItem ? (
              renderItem({ item, option, selected, isMultiple, onSelect: handleSelect })
            ) : (
              <button
                aria-pressed={selected}
                data-selected={selected ? '' : undefined}
                disabled={option.disabled}
                onClick={handleSelect}
                type="button"
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm/5 text-popover-foreground transition-colors',
                  'hover:bg-muted focus-visible:bg-muted focus-visible:outline-none',
                  !isMultiple && selected && 'bg-muted',
                  option.disabled && 'cursor-not-allowed opacity-50',
                )}
              >
                {isMultiple && (
                  <span
                    aria-hidden
                    data-slot="infinite-select-checkbox"
                    className={cn(
                      'flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors',
                      selected ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-background text-transparent',
                    )}
                  >
                    {selected && <Check className="size-3" />}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {!isMultiple && selected && <Check className="size-4 shrink-0 text-primary" />}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function InfiniteSelect<T>(props: InfiniteSelectProps<T>) {
  const {
    items,
    isLoading = false,
    isFetchingNextPage = false,
    hasNextPage = false,
    isError = false,
    onLoadMore,
    onRetry,
    onSearchInputValueChange,
    searchInputValue,
    getOption,
    renderItem,
    searchPlaceholder = 'Search',
    maxListHeight = 256,
    className,
    children,
  } = props

  const isMultiple = props.multiple === true

  const [selectedValue, setSelectedValue] = useControllableValue<string | string[] | undefined>(props, {
    defaultValue: isMultiple ? [] : undefined,
    trigger: '__infinite_select_no_op__',
  })

  // 多选时缓存见过的选中项(单选不需要,传空 selectedIds 即空转);toggle 时在 handleSelect 里直接增删这个 Map。
  const { cacheRef: selectedItemsCacheRef } = useSelectedItemsCache(
    items,
    getOption,
    isMultiple ? ((selectedValue as string[] | undefined) ?? []) : [],
  )

  const [searchDraft, setSearchDraft] = useControllableValue<string>(
    { onSearchInputValueChange, searchInputValue },
    { defaultValue: '', trigger: 'onSearchInputValueChange', valuePropName: 'searchInputValue' },
  )

  const handleSearchInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setSearchDraft(event.target.value)
    },
    [setSearchDraft],
  )

  const isSelected = useCallback(
    (id: string): boolean => {
      if (isMultiple) return ((selectedValue as string[] | undefined) ?? []).includes(id)
      return (selectedValue as string | undefined) === id
    },
    [isMultiple, selectedValue],
  )

  const handleSelect = useCallback(
    (item: T, option: InfiniteSelectOption) => {
      if (option.disabled) return

      if (props.multiple) {
        const currentIds = (selectedValue as string[] | undefined) ?? []
        const isToggleOff = currentIds.includes(option.id)
        const nextIds = isToggleOff ? currentIds.filter((id) => id !== option.id) : [...currentIds, option.id]

        if (isToggleOff) {
          selectedItemsCacheRef.current.delete(option.id)
        } else {
          selectedItemsCacheRef.current.set(option.id, item)
        }

        setSelectedValue(nextIds)

        const nextItems = nextIds
          .map((id) => selectedItemsCacheRef.current.get(id))
          .filter((entry): entry is T => entry !== undefined)
        // nextIds 权威(含未加载页);nextItems 只是已加载项的尽力回显。
        props.onChange?.(nextItems, nextIds)
        return
      }

      const currentId = selectedValue as string | undefined
      const isToggleOff = currentId === option.id
      setSelectedValue(isToggleOff ? undefined : option.id)
      props.onChange?.(isToggleOff ? undefined : item)
    },
    [selectedValue, setSelectedValue, props],
  )

  const viewportRef = useRef<HTMLDivElement | null>(null)
  useScrollFade(viewportRef, 'vertical') // 列表上下边缘渐隐,提示可滚
  const onLoadMoreRef = useRef(onLoadMore)
  useEffect(() => {
    onLoadMoreRef.current = onLoadMore
  }, [onLoadMore])

  // 虚拟滚动:只渲染视口内的行(目录可能很大)。行高不定(renderItem 可自定义)→ 动态测量。
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => 34,
    getItemKey: (index) => {
      const item = items[index]
      return item ? getOption(item).id : index
    },
    overscan: 8,
  })
  const virtualItems = virtualizer.getVirtualItems()

  // 触底加载下一页:渲染到最后一项(含 overscan)且还有下一页 → onLoadMore。取代原来的 IO sentinel。
  const lastIndex = virtualItems.length ? virtualItems[virtualItems.length - 1].index : -1
  useEffect(() => {
    if (lastIndex >= items.length - 1 && hasNextPage && !isFetchingNextPage) {
      onLoadMoreRef.current?.()
    }
  }, [lastIndex, items.length, hasNextPage, isFetchingNextPage])

  // 状态互斥:空态 = 非加载 / 非错误 / 无结果;有结果才渲染滚动列表。a11y 播报由状态插槽的 role=status 承担。
  const isEmpty = !isLoading && !isError && items.length === 0
  const hasItems = !isLoading && !isError && items.length > 0

  return (
    <div
      className={cn('flex w-full flex-col rounded-md border border-border bg-popover text-popover-foreground shadow-md', className)}
      data-slot="infinite-select"
    >
      <InfiniteSelectStateContext.Provider value={{ isLoading, isError, isEmpty, isFetchingNextPage, onRetry }}>
        <div className="flex items-center gap-2 border-b border-border px-3" data-slot="infinite-select-search">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            aria-label={typeof searchPlaceholder === 'string' ? searchPlaceholder : 'Search'}
            className="min-w-0 flex-1 bg-transparent py-2 text-sm/5 text-popover-foreground outline-none placeholder:text-muted-foreground"
            onChange={handleSearchInput}
            placeholder={searchPlaceholder}
            type="text"
            value={searchDraft}
          />
        </div>

        {/* ScrollArea 始终挂载(哪怕 loading/empty 内容为空、高度塌成 0)——viewport 一直在,
            useScrollFade 与 virtualizer 才能在挂载时就绑上 scrollElement(gate 在里面、晚挂载会绑空)。
            定高挂 Viewport(滚动容器本身):挂 Root 不行,size-full 的百分比高度撑不住 max-height,列表溢出压住 footer。 */}
        <ScrollArea viewportRef={viewportRef} viewportStyle={{ maxHeight: maxListHeight, overflowY: 'auto' }}>
          <div className="p-1">
            {hasItems ? (
              <InfiniteSelectList
                getOption={getOption}
                isMultiple={isMultiple}
                isSelected={isSelected}
                items={items}
                onSelect={handleSelect}
                renderItem={renderItem}
                virtualizer={virtualizer}
                virtualItems={virtualItems}
              />
            ) : null}
          </div>
        </ScrollArea>

        {/* 单通道:状态插槽 + 底部条(footer 作为最后一个子天然落底)。 */}
        {children}
      </InfiniteSelectStateContext.Provider>
    </div>
  )
}

// ── footer 动作(clear/cancel/close):Context 定义在底座层,由上层 InfiniteCombobox 填值。
//    放低层是刻意的:infinite-combobox 已依赖 infinite-select,hook/部件住这里才不会反向 import 成环。 ──

/** footer 内可消费的选择器动作。clear=清空选择、cancel=丢弃草稿还原、close=关弹层(commitOnClose 下即提交)。 */
export interface InfiniteSelectActions<T = unknown> {
  /** 已选项(仅已加载页的回显)。 */
  selectedItems: T[]
  /** 已选 id(权威全集,含未加载页)。 */
  selectedIds: string[]
  clear: () => void
  cancel: () => void
  close: () => void
}

const InfiniteSelectActionsContext = createContext<InfiniteSelectActions | null>(null)

/** 上层用它把 actions 灌进 footer 子树。 */
export function InfiniteSelectActionsProvider<T>({
  value,
  children,
}: {
  value: InfiniteSelectActions<T>
  children: ReactNode
}) {
  return (
    <InfiniteSelectActionsContext.Provider value={value as InfiniteSelectActions}>
      {children}
    </InfiniteSelectActionsContext.Provider>
  )
}

/** 在 InfiniteSelect 的 footer 内取 clear/cancel/close/当前选择。用在 footer 之外会抛错(fail-fast)。 */
export function useInfiniteSelectActions<T = unknown>(): InfiniteSelectActions<T> {
  const ctx = useContext(InfiniteSelectActionsContext)
  if (!ctx) {
    throw new Error('useInfiniteSelectActions 必须用在 InfiniteSelect 的 footer 内')
  }
  return ctx as InfiniteSelectActions<T>
}

/** 弹层底部动作条容器(shadcn 薄部件:data-slot + cn 合并 + 透传)。塞进 InfiniteSelect 的 children。 */
export function InfiniteSelectFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex items-stretch border-t border-border', className)}
      data-slot="infinite-select-footer"
      {...props}
    />
  )
}

/** 清空按钮:清空选择 + 关弹层(commitOnClose 下即提交空)。标签走 children。 */
export function InfiniteSelectClearButton({ className, onClick, ...props }: ComponentProps<typeof Button>) {
  const { clear, close } = useInfiniteSelectActions()
  return (
    <Button
      className={cn('flex-1 rounded-none text-muted-foreground', className)}
      data-slot="infinite-select-clear"
      onClick={(event) => {
        clear()
        close()
        onClick?.(event)
      }}
      type="button"
      variant="ghost"
      {...props}
    />
  )
}

/** 取消按钮:丢弃草稿还原到已提交值 + 关弹层(不提交)。标签走 children。 */
export function InfiniteSelectCancelButton({ className, onClick, ...props }: ComponentProps<typeof Button>) {
  const { cancel } = useInfiniteSelectActions()
  return (
    <Button
      className={cn('flex-1 rounded-none text-muted-foreground', className)}
      data-slot="infinite-select-cancel"
      onClick={(event) => {
        cancel()
        onClick?.(event)
      }}
      type="button"
      variant="ghost"
      {...props}
    />
  )
}

/** 确认按钮:关弹层(commitOnClose 下即提交当前草稿)。标签走 children。 */
export function InfiniteSelectConfirmButton({ className, onClick, ...props }: ComponentProps<typeof Button>) {
  const { close } = useInfiniteSelectActions()
  return (
    <Button
      className={cn('flex-1 rounded-none font-medium text-primary', className)}
      data-slot="infinite-select-confirm"
      onClick={(event) => {
        close()
        onClick?.(event)
      }}
      type="button"
      variant="ghost"
      {...props}
    />
  )
}
