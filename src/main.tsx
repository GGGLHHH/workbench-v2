import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import type { UndoableState } from '@gedatou/shared'
import {
  EditorRoot,
  createEditorStore,
  createInstanceRefs,
  restoreLocalUrls,
} from '@gedatou/editor'
import { createHttpTransport, createBrowserStorage } from '@gedatou/editor/adapters'
import { sonnerNotify } from './notify'
import { Toaster } from './toaster'
import { buildDemoState } from './demo-state'

// 默认适配器：同源 /api transport + localStorage/IndexedDB storage + sonner notify。
// 渲染后端暂缺，transport 的 render 调用会失败（属预期，见 vite.config 注释）。
const transport = createHttpTransport()
const storage = createBrowserStorage()
const deps = { transport, storage, notify: sonnerNotify }

// 初始状态：localStorage > demo；启动即视为“已保存”。
const initialState = (storage.loadProject() as UndoableState | null) ?? buildDemoState()
const editorStore = createEditorStore({ undoable: initialState })
editorStore.setState({ lastSavedState: initialState })
void restoreLocalUrls(editorStore, deps, initialState)
const editorRefs = createInstanceRefs()

if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__editorStore = editorStore
  ;(window as unknown as Record<string, unknown>).__playerRef = editorRefs.player
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <EditorRoot store={editorStore} refs={editorRefs} deps={deps} />
    <Toaster theme="dark" richColors position="bottom-right" />
  </StrictMode>,
)
