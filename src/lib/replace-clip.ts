// 就地把时间线上某个块替换成一段媒体(clip 或原图):保持 from/track/itemId,仅换承载的素材与时长。
// 三方关联的「替换」动作:照片块 ↔ 该图的多个 clip(take)之间就地切换。零改库 —— 只重写 items[itemId]。
import type { EditorStarterAsset, EditorStarterItem, UndoableState } from '@gedatou/shared'
import { editorStore } from '@/editor-app'

const IMAGE_DEFAULT_SECONDS = 5

// 等比装入合成、居中(素材尺寸变了就重新适配画布)
const fitBox = (w: number, h: number, compW: number, compH: number) => {
  if (!w || !h) return { left: 0, top: 0, width: compW, height: compH }
  const scale = Math.min(compW / w, compH / h)
  const width = Math.round(w * scale)
  const height = Math.round(h * scale)
  return { left: Math.round((compW - width) / 2), top: Math.round((compH - height) / 2), width, height }
}

const probeImageSize = (url: string): Promise<{ width: number; height: number }> =>
  new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth || 1920, height: img.naturalHeight || 1080 })
    img.onerror = () => resolve({ width: 1920, height: 1080 })
    img.src = url
  })

type Media =
  | { kind: 'video'; assetId: string; url: string; filename: string; width: number; height: number; durationSeconds: number }
  | { kind: 'image'; assetId: string; url: string; filename: string; width: number; height: number }

const replaceItemMedia = (itemId: string, media: Media): void => {
  const st = editorStore.getState()
  const s = st.undoable
  const fps = s.fps || 30
  const box = fitBox(media.width, media.height, s.compositionWidth, s.compositionHeight)
  // 决策1:换成 clip 时采用 clip 自己的时长;换回原图给默认 5s。
  const durationInFrames =
    media.kind === 'image'
      ? Math.round(fps * IMAGE_DEFAULT_SECONDS)
      : Math.max(1, Math.round(media.durationSeconds * fps))
  const asset: EditorStarterAsset =
    media.kind === 'video'
      ? {
          id: media.assetId,
          url: media.url,
          filename: media.filename,
          sizeInBytes: 0,
          type: 'video',
          width: media.width,
          height: media.height,
          durationInSeconds: media.durationSeconds,
          hasAudio: true,
        }
      : { id: media.assetId, url: media.url, filename: media.filename, sizeInBytes: 0, type: 'image', width: media.width, height: media.height }

  st.updateUndoable((prev): UndoableState => {
    const prevItem = prev.items[itemId]
    if (!prevItem) return prev
    // 保留块的身份与非几何视觉设置(旋转/不透明/圆角/淡入淡出);位置/时长/素材换新。
    const base = {
      id: itemId,
      trackId: prevItem.trackId,
      from: prevItem.from,
      durationInFrames,
      left: box.left,
      top: box.top,
      width: box.width,
      height: box.height,
      rotation: prevItem.rotation,
      opacity: prevItem.opacity,
      borderRadius: prevItem.borderRadius,
      fadeInDurationInFrames: prevItem.fadeInDurationInFrames,
      fadeOutDurationInFrames: prevItem.fadeOutDurationInFrames,
    }
    const item: EditorStarterItem =
      media.kind === 'video'
        ? { ...base, type: 'video', assetId: media.assetId, crop: null, trimBefore: 0, playbackRate: 1, volume: 1, muted: false }
        : { ...base, type: 'image', assetId: media.assetId, crop: null }
    return { ...prev, assets: { ...prev.assets, [media.assetId]: asset }, items: { ...prev.items, [itemId]: item } }
  }, { commit: true })
}

/** 把块就地替换成某条 clip(take)。宽高/时长取 ClipRecord(缺则回退默认)。 */
export const replaceItemWithClip = (
  itemId: string,
  take: {
    clipId: string
    url: string
    width?: number | null
    height?: number | null
    durationSeconds?: number | null
    name?: string | null
  },
): void => {
  replaceItemMedia(itemId, {
    kind: 'video',
    assetId: take.clipId,
    url: take.url,
    filename: take.name || 'clip',
    width: take.width || 1920,
    height: take.height || 1080,
    durationSeconds: take.durationSeconds || IMAGE_DEFAULT_SECONDS,
  })
}

/** 把块就地换回原静态照片(决策2)。探测图片尺寸后重建 image 块。 */
export const revertItemToPhoto = async (
  itemId: string,
  photo: { assetId: string; url: string; name?: string | null },
): Promise<void> => {
  const { width, height } = await probeImageSize(photo.url)
  replaceItemMedia(itemId, { kind: 'image', assetId: photo.assetId, url: photo.url, filename: photo.name || 'photo', width, height })
}
