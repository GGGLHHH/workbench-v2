// 浏览态 take 卡(共享):全项目 clip 列表 + 组合结果区共用。带「加入编辑器」「删除(二次确认)」+ 媒体属性。
// 与单选面板里「替换选中块」的 take 卡不同(那套带 active/替换/当前徽章),这套是纯浏览+落地。
import { type MouseEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useDeleteClip } from '@/api/clips'
import { addProjectAssetToEditor } from '@/lib/add-to-editor'
import { MediaCard, Thumb, duration as fmtDuration } from '@/components/media-card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type TakeLike = {
  clipId: string
  url: string
  provider: string
  width?: number | null
  height?: number | null
  durationSeconds?: number | null
}

// 删除:首点转确认(红勾),再点真删;失焦撤销。各卡自持 mutation → 删一条不禁其它。
export function DeleteTakeButton({ clipId, projectId, disabled }: { clipId: string; projectId: string; disabled?: boolean }) {
  const { t } = useTranslation()
  const del = useDeleteClip()
  const [confirm, setConfirm] = useState(false)
  const label = disabled ? t('clipGen.cannotDeleteCurrent') : confirm ? t('clipGen.confirmDelete') : t('clipGen.deleteTake')
  return (
    <Button
      size="icon-xs"
      variant="ghost"
      className={cn('text-muted-foreground hover:text-destructive', confirm && 'text-destructive')}
      aria-label={label}
      title={label}
      disabled={disabled || del.isPending}
      onBlur={() => setConfirm(false)}
      onClick={() => {
        if (confirm) {
          setConfirm(false)
          del.mutate({ clipId, projectId })
        } else {
          setConfirm(true)
        }
      }}
    >
      {del.isPending ? <Loader2 className="animate-spin" /> : confirm ? <Check /> : <Trash2 />}
    </Button>
  )
}

/** 一张浏览态 take 卡(加入编辑器为新块 + 删除)。onOpen 打开灯箱预览。 */
export function ClipTakeCard({ take, projectId, onOpen }: { take: TakeLike; projectId: string; onOpen: (ev: MouseEvent<HTMLButtonElement>) => void }) {
  const { t } = useTranslation()
  const [adding, setAdding] = useState(false)
  const onAdd = async () => {
    setAdding(true)
    try {
      await addProjectAssetToEditor({ id: take.clipId, url: take.url, kind: 'video', durationSeconds: take.durationSeconds ?? undefined })
      toast.success(t('clipGen.addedToEditor'))
    } catch {
      toast.error(t('clipGen.addFailed'))
    } finally {
      setAdding(false)
    }
  }
  return (
    <MediaCard
      onOpen={onOpen}
      title={take.provider}
      titleAttr={take.provider}
      thumbnail={<Thumb url={take.url} kind="video" className="size-14" />}
      footer={
        <>
          <Button size="xs" variant="ghost" className="text-muted-foreground" disabled={adding} onClick={() => void onAdd()}>
            {adding ? <Loader2 className="animate-spin" /> : <Plus />} {t('clipGen.addToEditor')}
          </Button>
          <DeleteTakeButton clipId={take.clipId} projectId={projectId} />
        </>
      }
    >
      <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground tabular-nums">
        {take.width && take.height ? (
          <span>
            {take.width}×{take.height}
          </span>
        ) : null}
        {take.durationSeconds ? <span>{fmtDuration(take.durationSeconds)}</span> : null}
      </span>
    </MediaCard>
  )
}
