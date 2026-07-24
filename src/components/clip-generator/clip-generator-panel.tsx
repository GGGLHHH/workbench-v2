// 图生视频 · 三方关联(检查器面板,挂 Inspector 的 exportExtra)。
// 选中时间线块 → 认出它绑定的源图(照片块:assetId 素材 url 派生 ref;clip 块:assetId=clipId 反查
// ClipRecord.sourceImageRef)→ 显示「原图 + 该图全部 take」,就地替换选中块(from/track/itemId 不变),
// 高亮当前形态。零改库:替换只重写 items[itemId](见 lib/replace-clip)。take 卡片对齐 RendersList 的 MediaCard。
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ImagePlus, Loader2, RotateCcw, Sparkles, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { useEditor } from '@gedatou/editor'
import {
  invalidateProjectClips,
  useClipProviders,
  useClipTask,
  useGenerateClip,
  useProjectClips,
} from '@/api/clips'
import { useClipPromptAssist } from '@/api/prompt-assist'
import { CAMERA_MOVES, ClipGroupGenerate, type GroupImage } from './clip-group-generate'
import { ClipTakeCard, DeleteTakeButton } from './clip-take-card'
import { PromptPresetButton } from './prompt-preset-button'
import { replaceItemWithClip, revertItemToPhoto } from '@/lib/replace-clip'
import { MediaCard, Thumb, duration as fmtDuration } from '@/components/media-card'
import { MediaLightbox, useMediaLightbox, type ViewerItem } from '@/components/media-lightbox'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'

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

  // 组合入参:选中 ≥2 张图片(画布成组后 setSelected 会整组选中)→ 首图 hero + 其余参考图。
  const selectedItemIds = useEditor((s) => s.selectedItemIds)
  const allItems = useEditor((s) => s.undoable.items)
  const allAssets = useEditor((s) => s.undoable.assets)
  const groupImages = useMemo<GroupImage[]>(() => {
    if (selectedItemIds.length < 2) return []
    const out: GroupImage[] = []
    for (const id of selectedItemIds) {
      const it = allItems[id]
      if (it?.type !== 'image') continue
      const a = allAssets[it.assetId]
      if (a) out.push({ ref: refOf(a.url), url: a.url, name: a.filename, itemId: id })
    }
    return out.length >= 2 ? out : []
  }, [selectedItemIds, allItems, allAssets])
  // 序列拖拽排序 → 持久化:库把顺序写进组的 itemIds(随项目 state 存,跨刷新)。
  const reorderGroupItems = useEditor((s) => s.reorderGroupItems)
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

  // take 命中:主 ref 相等,或 sourceImageRefs 含该 ref(序列 clip 挂全组 → 每个成员单独选中也看得到,
  // 与 server listClips / 组结果区一致;这样"抗拆散归属"在单图面板也兑现)。
  const takes = useMemo(
    () =>
      binding
        ? allClips.filter((c) => c.sourceImageRef === binding.sourceImageRef || c.sourceImageRefs?.includes(binding.sourceImageRef))
        : [],
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
  const assist = useClipPromptAssist()
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

  // Prompt Assist:AI 生成/改写运镜正文。generate 无视现有正文;improve 带上当前正文精修(空则禁用)。
  // 成功即填回文本框;mock(未配 GEMINI_API_KEY)与 warnings 走提示。源图为 blob(未上传)时禁用。
  const onAssist = (action: 'generate' | 'improve') => {
    if (!binding || awaitingUpload) return
    assist.mutate(
      { imageUrls: [binding.photoUrl], action, currentPrompt: action === 'improve' ? promptBody.trim() : undefined },
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
        // 选中 ≥2 张图片(画布成组后整组选中)→ 组合生成(首图 hero + 其余参考图)
        groupImages.length >= 2 ? (
          <ClipGroupGenerate projectId={projectId} images={groupImages} onReorder={reorderGroupItems} />
        ) : // 无选中(或选中非图片/clip 块)→ 全项目 clip 集合:浏览 / 加入编辑器(新块)/ 删除
        allClips.length === 0 ? (
          <div className="flex items-center gap-2 rounded-md border border-dashed px-2.5 py-3 text-xs text-muted-foreground">
            <ImagePlus className="size-4 shrink-0" />
            {t('clipGen.selectBlockHint')}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {allClips.map((take, i) => (
              <ClipTakeCard key={take.clipId} take={take} projectId={projectId} onOpen={(ev) => lightbox.open(i, ev)} />
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
          {/* 从预设目录挑一条 prompt 填入文本框(选完可再用 AI 改写)。 */}
          <PromptPresetButton onPick={setPromptBody} />
          {/* Prompt Assist:AI 生成(无视正文) / 改写(带现有正文,空则禁用)。源图未上传时禁用。 */}
          <div className="flex gap-1.5">
            <Button
              size="xs"
              variant="outline"
              className="flex-1"
              disabled={awaitingUpload || assist.isPending}
              onClick={() => onAssist('generate')}
            >
              {assist.isPending && assist.variables?.action !== 'improve' ? <Loader2 className="animate-spin" /> : <Wand2 />}
              {t('clipGen.assistGenerate')}
            </Button>
            <Button
              size="xs"
              variant="ghost"
              className="flex-1 text-muted-foreground"
              disabled={awaitingUpload || assist.isPending || !promptBody.trim()}
              onClick={() => onAssist('improve')}
            >
              {assist.isPending && assist.variables?.action === 'improve' ? <Loader2 className="animate-spin" /> : <Sparkles />}
              {t('clipGen.assistImprove')}
            </Button>
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
