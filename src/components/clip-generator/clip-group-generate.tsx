// 组合生成:选中一组 ≥2 张有序图片(画布成组后整组选中)——"顺序平行"的对等元素,非主辅。
// 双模式,用户自选:
//   B 各生成一条(默认):每张图各调单图链路 → N 条独立 clip,按序;全 provider 可用、最保真。顺序无关。
//   A 串成一条(进阶):首图=首帧、末图=末帧 → 一条穿越视频;仅支持关键帧的 provider(Kling/Luma;mock 供本地测)。
//     顺序敏感 → A 模式可就地重排(◀▶)。
// 先 AI 辅助看整组生成提示词(mode 决定语义),再生成。生成结果就地显示在结果区(命中本组图片的 clip)。
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Sparkles, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { useQuery } from '@tanstack/react-query'
import { invalidateProjectClips, useClipTaskWatcher, useGenerateClip, useProjectClips } from '@/api/clips'
import { useClipPromptAssist } from '@/api/prompt-assist'
import { getBffClip } from '@/generated/client'
import { useClipGenForm } from './use-clip-gen-form'
import { ClipGenControlsRow } from './clip-gen-controls-row'
import { ClipTakeCard } from './clip-take-card'
import { PromptPresetButton } from './prompt-preset-button'
import { SortableClipsGrid } from '@/components/sortable-clips-grid'
import { MediaLightbox, useMediaLightbox, type ViewerItem } from '@/components/media-lightbox'
import { Thumb } from '@/components/media-card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

export type GroupImage = { ref: string; url: string; name: string | null; itemId: string }
type Mode = 'batch' | 'sequence'

export function ClipGroupGenerate({
  projectId,
  images,
  onReorder,
}: {
  projectId: string
  images: GroupImage[]
  // 拖拽结束时把序列顺序按 item id 持久化(库把它写进组的 itemIds → 随项目 state 存,跨刷新)。
  onReorder?: (orderedItemIds: string[]) => void
}) {
  const { t } = useTranslation()
  const form = useClipGenForm()
  const { provider, providerId, adjustable, cameraMove, durationSeconds, promptBody, setPromptBody } = form
  const supportsKeyframes = !!provider?.keyframes?.supported

  const [mode, setMode] = useState<Mode>('batch')
  useEffect(() => {
    if (mode === 'sequence' && !supportsKeyframes) setMode('batch') // 选了 A 但当前 provider 不支持首尾帧 → 回落 B
  }, [mode, supportsKeyframes])

  // 序列顺序(A 敏感:首=首帧、末=末帧)可就地重排;选中集变了就重置为默认序。
  const refsKey = images.map((i) => i.ref).join('|')
  const [ordered, setOrdered] = useState<GroupImage[]>(images)
  useEffect(() => {
    setOrdered(images)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refsKey])
  // 拖拽结束(dnd-kit 给出新 ref 顺序):按新顺序重排 ordered(生成读它:首=首帧、末=末帧;B 各生成一条),
  // 并把 item id 顺序持久化(库写进组的 itemIds → 随项目 state 存,跨刷新)。
  const handleReorder = (refs: string[]) => {
    const byRef = new Map(ordered.map((img) => [img.ref, img]))
    const next = refs.map((r) => byRef.get(r)).filter((img): img is GroupImage => !!img)
    setOrdered(next)
    onReorder?.(next.map((x) => x.itemId))
  }
  const awaitingUpload = ordered.some((i) => i.url.startsWith('blob:'))

  // 结果区:命中本组任一源图的 clip(集合判断,顺序无关)。sequence clip 挂全组 → 每个成员都能看到。
  const clips = useProjectClips(projectId, null).data ?? []
  const groupRefSet = useMemo(() => new Set(images.map((i) => i.ref)), [images])
  const groupClips = useMemo(
    () => clips.filter((c) => groupRefSet.has(c.sourceImageRef) || c.sourceImageRefs?.some((r) => groupRefSet.has(r))),
    [clips, groupRefSet],
  )
  const lightbox = useMediaLightbox()
  const viewerItems = useMemo<ViewerItem[]>(
    () => groupClips.map((c) => ({ url: c.url, kind: 'video' as const, name: c.provider })),
    [groupClips],
  )
  // 源图预览灯箱(与结果 clip 灯箱分开:源是图、结果是视频)。index 对齐 ordered。
  const sourceLightbox = useMediaLightbox()
  const sourceViewerItems = useMemo<ViewerItem[]>(
    () => ordered.map((img) => ({ url: img.url, kind: 'image' as const, name: img.name })),
    [ordered],
  )

  const gen = useGenerateClip()

  // A(sequence):单任务,复用单槽轮询 hook(done/error 自动提示+失效+清槽)
  const { taskId: seqTaskId, setTaskId: setSeqTaskId, task: seqTask } = useClipTaskWatcher(projectId)

  // B(batch):N 个任务,一个 poller 统一轮询到全部落定
  const [batchTaskIds, setBatchTaskIds] = useState<string[] | null>(null)
  const batchPoll = useQuery({
    queryKey: ['bff', 'clips', 'batch', batchTaskIds ?? []],
    queryFn: () => Promise.all((batchTaskIds ?? []).map((id) => getBffClip({ path: { taskId: id } }))),
    enabled: !!batchTaskIds?.length,
    refetchInterval: (q) => {
      const data = q.state.data
      if (!data) return 1200
      return data.every((x) => x.status === 'done' || x.status === 'error') ? false : 1200
    },
  })
  useEffect(() => {
    const data = batchPoll.data
    if (!batchTaskIds || !data || !data.every((x) => x.status === 'done' || x.status === 'error')) return
    invalidateProjectClips(projectId)
    const failed = data.filter((x) => x.status === 'error').length
    if (failed) toast.error(t('clipGen.groupBatchPartial', { failed, total: data.length }))
    else toast.success(t('clipGen.done'))
    setBatchTaskIds(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchPoll.data])

  const [submitting, setSubmitting] = useState(false)
  const busy = submitting || gen.isPending || !!seqTaskId || !!batchTaskIds
  const batchProgress = batchPoll.data
    ? `${batchPoll.data.filter((x) => x.status === 'done' || x.status === 'error').length}/${batchPoll.data.length}`
    : ''

  const assist = useClipPromptAssist()
  const onAssist = () => {
    if (awaitingUpload || assist.isPending) return
    assist.mutate(
      { imageUrls: ordered.map((i) => i.url), action: 'generate', mode },
      {
        onSuccess: (res) => {
          setPromptBody(res.suggestedPrompt)
          if (res.warnings.length) toast.warning(res.warnings[0])
          else if (res.mock) toast.message(t('clipGen.assistMock'))
          else toast.success(t('clipGen.assistDone'))
        },
        onError: (e) => toast.error(e instanceof Error && e.message ? e.message : t('clipGen.assistFailed')),
      },
    )
  }

  const onGenerate = async () => {
    if (!provider?.configured || awaitingUpload || busy) return
    const common = {
      projectId,
      provider: providerId,
      durationSeconds: adjustable ? durationSeconds : undefined,
      cameraMove: cameraMove === 'auto' ? undefined : cameraMove,
      promptBody: promptBody.trim() || undefined,
    }
    if (mode === 'sequence') {
      // A:首图=首帧、末图=末帧(仅首尾两帧,按当前排序)。归属挂全组成员内容 ref(拆散/删成员都不影响)。
      gen.mutate(
        { ...common, imageUrl: ordered[0].url, endImageUrl: ordered[ordered.length - 1].url, sourceImageRefs: ordered.map((i) => i.ref) },
        {
          onSuccess: (created) => setSeqTaskId(created.taskId),
          onError: (e) => toast.error(e instanceof Error && e.message ? e.message : t('clipGen.failed')),
        },
      )
      return
    }
    // B:每张各生成一条(并行提交),各归属自己那张图。
    setSubmitting(true)
    try {
      const results = await Promise.allSettled(ordered.map((img) => gen.mutateAsync({ ...common, imageUrl: img.url, sourceImageRefs: [img.ref] })))
      const ids = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value.taskId] : []))
      const failed = results.length - ids.length
      if (failed) toast.error(t('clipGen.groupBatchPartial', { failed, total: results.length }))
      if (ids.length) setBatchTaskIds(ids)
    } finally {
      setSubmitting(false)
    }
  }

  // 单张源图瓦片(对齐资产网格:4 列 aspect-square + 点开预览)。sequence 标首/末帧、中间图变暗(v1 仅用首尾)。
  const sourceTile = (img: GroupImage, i: number) => {
    const seq = mode === 'sequence'
    const tag = seq ? (i === 0 ? t('clipGen.groupFirst') : i === ordered.length - 1 ? t('clipGen.groupLast') : '') : ''
    return (
      <button
        type="button"
        onClick={(e) => sourceLightbox.open(i, e)}
        title={img.name ?? undefined}
        className={cn(
          'relative aspect-square w-full overflow-hidden rounded-md ring-offset-background hover:ring-2 hover:ring-ring focus-visible:ring-2 focus-visible:ring-ring',
          seq && !tag && 'opacity-40',
        )}
      >
        <Thumb url={img.url} kind="image" className="size-full rounded-none" />
        {tag ? (
          <span className="pointer-events-none absolute inset-x-0 bottom-0 rounded-b-md bg-black/60 py-px text-center text-[9px] text-white">
            {tag}
          </span>
        ) : null}
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {/* 模式切换:B 各生成一条(默认) / A 串成一条(仅支持首尾帧的 provider) */}
      <div className="flex gap-1">
        {(['batch', 'sequence'] as const).map((m) => {
          const disabled = busy || (m === 'sequence' && !supportsKeyframes)
          return (
            <Button
              key={m}
              size="xs"
              variant={mode === m ? 'default' : 'outline'}
              className="flex-1"
              disabled={disabled}
              title={disabled ? t('clipGen.groupSeqUnsupported') : undefined}
              onClick={() => setMode(m)}
            >
              {m === 'batch' ? t('clipGen.groupModeBatch') : t('clipGen.groupModeSequence')}
            </Button>
          )
        })}
      </div>
      <span className="text-[11px] text-muted-foreground">
        {mode === 'sequence' ? t('clipGen.groupSequenceHint', { total: ordered.length }) : t('clipGen.groupBatchHint', { total: ordered.length })}
      </span>

      {/* 源图:对齐资产网格(4 列 aspect-square,点开预览)。sequence 拖拽重排(@dnd-kit,首/末=首/末帧,中间图变暗
          表示 v1 仅用首尾两帧);batch 顺序无关、静态。 */}
      {mode === 'sequence' ? (
        <SortableClipsGrid items={ordered} getKey={(img) => img.ref} renderTile={sourceTile} onReorder={handleReorder} />
      ) : (
        <div className="grid grid-cols-4 gap-1.5">
          {ordered.map((img, i) => (
            <div key={img.ref} className="group relative">
              {sourceTile(img, i)}
            </div>
          ))}
        </div>
      )}

      <ClipGenControlsRow
        form={form}
        trailing={
          <Button
            size="icon-sm"
            variant="outline"
            className="h-8"
            disabled={awaitingUpload || assist.isPending}
            onClick={onAssist}
            title={t('clipGen.groupAssist')}
          >
            {assist.isPending ? <Loader2 className="animate-spin" /> : <Wand2 />}
          </Button>
        }
      />

      {/* 从预设目录挑一条 prompt 填入文本框(选完可再用 AI 改写)。 */}
      <PromptPresetButton onPick={setPromptBody} />
      <Textarea rows={2} value={promptBody} onChange={(e) => setPromptBody(e.target.value)} placeholder={t('clipGen.promptPlaceholder')} />
      <Button size="sm" onClick={() => void onGenerate()} disabled={!provider?.configured || awaitingUpload || busy}>
        {busy ? (
          <>
            <Loader2 className="animate-spin" /> {t('clipGen.generating')}
            {batchProgress ? ` ${batchProgress}` : seqTask?.progress ? ` ${Math.round(seqTask.progress * 100)}%` : ''}
          </>
        ) : (
          <>
            <Sparkles /> {t('clipGen.groupGenerate')}
          </>
        )}
      </Button>
      {awaitingUpload ? <span className="text-[11px] text-muted-foreground">{t('clipGen.awaitingUpload')}</span> : null}

      {/* 结果区:本组产出的 clip 就地可见(消灭"生成完不知去哪")。加入编辑器 / 预览 / 删除。 */}
      {groupClips.length ? (
        <div className="flex flex-col gap-2 pt-1">
          <span className="text-[11px] text-muted-foreground">{t('clipGen.groupResults', { count: groupClips.length })}</span>
          {groupClips.map((take, i) => (
            <ClipTakeCard key={take.clipId} take={take} projectId={projectId} onOpen={(ev) => lightbox.open(i, ev)} />
          ))}
        </div>
      ) : null}
      <MediaLightbox
        items={viewerItems}
        index={lightbox.index}
        rect={lightbox.rect}
        onIndexChange={lightbox.onIndexChange}
        onClose={lightbox.close}
      />
      {/* 源图预览灯箱 */}
      <MediaLightbox
        items={sourceViewerItems}
        index={sourceLightbox.index}
        rect={sourceLightbox.rect}
        onIndexChange={sourceLightbox.onIndexChange}
        onClose={sourceLightbox.close}
      />
    </div>
  )
}
