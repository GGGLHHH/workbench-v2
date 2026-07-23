// 图生视频 · 三方关联(检查器面板,挂 Inspector 的 exportExtra)。
// 选中时间线块 → 认出它绑定的源图(照片块:assetId 素材 url 派生 ref;clip 块:assetId=clipId 反查
// ClipRecord.sourceImageRef)→ 显示「原图 + 该图全部 take」,就地替换选中块(from/track/itemId 不变),
// 高亮当前形态。零改库:替换只重写 items[itemId](见 lib/replace-clip)。take 卡片对齐 RendersList 的 MediaCard。
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ImagePlus, Loader2, Plus, RotateCcw, Sparkles, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useEditor } from '@gedatou/editor'
import {
  invalidateProjectClips,
  useClipProviders,
  useClipTask,
  useDeleteClip,
  useGenerateClip,
  useProjectClips,
} from '@/api/clips'
import { addProjectAssetToEditor } from '@/lib/add-to-editor'
import { replaceItemWithClip, revertItemToPhoto } from '@/lib/replace-clip'
import { MediaCard, Thumb, duration as fmtDuration } from '@/components/media-card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'

const CAMERA_MOVES = ['auto', 'slowPushIn', 'slowPullBack', 'panLeft', 'panRight', 'tiltUp', 'tiltDown', 'staticHold'] as const
const PHOTO = 'photo' as const

// /bff/content/<id> → content_id(与 BFF refOf 一致);否则整串 url。
const refOf = (url: string): string => url.match(/^\/bff\/content\/(.+)$/)?.[1] ?? url
// content_id → /bff/content/<id>;已是 url(含 : 或 /)则原样。
const photoUrlFromRef = (ref: string): string => (/[:/]/.test(ref) ? ref : `/bff/content/${ref}`)

type Binding = {
  sourceImageRef: string
  photoUrl: string
  photoName: string | null
  photoAssetId: string
  current: string // clipId | 'photo'
}

export function ClipGeneratorPanel({ projectId }: { projectId: string | null }) {
  const { t } = useTranslation()

  // —— 选中块 → 绑定解析 ——
  const selectedId = useEditor((s) => (s.selectedItemIds.length === 1 ? s.selectedItemIds[0] : null))
  const item = useEditor((s) => (selectedId ? s.undoable.items[selectedId] : null))
  const imageAsset = useEditor((s) => (item && item.type === 'image' ? s.undoable.assets[item.assetId] : null))
  const allClips = useProjectClips(projectId, null).data ?? []

  const binding: Binding | null = useMemo(() => {
    if (!item) return null
    if (item.type === 'image' && imageAsset) {
      const ref = refOf(imageAsset.url)
      return { sourceImageRef: ref, photoUrl: imageAsset.url, photoName: imageAsset.filename, photoAssetId: ref, current: PHOTO }
    }
    if (item.type === 'video') {
      const clip = allClips.find((c) => c.clipId === item.assetId)
      if (!clip) return null // 非本项目生成的普通视频 → 无绑定
      return {
        sourceImageRef: clip.sourceImageRef,
        photoUrl: photoUrlFromRef(clip.sourceImageRef),
        photoName: null,
        photoAssetId: clip.sourceImageRef,
        current: item.assetId,
      }
    }
    return null
  }, [item, imageAsset, allClips])

  const takes = useMemo(
    () => (binding ? allClips.filter((c) => c.sourceImageRef === binding.sourceImageRef) : []),
    [allClips, binding],
  )

  // —— 生成控件状态(始终挂载,保证 hook 顺序稳定;无绑定时不渲染)——
  const providersQ = useClipProviders()
  const providers = providersQ.data ?? []
  const [providerId, setProviderId] = useState('')
  useEffect(() => {
    if (!providerId && providers.length) setProviderId((providers.find((p) => p.configured) ?? providers[0]).id)
  }, [providers, providerId])
  const provider = providers.find((p) => p.id === providerId)
  const durations = provider?.durations
  const adjustable = durations?.adjustable !== false
  const durationValues = durations?.values ?? null

  const [cameraMove, setCameraMove] = useState('slowPushIn')
  const [promptBody, setPromptBody] = useState('')
  const [durationSeconds, setDurationSeconds] = useState(6)
  useEffect(() => {
    if (adjustable && durationValues?.length && !durationValues.includes(durationSeconds)) setDurationSeconds(durationValues[0])
  }, [adjustable, durationValues, durationSeconds])

  const gen = useGenerateClip()
  const [taskId, setTaskId] = useState<string | null>(null)
  const task = useClipTask(taskId).data
  const generating = !!taskId && task?.status !== 'done' && task?.status !== 'error'
  useEffect(() => {
    if (!task || !projectId) return
    if (task.status === 'done') {
      invalidateProjectClips(projectId)
      toast.success(t('clipGen.done'))
      setTaskId(null)
    } else if (task.status === 'error') {
      toast.error(task.error || t('clipGen.failed'))
      setTaskId(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.status])

  const del = useDeleteClip()
  const [adding, setAdding] = useState<string | null>(null)
  const onAddToEditor = async (take: { clipId: string; url: string; durationSeconds?: number | null }) => {
    setAdding(take.clipId)
    try {
      await addProjectAssetToEditor({ id: take.clipId, url: take.url, kind: 'video', durationSeconds: take.durationSeconds ?? undefined })
      toast.success(t('clipGen.addedToEditor'))
    } catch {
      toast.error(t('clipGen.addFailed'))
    } finally {
      setAdding(null)
    }
  }

  if (!projectId) return null

  const onGenerate = () => {
    if (!provider?.configured || !binding) return
    gen.mutate(
      {
        imageUrl: binding.photoUrl,
        projectId,
        provider: providerId,
        durationSeconds: adjustable ? durationSeconds : undefined,
        cameraMove: cameraMove === 'auto' ? undefined : cameraMove,
        promptBody: promptBody.trim() || undefined,
      },
      {
        onSuccess: (created) => setTaskId(created.taskId),
        onError: (e) => toast.error(e instanceof Error && e.message ? e.message : t('clipGen.failed')),
      },
    )
  }

  const onRevert = async () => {
    if (!selectedId || !binding) return
    await revertItemToPhoto(selectedId, { assetId: binding.photoAssetId, url: binding.photoUrl, name: binding.photoName })
    toast.success(t('clipGen.revertedToPhoto'))
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{t('clipGen.title')}</span>
      {!binding ? (
        // 无选中(或选中非图片/clip 块)→ 全项目 clip 集合:浏览 / 加入编辑器(新块)/ 删除
        allClips.length === 0 ? (
          <div className="flex items-center gap-2 rounded-md border border-dashed px-2.5 py-3 text-xs text-muted-foreground">
            <ImagePlus className="size-4 shrink-0" />
            {t('clipGen.selectBlockHint')}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {allClips.map((take) => (
              <MediaCard
                key={take.clipId}
                title={take.provider}
                titleAttr={take.provider}
                thumbnail={<Thumb url={take.url} kind="video" className="size-14" />}
                footer={
                  <>
                    <Button
                      size="xs"
                      variant="ghost"
                      className="text-muted-foreground"
                      disabled={adding === take.clipId}
                      onClick={() => void onAddToEditor(take)}
                    >
                      {adding === take.clipId ? <Loader2 className="animate-spin" /> : <Plus />} {t('clipGen.addToEditor')}
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      className="text-muted-foreground hover:text-destructive"
                      aria-label={t('clipGen.deleteTake')}
                      disabled={del.isPending}
                      onClick={() => del.mutate({ clipId: take.clipId, projectId })}
                    >
                      <Trash2 />
                    </Button>
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
            ))}
          </div>
        )
      ) : (
        <div className="flex flex-col gap-2">
          {/* 生成控件(从源图生成新 take)—— compact */}
          <div className="flex gap-2">
            <Thumb url={binding.photoUrl} kind="image" className="size-16 shrink-0 rounded-md" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <NativeSelect className="h-8" value={providerId} disabled={providersQ.isLoading} onChange={(e) => setProviderId(e.target.value)}>
                {providers.map((p) => (
                  <NativeSelectOption key={p.id} value={p.id} disabled={!p.configured}>
                    {p.label}
                    {p.configured ? '' : ` — ${p.configurationIssue ?? t('clipGen.notConfigured')}`}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <div className="flex gap-1.5">
                <NativeSelect className="h-8 flex-1" value={cameraMove} onChange={(e) => setCameraMove(e.target.value)}>
                  {CAMERA_MOVES.map((m) => (
                    <NativeSelectOption key={m} value={m}>
                      {t(`clipGen.camera.${m}`)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                {!adjustable ? (
                  <span className="flex h-8 w-16 items-center justify-center rounded-md border text-[11px] text-muted-foreground">
                    {t('clipGen.modelPicks')}
                  </span>
                ) : durationValues?.length ? (
                  <NativeSelect className="h-8 w-16" value={String(durationSeconds)} onChange={(e) => setDurationSeconds(Number(e.target.value))}>
                    {durationValues.map((v) => (
                      <NativeSelectOption key={v} value={String(v)}>
                        {v}s
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                ) : (
                  <Input type="number" className="h-8 w-16" min={durations?.min ?? 1} max={durations?.max ?? 60} value={durationSeconds} onChange={(e) => setDurationSeconds(Number(e.target.value))} />
                )}
              </div>
            </div>
          </div>
          <Textarea rows={2} value={promptBody} onChange={(e) => setPromptBody(e.target.value)} placeholder={t('clipGen.promptPlaceholder')} />
          <Button size="sm" onClick={onGenerate} disabled={!provider?.configured || generating || gen.isPending}>
            {generating || gen.isPending ? (
              <>
                <Loader2 className="animate-spin" /> {t('clipGen.generating')}
                {task?.progress ? ` ${Math.round(task.progress * 100)}%` : ''}
              </>
            ) : (
              <>
                <Sparkles /> {t('clipGen.generate')}
              </>
            )}
          </Button>

          {/* 形态列表:原图 + 各 take;点「用这条 / 换回原图」就地替换选中块,高亮当前 */}
          <div className="flex flex-col gap-2 pt-1">
            <MediaCard
              active={binding.current === PHOTO}
              title={t('clipGen.originalPhoto')}
              thumbnail={<Thumb url={binding.photoUrl} kind="image" className="size-14" />}
              footer={
                <>
                  <span className="text-[11px] text-muted-foreground">{binding.current === PHOTO ? t('clipGen.current') : ''}</span>
                  <Button size="xs" variant="ghost" className="text-muted-foreground" disabled={binding.current === PHOTO} onClick={() => void onRevert()}>
                    <RotateCcw /> {t('clipGen.revert')}
                  </Button>
                </>
              }
            >
              <span className="text-xs text-muted-foreground">{binding.photoName ?? ''}</span>
            </MediaCard>

            {takes.map((take) => {
              const isCurrent = binding.current === take.clipId
              return (
                <MediaCard
                  key={take.clipId}
                  active={isCurrent}
                  title={take.provider}
                  titleAttr={take.provider}
                  thumbnail={<Thumb url={take.url} kind="video" className="size-14" />}
                  footer={
                    <>
                      {isCurrent ? (
                        <span className="text-[11px] text-muted-foreground">{t('clipGen.current')}</span>
                      ) : (
                        <Button
                          size="xs"
                          variant="ghost"
                          className="text-muted-foreground"
                          onClick={() => {
                            if (!selectedId) return
                            replaceItemWithClip(selectedId, take)
                            toast.success(t('clipGen.replaced'))
                          }}
                        >
                          <Sparkles /> {t('clipGen.useTake')}
                        </Button>
                      )}
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        className="text-muted-foreground hover:text-destructive"
                        aria-label={t('clipGen.deleteTake')}
                        title={isCurrent ? t('clipGen.cannotDeleteCurrent') : t('clipGen.deleteTake')}
                        disabled={del.isPending || isCurrent}
                        onClick={() => del.mutate({ clipId: take.clipId, projectId })}
                      >
                        <Trash2 />
                      </Button>
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
            })}
          </div>
        </div>
      )}
    </div>
  )
}
