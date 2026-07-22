import { memo } from 'react'
import { Building2, Clapperboard, Clock, Image as ImageIcon, User } from 'lucide-react'

import type { ProjectSummary } from '@/components/project-nav/types'
import { ProjectStatusMenu } from '@/components/project-nav/status-menu'
import { useNavActions } from '@/components/project-nav/nav-context'
import { MediaCard, Thumb, duration } from '@/components/media-card'
import { relTime } from '@/lib/format'

// memo:滚动时虚拟化器每帧都产出新数组,不 memo 的话这 20 张卡片(连同里面的
// <video preload="metadata">)每帧全部重新协调 —— 这是滚动卡顿的最后一块。
// 回调从 context 取(identity 恒定),memo 只比 { project, active, busy };
// 硬约束:此处绝不读 useSearch 等易变 hook,否则每次打字都会整表重渲染。
export const ProjectCard = memo(function ProjectCard({
  project,
  active,
  busy,
}: {
  project: ProjectSummary
  active: boolean
  busy: boolean
}) {
  const { selectProject, changeProjectStatus } = useNavActions()
  return (
    <MediaCard
      active={active}
      onOpen={() => selectProject(project.id)}
      title={project.title}
      titleAttr={project.title}
      thumbnail={<Thumb url={project.thumbnailUrl} kind={project.thumbnailKind} className="size-14" />}
      footer={
        <>
          <ProjectStatusMenu status={project.status} busy={busy} onAction={(action) => changeProjectStatus(project.id, action)} />
          <span className="text-xs text-muted-foreground">{relTime(project.updatedAt)}</span>
        </>
      }
    >
      <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        <span className="inline-flex min-w-0 items-center gap-1">
          <User className="size-3 shrink-0" /> <span className="truncate">{project.assignee || 'Unassigned'}</span>
        </span>
        <span className="inline-flex min-w-0 items-center gap-1">
          <Building2 className="size-3 shrink-0" /> <span className="truncate">{project.agency || 'No agency'}</span>
        </span>
      </span>
      <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <ImageIcon className="size-3" /> {project.resourceCount} resources
        </span>
        <span className="inline-flex items-center gap-1">
          <Clapperboard className="size-3" /> {project.clipCount} clips
        </span>
        <span className="inline-flex items-center gap-1">
          <Clock className="size-3" /> {duration(project.durationSeconds)}
        </span>
      </span>
    </MediaCard>
  )
})
