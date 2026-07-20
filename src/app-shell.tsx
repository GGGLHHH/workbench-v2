import { ProjectNav } from '@/components/project-nav'
import { EditorApp } from '@/editor-app'

// 应用外壳:左侧双层侧边栏(项目列表 / 详情) + 右侧编辑器画布。
export function AppShell() {
  return (
    <div className="flex h-svh w-full overflow-hidden">
      <ProjectNav />
      <div className="min-w-0 flex-1">
        <EditorApp />
      </div>
    </div>
  )
}
