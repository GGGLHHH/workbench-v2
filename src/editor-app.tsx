import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearch } from '@tanstack/react-router'
import { Loader2, UploadCloud } from 'lucide-react'
import type { UndoableState } from '@gedatou/shared'
import {
  Canvas,
  Editor,
  EditorContainer,
  EditorProvider,
  Inspector,
  PlaybackBar,
  Timeline,
  createEditorStore,
  createInstanceRefs,
  restoreLocalUrls,
} from '@gedatou/editor'
import { createHttpTransport, createBrowserStorage } from '@gedatou/editor/adapters'
import '@/overlays/register' // 注册业务 custom item 渲染器(预览端;渲染端见 render-entry.tsx)
import { migrateLegacyOverlays } from '@/lib/video-overlays'
import { buildDownloadName } from '@/lib/download-name'
import { CanvasPresetsPanel } from '@/components/canvas-presets-panel'
import { CoverInspectorPanel } from '@/components/overlay-inspector-panels'
import { ClipGeneratorPanel } from '@/components/clip-generator/clip-generator-panel'
import { RendersList } from '@/components/renders-list'
import { COVER_KIND } from '@/overlays/overlay-design'
import { FileDropOverlay, useFileDrag } from '@/components/file-drop'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { useScrollFade } from '@/lib/use-scroll-fade'
import { useProject, usePublishProject, useSaveProject } from '@/api/projects/projects'
import { sonnerNotify } from '@/notify'
import { buildDemoState } from '@/demo-state'

// 编辑器单例(模块级,首次进入 '/' 路由时按需加载),跟随侧边栏选中的项目。
// store 与 storage 在 React 外面,当前项目的保存函数靠这个可变 ref 从 EditorApp 过桥进来:
// 选中项目 → 存回 BFF;无选中 → 回落 localStorage(保留接线前的 demo 行为)。
const projectRef: { save: ((state: UndoableState) => void) | null } = { save: null }

// 当前编辑器已加载哪个项目的时间轴。侧栏视频叠加控件(video-overlays)派发前用它守卫:
// 编辑器还没把本项目 state 灌进单例时不许写,免得把叠加 item 塞进上个项目/demo 的时间轴。
export const editorProjectRef: { id: string | null } = { id: null }

// 渲染请求带上当前项目 id:库的 startRender 不认 projectId(保持项目无关),由消费方从 ambient
// editorProjectRef 注入。渲染服务据此把产物关联写进本机索引(server/render-index),抗刷新。
const httpTransport = createHttpTransport()
const transport = {
  ...httpTransport,
  startRender: (input: { state: UndoableState; codec: 'mp4' | 'webm'; fileName?: string }) =>
    fetch('/api/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...input, projectId: editorProjectRef.id }),
    }).then((res) => {
      if (!res.ok) throw new Error(`render request failed: ${res.status}`)
      return res.json() as Promise<{ taskId: string }>
    }),
}
const browser = createBrowserStorage()
// 只包 saveProject 一个方法。库里保存(Cmd+S)是显式触发、非自动存,所以接 BFF 不会频繁写库。
// 素材本地缓存(get/put/deleteAsset)与 loadProject 兜底照旧用 browser 实现。
const storage = {
  ...browser,
  saveProject: (state: UndoableState) => (projectRef.save ?? browser.saveProject)(state),
}
// 模块级基础 deps(无 t,与语言无关);带 t 的响应式 deps 在 EditorApp 里按语言组装。
const baseDeps = { transport, storage, notify: sonnerNotify }

// 无选中项目时的占位工程:localStorage 恢复,回退 demo。选中项目后由 EditorApp 重置成该工程。
const initialState = (browser.loadProject() as UndoableState | null) ?? buildDemoState()
// 导出:project-detail 的「加入编辑器」(add-to-editor)按需写入这个单例。
export const editorStore = createEditorStore({ undoable: initialState })
editorStore.setState({ lastSavedState: initialState })
void restoreLocalUrls(editorStore, baseDeps, initialState)
const editorRefs = createInstanceRefs()

if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__editorStore = editorStore
  ;(window as unknown as Record<string, unknown>).__playerRef = editorRefs.player
}

// 发布:把本地 server 素材上传平台 + 改写引用 + 推时间线（读已存态，故内部先保存）。
// 原在 project-nav 详情顶栏,移进编辑器工具栏 —— 项目级动作,但紧挨保存/渲染更顺手。
function PublishButton({ id }: { id: string | null }) {
  const { t } = useTranslation()
  const publish = usePublishProject()
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={!id || publish.isPending}
      onClick={() => id && publish.mutate({ id })}
      title={t('editorApp.publishAssetsTitle')}
    >
      {publish.isPending ? <Loader2 className="size-4 animate-spin" /> : <UploadCloud className="size-4" />}
      {t('editorApp.publish')}
    </Button>
  )
}

// 画布/时间轴的文件拖拽视觉盖层(观察模式):文件一进窗口即提示,实际导入仍由库处理(保留精确落点/时间轴蓝线)。
// 不传 onDrop → useFileDrag 不 preventDefault → 不抢库挂在内层元素上的 drop;覆盖层 pointer-events-none 也不挡。
function EditorDropZone({ className, children }: { className?: string; children: ReactNode }) {
  const { t } = useTranslation()
  const { windowDrag, over, dragProps } = useFileDrag()
  return (
    <div className={cn('relative', className)} {...dragProps}>
      {children}
      <FileDropOverlay
        state={windowDrag}
        over={over}
        labels={{
          dragHere: t('editorApp.dragToImport'),
          dropToUpload: t('editorApp.dropToImport'),
          dropInvalid: t('editorApp.dragToImport'),
        }}
      />
    </div>
  )
}

export function EditorApp() {
  const { project: id } = useSearch({ from: '/' })
  const detail = useProject(id ?? null)
  const saveMutate = useSaveProject().mutate
  const { i18n } = useTranslation()

  // 把 v2 的 i18n 注入 @gedatou/editor（库本身不做 i18n，只认 deps.t）：
  // 库调 t('toolbar.undo') → 解析 v2 的 editor.toolbar.undo。v2 未覆盖的 key（exists=false）
  // 返回原 key → 库回落它内置的 zh 默认（新版本加的文案不会显示成 raw key）。
  // deps 随 i18n.language 重建 → deps context 更新 → 编辑器整体跟随 v2 语言切换。
  // 下载名基础名 = 项目名(可读)。detail 到位后才有值;渲染时用户已在看项目,故已就绪。
  const projectName = detail.data?.name
  const deps = useMemo(
    () => ({
      ...baseDeps,
      t: (key: string, params?: Record<string, string | number>) => {
        const full = `editor.${key}`
        return i18n.exists(full) ? (i18n.t(full, params) as string) : key
      },
      // 下载名策略在消费方:项目名 + 导出时刻(库只透传给渲染服务清洗后挂头)。
      // 无项目名时回落纯时间戳(buildDownloadName 处理 baseName 为空)。
      exportFileName: (codec: string) => buildDownloadName(codec, projectName, new Date()),
      // 封面块的检查器领域面板(时间轴选中封面 → 可改四行文字)
      customItemPanels: { [COVER_KIND]: CoverInspectorPanel },
    }),
    [i18n, i18n.language, projectName],
  )

  // 保存函数随选中项目刷新(saveMutate 引用稳定)。库触发 saveProject → PUT /bff/projects/:id。
  useEffect(() => {
    projectRef.save = id
      ? (state) => saveMutate({ id, request: { state: state as unknown as Record<string, unknown> } })
      : null
  }, [id, saveMutate])

  // 切项目:该工程时间轴首次到达时把编辑器 store 重置为它(沿用库自身 loadStateFromFile 的重置约定)。
  // loadedIdRef 守护 —— 保存后 detail 失效重拉(同一 id)不再二次重置,避免清空 undo 历史/选择。
  const loadedIdRef = useRef<string | null>(null)
  // 检查器滚动:ScrollArea + scroll-fade(上下边缘渐隐),替代 aside 的原生 overflow-y-auto
  const inspectorViewportRef = useRef<HTMLDivElement>(null)
  useScrollFade(inspectorViewportRef, 'vertical')
  const rawState = detail.data?.state as unknown as UndoableState | undefined
  useEffect(() => {
    if (!rawState || loadedIdRef.current === id) return
    loadedIdRef.current = id ?? null
    editorProjectRef.id = id ?? null // 时间轴到位 → 允许侧栏叠加控件写这个项目
    const state = migrateLegacyOverlays(rawState) // 旧格式叠加 item → custom item(下次保存即固化)
    // renderingTasks 也清:换项目后旧渲染产物不应被误交付到新项目
    editorStore.setState({ undoable: state, lastSavedState: state, past: [], future: [], selectedItemIds: [], renderingTasks: [] })
    void restoreLocalUrls(editorStore, baseDeps, state)
    // ponytail: 直接重置会丢弃未保存改动(gotcha #5,脏检查/切换确认待产品拍板后单独接)
  }, [id, rawState])

  // compound 拼装:替代 <EditorRoot>。删掉 demo 专用的下载/导入状态按钮(平台持久化到 BFF,
  // 本地 JSON 存取无意义),发布/交付作为宿主自定义按钮放进工具栏右侧。
  return (
    <EditorProvider store={editorStore} refs={editorRefs} deps={deps}>
      <EditorContainer>
        <Editor.Toolbar>
          <Editor.Title />
          <Editor.UndoButton />
          <Editor.RedoButton />
          <Editor.PlayButton />
          <Editor.TextToolButton />
          <Editor.SolidToolButton />
          <Editor.ImportAssetButton />
          <Editor.UploadStatusBadge />
          <Editor.CaptioningBadge />
          <div className="ml-auto flex items-center gap-1.5">
            <Editor.ZoomControls />
            <Editor.CleanupAssetsButton />
            <Editor.SaveButton />
            <PublishButton id={id ?? null} />
          </div>
        </Editor.Toolbar>
        <div className="flex min-h-0 flex-1">
          <EditorDropZone className="flex min-h-0 min-w-0 flex-1">
            <Canvas />
          </EditorDropZone>
          <aside className="w-[349px] shrink-0 border-l border-border text-sm">
            <ScrollArea viewportRef={inspectorViewportRef} className="h-full">
              {/* 包一层单 div:useScrollFade 的 ResizeObserver 观察 viewport.firstElementChild,
                  检查器本是并列多段(Canvas/时长/导出),后段增长抓不到 → 渐隐失灵;单 wrapper 随整体长高。 */}
              <div>
                <Inspector canvasExtra={<CanvasPresetsPanel />} exportExtra={<RendersList id={id ?? null} />} />
                {/* 图生视频面板常驻(选不选中块都在):无选中=全项目 clip 集合;选中图片/clip 块=该块的集合。
                    不能放进 Inspector 的 exportExtra —— 那个槽只在「未选中任何块」时渲染,选中块就被隐藏。 */}
                <div className="border-t border-border p-3">
                  <ClipGeneratorPanel projectId={id ?? null} />
                </div>
              </div>
            </ScrollArea>
          </aside>
        </div>
        <PlaybackBar />
        <EditorDropZone className="shrink-0">
          <Timeline />
        </EditorDropZone>
      </EditorContainer>
    </EditorProvider>
  )
}
