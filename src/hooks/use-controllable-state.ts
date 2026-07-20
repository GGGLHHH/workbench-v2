import type { SetStateAction } from 'react'

import { useControllableValue } from 'ahooks'

/**
 * Standard controlled/uncontrolled contract for `value` / `defaultValue` /
 * `onValueChange` shaped components.
 */
export interface ControllableStateProps<T> {
  value?: T
  defaultValue?: T
  onValueChange?: (value: T) => void
}

/**
 * Project wrapper around ahooks `useControllableValue` for trio-shaped components.
 *
 * Rules it encodes (see the "Controlled Components" engineering standard):
 * - Pass the component's ORIGINAL props object, never a rebuilt `{ value, ... }`
 *   literal. ahooks decides controlled mode by key presence, so rebuilding after
 *   destructuring re-adds every key and silently locks the component into
 *   controlled mode, killing its `defaultValue` / uncontrolled path.
 * - A controlled `value={undefined}` is normalized to `fallback` instead of being
 *   returned verbatim (ahooks ignores its own defaultValue in controlled mode,
 *   which otherwise surfaces as destructure crashes or `undefined` leaking into
 *   render). `fallback` is the component's "empty" representation; components
 *   where `undefined` itself is the legal empty value pass `undefined`.
 *
 * Components with non-standard prop names (`search`/`onSearchChange`,
 * `limit`/`onLimitChange`, ...) keep using ahooks `useControllableValue` directly.
 */
export function useControllableState<T>(
  props: ControllableStateProps<T>,
  fallback: T,
): [T, (value: SetStateAction<T>) => void] {
  const [state, setState] = useControllableValue<T>(props, {
    defaultValue: fallback,
    trigger: 'onValueChange',
  })

  return [state ?? fallback, setState]
}
