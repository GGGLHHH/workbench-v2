import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Clapperboard, Clock, Download, Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useEditor } from '@gedatou/editor'
import { useDeliverProject } from '@/api/projects/projects'
import { MediaLightbox, useMediaLightbox, type ViewerItem } from '@/components/media-lightbox'
import { MediaCard, Thumb, duration } from '@/components/media-card'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useScrollFade } from '@/lib/use-scroll-fade'

// 某项目的渲染历史(本机索引,留历史),内联显示在检查器「导出」区、内存渲染任务之后。
// 打开项目拉一次,渲染完成(done 任务数增加)自动刷新。卡片复用 MediaCard(与项目列表同款)。
type RenderRecord = {
  taskId: string
  url: string
  fileName: string
  codec: 'mp4' | 'webm'
  createdAt: string
  width: number
  height: number
  durationInFrames: number
  fps: number
}

export function RendersList({ id }: { id: string | null }) {
  const { t } = useTranslation()
  const [renders, setRenders] = useState<RenderRecord[]>([])
  const doneCount = useEditor((s) => s.renderingTasks.filter((task) => task.status === 'done').length)

  const refetch = useCallback(async () => {
    if (!id) return setRenders([])
    try {
      const res = await fetch(`/api/renders?projectId=${encodeURIComponent(id)}`)
      const data = (await res.json()) as { renders?: RenderRecord[] }
      setRenders(data.renders ?? [])
    } catch {
      setRenders([])
    }
  }, [id])

  useEffect(() => {
    void refetch()
  }, [refetch, doneCount])

  const onDelete = async (taskId: string) => {
    if (!id) return
    try {
      await fetch(`/api/renders/${taskId}?projectId=${encodeURIComponent(id)}`, { method: 'DELETE' })
      void refetch()
    } catch {
      toast.error(t('renders.deleteFailed'))
    }
  }

  // 有数据才挂 RendersView:useScrollFade 依赖 [ref] 只在挂载跑一次,若空列表先 return null、
  // 视口后到,scroll-fade 就加不上;拆子组件保证它挂载时视口已存在。
  if (!id || renders.length === 0) return null
  return <RendersView renders={renders} projectId={id} onDelete={onDelete} />
}

function RendersView({
  renders,
  projectId,
  onDelete,
}: {
  renders: RenderRecord[]
  projectId: string
  onDelete: (taskId: string) => void
}) {
  const { t } = useTranslation()
  const deliver = useDeliverProject()
  const lightbox = useMediaLightbox()
  const viewportRef = useRef<HTMLDivElement>(null)
  useScrollFade(viewportRef, 'vertical')

  const viewerItems = useMemo<ViewerItem[]>(
    () => renders.map((r) => ({ url: r.url, kind: 'video', name: r.fileName })),
    [renders],
  )

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{t('renders.history')}</span>
        <span className="rounded-full bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">{renders.length}</span>
      </div>
      <ScrollArea viewportRef={viewportRef} viewportStyle={{ maxHeight: 400, overflowY: 'auto' }}>
        <div className="flex flex-col gap-2 pr-2.5">
          {renders.map((r, i) => (
            <MediaCard
              key={r.taskId}
              onOpen={(ev) => lightbox.open(i, ev)}
              title={r.fileName}
              titleAttr={r.fileName}
              thumbnail={<Thumb url={r.url} kind="video" className="size-14" />}
              footer={
                <>
                  <div className="flex items-center gap-0.5">
                    <Button size="xs" variant="ghost" className="text-muted-foreground" nativeButton={false} render={<a href={r.url} rel="noreferrer" />}>
                      <Download />
                      {t('renders.download')}
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      className="text-muted-foreground"
                      disabled={deliver.isPending}
                      onClick={() => deliver.mutate({ id: projectId, videoUrl: r.url })}
                    >
                      {deliver.isPending ? <Loader2 className="animate-spin" /> : <Clapperboard />}
                      {t('renders.deliver')}
                    </Button>
                  </div>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="text-muted-foreground hover:text-destructive"
                    aria-label={t('renders.delete')}
                    onClick={() => onDelete(r.taskId)}
                  >
                    <Trash2 />
                  </Button>
                </>
              }
            >
              <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground tabular-nums">
                <span>
                  {r.width}×{r.height}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Clock className="size-3" /> {duration(r.durationInFrames / r.fps)}
                </span>
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">{new Date(r.createdAt).toLocaleString()}</span>
            </MediaCard>
          ))}
        </div>
      </ScrollArea>
      <MediaLightbox
        items={viewerItems}
        index={lightbox.index}
        rect={lightbox.rect}
        onIndexChange={lightbox.onIndexChange}
        onClose={lightbox.close}
      />
    </div>
  )
}
