// 图生视频 · 三方关联(检查器面板,挂 Inspector 的 exportExtra)。
// 选中时间线块 → 认出它绑定的源图(照片块:assetId 素材 url 派生 ref;clip 块:assetId=clipId 反查
// ClipRecord.sourceImageRef)→ 显示「原图 + 该图全部 take」,就地替换选中块(from/track/itemId 不变),
// 高亮当前形态。零改库:替换只重写 items[itemId](见 lib/replace-clip)。take 卡片对齐 RendersList 的 MediaCard。
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ImagePlus, Loader2, Plus, RotateCcw, Sparkles, Trash2 } from 'lucide-react'
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
import { MediaLightbox, useMediaLightbox, type ViewerItem } from '@/components/media-lightbox'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

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

// 删除 take:首点转确认(红勾),再点才真删;失焦即撤销。各按钮自持 mutation → 删一条不会禁掉其它。
// isCurrent(正在用的 clip)时禁用并给出提示,不允许删。对齐 AssetGrid 的二次确认约定。
function DeleteTakeButton({ clipId, projectId, disabled }: { clipId: string; projectId: string; disabled?: boolean }) {
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

export function ClipGeneratorPanel({ projectId }: { projectId: string | null }) {
  const { t } = useTranslation()

  // —— 选中块 → 绑定解析 ——
  const selectedId = useEditor((s) => (s.selectedItemIds.length === 1 ? s.selectedItemIds[0] : null))
  const item = useEditor((s) => (selectedId ? s.undoable.items[selectedId] : null))
  const imageAsset = useEditor((s) => (item && item.type === 'image' ? s.undoable.assets[item.assetId] : null))
  const clipsQ = useProjectClips(projectId, null)
  const allClips = clipsQ.data ?? []
  const lightbox = useMediaLightbox()

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

  // 灯箱预览项:有绑定 = 原图 + 该图各 take(点卡片放大播放);无绑定 = 全项目 clip。索引与卡片一一对应。
  const viewerItems = useMemo<ViewerItem[]>(() => {
    if (binding) {
      return [
        { url: binding.photoUrl, kind: 'image', name: binding.photoName },
        ...takes.map((c) => ({ url: c.url, kind: 'video', name: c.provider })),
      ]
    }
    return allClips.map((c) => ({ url: c.url, kind: 'video', name: c.provider }))
  }, [binding, takes, allClips])

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
  // 记住这次生成是「给哪张源图」的:任务 id 是组件级单槽,若不记录,切到别的块后转圈会画错块上。
  const [genRef, setGenRef] = useState<string | null>(null)
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

  // 源图还是 blob:(本地上传尚未落到渲染服务)时,服务端 fetch 不到 → 禁止生成,等上传完成。
  const awaitingUpload = !!binding && binding.photoUrl.startsWith('blob:')

  const onGenerate = () => {
    if (!provider?.configured || !binding || awaitingUpload) return
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
        onSuccess: (created) => {
          setTaskId(created.taskId)
          setGenRef(binding.sourceImageRef)
        },
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
      {!binding && item?.type === 'video' && clipsQ.isLoading ? (
        // 选中的是 clip 块但全项目 clip 还没加载完 → 先显示识别中,避免闪一下「全部 clip」再切回其 takes
        <div className="flex items-center gap-2 rounded-md border border-dashed px-2.5 py-3 text-xs text-muted-foreground">
          <Loader2 className="size-4 shrink-0 animate-spin" />
          {t('clipGen.resolving')}
        </div>
      ) : !binding ? (
        // 无选中(或选中非图片/clip 块)→ 全项目 clip 集合:浏览 / 加入编辑器(新块)/ 删除
        allClips.length === 0 ? (
          <div className="flex items-center gap-2 rounded-md border border-dashed px-2.5 py-3 text-xs text-muted-foreground">
            <ImagePlus className="size-4 shrink-0" />
            {t('clipGen.selectBlockHint')}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {allClips.map((take, i) => (
              <MediaCard
                key={take.clipId}
                onOpen={(ev) => lightbox.open(i, ev)}
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
                  <Input
                    type="number"
                    className="h-8 w-16"
                    min={durations?.min ?? 1}
                    max={durations?.max ?? 60}
                    value={durationSeconds}
                    onChange={(e) =>
                      setDurationSeconds(
                        Math.min(durations?.max ?? 60, Math.max(durations?.min ?? 1, Number(e.target.value) || (durations?.min ?? 1))),
                      )
                    }
                  />
                )}
              </div>
            </div>
          </div>
          <Textarea rows={2} value={promptBody} onChange={(e) => setPromptBody(e.target.value)} placeholder={t('clipGen.promptPlaceholder')} />
          {/* disable 用全局 generating(单槽任务,别块生成中也禁,免得覆盖丢任务);转圈/进度只画在源图匹配的块上 */}
          <Button size="sm" onClick={onGenerate} disabled={!provider?.configured || awaitingUpload || generating || gen.isPending}>
            {(generating && genRef === binding.sourceImageRef) || gen.isPending ? (
              <>
                <Loader2 className="animate-spin" /> {t('clipGen.generating')}
                {genRef === binding.sourceImageRef && task?.progress ? ` ${Math.round(task.progress * 100)}%` : ''}
              </>
            ) : (
              <>
                <Sparkles /> {t('clipGen.generate')}
              </>
            )}
          </Button>
          {awaitingUpload ? <span className="text-[11px] text-muted-foreground">{t('clipGen.awaitingUpload')}</span> : null}

          {/* 形态列表:原图 + 各 take;点「用这条 / 换回原图」就地替换选中块,高亮当前 */}
          <div className="flex flex-col gap-2 pt-1">
            <MediaCard
              active={binding.current === PHOTO}
              onOpen={(ev) => lightbox.open(0, ev)}
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

            {takes.map((take, i) => {
              const isCurrent = binding.current === take.clipId
              return (
                <MediaCard
                  key={take.clipId}
                  active={isCurrent}
                  onOpen={(ev) => lightbox.open(i + 1, ev)}
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
                      <DeleteTakeButton clipId={take.clipId} projectId={projectId} disabled={isCurrent} />
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
      {/* 灯箱常挂(base-ui 需从 open=false 起挂才播进场):点卡片缩略图放大预览/播放,对齐 RendersList */}
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
