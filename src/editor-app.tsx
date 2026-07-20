import type { UndoableState } from '@gedatou/shared'
import {
  EditorRoot,
  createEditorStore,
  createInstanceRefs,
  restoreLocalUrls,
} from '@gedatou/editor'
import { createHttpTransport, createBrowserStorage } from '@gedatou/editor/adapters'
import { sonnerNotify } from '@/notify'
import { buildDemoState } from '@/demo-state'

// 编辑器单例(模块级,首次进入 '/' 路由时按需加载)。
// 现阶段仍用 localStorage/demo;接 BFF projects 读写是后续单独的一步。
const transport = createHttpTransport()
const storage = createBrowserStorage()
const deps = { transport, storage, notify: sonnerNotify }

const initialState = (storage.loadProject() as UndoableState | null) ?? buildDemoState()
const editorStore = createEditorStore({ undoable: initialState })
editorStore.setState({ lastSavedState: initialState })
void restoreLocalUrls(editorStore, deps, initialState)
const editorRefs = createInstanceRefs()

if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__editorStore = editorStore
  ;(window as unknown as Record<string, unknown>).__playerRef = editorRefs.player
}

export function EditorApp() {
  return <EditorRoot store={editorStore} refs={editorRefs} deps={deps} />
}
