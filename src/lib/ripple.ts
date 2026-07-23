import type { EditorStarterItem } from '@gedatou/shared'

// 换块时长后消除同轨的重叠/空白:把同一轨、位于原块末尾(oldEnd)之后的块整体顺移 delta
// (= 新时长 − 旧时长),保持它们彼此的相对间距。纯函数、无副作用,便于单测;replace-clip 在
// store 更新闭包里调用它。原本紧邻的块顺移后仍紧邻(from === 新块末尾),原有间隔也原样保留。
export const rippleAfterResize = (
  items: Record<string, EditorStarterItem>,
  itemId: string,
  trackId: string,
  oldEnd: number,
  delta: number,
): Record<string, EditorStarterItem> => {
  if (delta === 0) return items
  const next = { ...items }
  for (const other of Object.values(items)) {
    if (other.id !== itemId && other.trackId === trackId && other.from >= oldEnd) {
      next[other.id] = { ...other, from: other.from + delta }
    }
  }
  return next
}
