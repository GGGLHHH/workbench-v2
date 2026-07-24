import { useRef } from 'react'

// 以 id 为权威、items 尽力回显:选中项可能落在未加载页外,基座只能解析「见过」的 id。
// 一个 Map 缓存见过的项,遍历当前 items 命中 selectedIds 就收进缓存,再按 selectedIds 取回。
// InfiniteSelect 与 InfiniteCombobox 原各写一遍这段;返回 cache 供 InfiniteSelect 在 toggle 时增删。
export function useSelectedItemsCache<T>(
  items: T[],
  getOption: (item: T) => { id: string },
  selectedIds: string[],
) {
  const cacheRef = useRef<Map<string, T>>(new Map())
  for (const item of items) {
    const id = getOption(item).id
    if (selectedIds.includes(id)) cacheRef.current.set(id, item)
  }
  const selectedItems = selectedIds
    .map((id) => cacheRef.current.get(id))
    .filter((entry): entry is T => entry !== undefined)
  // 返回 ref 而非 .current:InfiniteSelect 的 handleSelect 要在其中增删,ref 稳定身份不进 deps。
  return { selectedItems, cacheRef }
}
