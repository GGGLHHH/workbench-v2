import { createContext, useContext } from 'react'
import type { Panel } from '@/components/project-nav/types'

// 稳定回调集中到一个 context —— value 由 ProjectNav 用 useMemo 包一次,identity 恒定,
// 读它的组件永不因它重渲染。易变值(search/selectedId/counts)不进这里,叶子就地读 hook。
export type NavActions = {
  selectProject: (id: string) => void
  changeProjectStatus: (id: string, action: string) => void
  onSearch: (v: string) => void
  onAssigneeChange: (v: string) => void
  onSortChange: (v: string) => void
  refreshStats: () => void
  openPanel: (panel: Panel) => void
  collapse: () => void
  toggleCollapse: () => void
  backToList: () => void
}

const NavActionsContext = createContext<NavActions | null>(null)
export const NavActionsProvider = NavActionsContext.Provider
export function useNavActions(): NavActions {
  const ctx = useContext(NavActionsContext)
  if (!ctx) throw new Error('useNavActions must be used within <ProjectNav>')
  return ctx
}

// 状态变更 mutation 的 pending id —— 真正跨 card/detail 共享的易变态,单独一个小 context,
// 仅在用户点状态操作那一下才变(~200ms、罕见),只让 card/detail 订阅、不污染 NavActions。
const StatusChangingContext = createContext<string | null>(null)
export const StatusChangingProvider = StatusChangingContext.Provider
export const useStatusChangingId = (): string | null => useContext(StatusChangingContext)
