import { useEffect, useRef } from 'react'
import { useSearch } from '@tanstack/react-router'
import type { UndoableState } from '@gedatou/shared'
import {
  EditorRoot,
  createEditorStore,
  createInstanceRefs,
  restoreLocalUrls,
} from '@gedatou/editor'
import { createHttpTransport, createBrowserStorage } from '@gedatou/editor/adapters'
import { useProject, useSaveProject } from '@/api/projects/projects'
import { sonnerNotify } from '@/notify'
import { buildDemoState } from '@/demo-state'

// 编辑器单例(模块级,首次进入 '/' 路由时按需加载),跟随侧边栏选中的项目。
// store 与 storage 在 React 外面,当前项目的保存函数靠这个可变 ref 从 EditorApp 过桥进来:
// 选中项目 → 存回 BFF;无选中 → 回落 localStorage(保留接线前的 demo 行为)。
const projectRef: { save: ((state: UndoableState) => void) | null } = { save: null }

const transport = createHttpTransport()
const browser = createBrowserStorage()
// 只包 saveProject 一个方法。库里保存(Cmd+S)是显式触发、非自动存,所以接 BFF 不会频繁写库。
// 素材本地缓存(get/put/deleteAsset)与 loadProject 兜底照旧用 browser 实现。
const storage = {
  ...browser,
  saveProject: (state: UndoableState) => (projectRef.save ?? browser.saveProject)(state),
}
const deps = { transport, storage, notify: sonnerNotify }

// 无选中项目时的占位工程:localStorage 恢复,回退 demo。选中项目后由 EditorApp 重置成该工程。
const initialState = (browser.loadProject() as UndoableState | null) ?? buildDemoState()
const editorStore = createEditorStore({ undoable: initialState })
editorStore.setState({ lastSavedState: initialState })
void restoreLocalUrls(editorStore, deps, initialState)
const editorRefs = createInstanceRefs()

if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__editorStore = editorStore
  ;(window as unknown as Record<string, unknown>).__playerRef = editorRefs.player
}

export function EditorApp() {
  const { project: id } = useSearch({ from: '/' })
  const detail = useProject(id ?? null)
  const saveMutate = useSaveProject().mutate

  // 保存函数随选中项目刷新(saveMutate 引用稳定)。库触发 saveProject → PUT /bff/projects/:id。
  useEffect(() => {
    projectRef.save = id
      ? (state) => saveMutate({ id, request: { state: state as unknown as Record<string, unknown> } })
      : null
  }, [id, saveMutate])

  // 切项目:该工程时间轴首次到达时把编辑器 store 重置为它(沿用库自身 loadStateFromFile 的重置约定)。
  // loadedIdRef 守护 —— 保存后 detail 失效重拉(同一 id)不再二次重置,避免清空 undo 历史/选择。
  const loadedIdRef = useRef<string | null>(null)
  const state = detail.data?.state as unknown as UndoableState | undefined
  useEffect(() => {
    if (!state || loadedIdRef.current === id) return
    loadedIdRef.current = id ?? null
    editorStore.setState({ undoable: state, lastSavedState: state, past: [], future: [], selectedItemIds: [] })
    void restoreLocalUrls(editorStore, deps, state)
    // ponytail: 直接重置会丢弃未保存改动(gotcha #5,脏检查/切换确认待产品拍板后单独接)
  }, [id, state])

  return <EditorRoot store={editorStore} refs={editorRefs} deps={deps} />
}
