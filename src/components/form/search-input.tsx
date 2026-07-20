import * as React from 'react'

import { useDebounceFn } from 'ahooks'
import { Search } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { useControllableState } from '@/hooks/use-controllable-state'
import { cn } from '@/lib/utils'

interface SearchInputProps
  extends Omit<
    React.ComponentProps<typeof Input>,
    'className' | 'defaultValue' | 'onChange' | 'type' | 'value'
  > {
  className?: string
  debounceMs?: number
  defaultValue?: string
  inputClassName?: string
  onValueChange?: (value: string) => void
  value?: string
}

function SearchInput(allProps: SearchInputProps) {
  const {
    className,
    debounceMs = 300,
    defaultValue: _defaultValue,
    inputClassName,
    onValueChange,
    placeholder = 'Search',
    value: _value,
    ...props
  } = allProps
  const onValueChangeRef = React.useRef(onValueChange)
  // 只读取受控/默认值来同步内部草稿；提交走下方防抖的 onValueChangeRef，
  // 不使用 hook 的 setter（否则每次按键都会立即触发 onValueChange）。
  const [controlledValue] = useControllableState<string>(allProps, '')
  const [draftValue, setDraftValue] = React.useState(controlledValue)
  const draftValueRef = React.useRef(draftValue)

  React.useEffect(() => {
    onValueChangeRef.current = onValueChange
  }, [onValueChange])

  React.useEffect(() => {
    draftValueRef.current = draftValue
  }, [draftValue])

  React.useEffect(() => {
    setDraftValue(controlledValue)
  }, [controlledValue])

  const { run: emitSearch, cancel } = useDebounceFn(
    (nextValue: string) => {
      if (draftValueRef.current !== nextValue) return
      onValueChangeRef.current?.(nextValue)
    },
    { wait: debounceMs },
  )

  React.useEffect(() => cancel, [cancel])

  const handleChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const nextValue = event.target.value
      setDraftValue(nextValue)
      emitSearch(nextValue)
    },
    [emitSearch],
  )

  return (
    <div className={cn('relative w-full', className)}>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        {...props}
        type="text"
        value={draftValue}
        placeholder={placeholder}
        className={cn('h-9 bg-background pr-3 pl-9', inputClassName)}
        onChange={handleChange}
      />
    </div>
  )
}

export { SearchInput }
