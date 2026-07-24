import { useState } from 'react'

/**
 * 二次确认状态机:第一次点某个目标只「武装」(换文案/变红),再点同一目标才真正执行;
 * 失焦 / 菜单关闭时 disarm 归零。UI(图标、颜色、接 onBlur 还是 onOpenChange)留各自组件,
 * 这里只统一 armed-then-fire 的状态本体(原先在 status-menu / asset-grid / comment-pane 各写一遍)。
 */
export function useConfirmAction<T>() {
  const [armed, setArmed] = useState<T | null>(null)
  return {
    armed,
    // 点已武装的目标 → 执行并解除;否则只武装(第一次点)。
    trigger: (id: T, onConfirm: () => void) => {
      if (armed === id) {
        setArmed(null)
        onConfirm()
      } else {
        setArmed(id)
      }
    },
    disarm: () => setArmed(null),
  }
}
