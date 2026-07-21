import type { EditorStarterAsset, EditorStarterItem, Track, UndoableState } from '@gedatou/shared'
import { editorStore } from '@/editor-app'
import i18n from '@/i18n'

// 把「项目详情里的一个资产」加入右侧编辑器:建素材(EditorStarterAsset)+ 一条时间线条目
// (EditorStarterItem),追加到首条轨道末尾。字节不搬 —— 素材 url 用稳定的 /bff/content/<contentId>
// (加载时经 BFF 现解析成新鲜的预签名地址,避开预签名 1h 过期;发布时 isLocal 判否会跳过,不重传)。
//
// 编辑器素材必须带 width/height(视频还要 hasAudio),BffProjectAsset 没有 → 点击时用一个隐藏
// <img>/<video> 元素探测 naturalWidth / videoWidth / duration。图片时长给默认 5s。

// 详情资产的最小形状(contentId 是 BFF 新加字段,生成类型暂未含 → 调用方 cast 传入)
export type AddableAsset = {
  id: string
  url: string
  kind: string | null // image | video | audio
  name?: string | null
  contentId?: string | null
  durationSeconds?: number | null
}

type Probe = { width: number; height: number; duration: number; hasAudio: boolean }

function probeMedia(url: string, kind: string): Promise<Probe> {
  return new Promise((resolve, reject) => {
    if (kind === 'image') {
      const img = new Image()
      img.onload = () => resolve({ width: img.naturalWidth || 1920, height: img.naturalHeight || 1080, duration: 0, hasAudio: false })
      img.onerror = () => reject(new Error(i18n.t('addToEditor.probeImageFailed')))
      img.src = url
    } else {
      // video / audio 都用 video 元素读 metadata(audio 的 videoWidth/Height 为 0)
      const el = document.createElement('video')
      el.preload = 'metadata'
      el.muted = true
      el.onloadedmetadata = () =>
        resolve({
          width: el.videoWidth || 0,
          height: el.videoHeight || 0,
          duration: Number.isFinite(el.duration) ? el.duration : 0,
          // 无可靠的浏览器 API 判有无音轨 → 默认有(用户可在编辑器静音)
          hasAudio: true,
        })
      el.onerror = () => reject(new Error(i18n.t('addToEditor.probeMediaFailed')))
      el.src = url
    }
  })
}

const IMAGE_DEFAULT_SECONDS = 5

export async function addProjectAssetToEditor(asset: AddableAsset): Promise<void> {
  const kind = asset.kind === 'video' || asset.kind === 'audio' ? asset.kind : 'image'
  // 稳定引用:有 contentId 走 /bff/content/<id>;没有则退回原 url(可能是会过期的预签名)
  const url = asset.contentId ? `/bff/content/${asset.contentId}` : asset.url
  const probe = await probeMedia(asset.url, kind)

  const st = editorStore.getState()
  const s = st.undoable
  const fps = s.fps || 30
  const compW = s.compositionWidth
  const compH = s.compositionHeight

  // 素材 id 用 contentId(同一平台内容重复加只建一份素材、多条条目);无则用资产 id
  const assetId = asset.contentId || asset.id
  const filename = asset.name || 'asset'
  const durationInSeconds = probe.duration || asset.durationSeconds || 0

  const editorAsset: EditorStarterAsset =
    kind === 'image'
      ? { id: assetId, url, filename, sizeInBytes: 0, type: 'image', width: probe.width, height: probe.height }
      : kind === 'video'
        ? {
            id: assetId,
            url,
            filename,
            sizeInBytes: 0,
            type: 'video',
            width: probe.width,
            height: probe.height,
            durationInSeconds,
            hasAudio: probe.hasAudio,
          }
        : { id: assetId, url, filename, sizeInBytes: 0, type: 'audio', durationInSeconds }

  const durationInFrames =
    kind === 'image' ? Math.round(fps * IMAGE_DEFAULT_SECONDS) : Math.max(1, Math.round(durationInSeconds * fps))

  // 画布铺放:等比缩放装入合成、居中(audio 无视觉,给全画幅默认值,编辑器不在画布渲染它)
  const fit = () => {
    if (kind === 'audio' || !probe.width || !probe.height) return { left: 0, top: 0, width: compW, height: compH }
    const scale = Math.min(compW / probe.width, compH / probe.height)
    const w = Math.round(probe.width * scale)
    const h = Math.round(probe.height * scale)
    return { left: Math.round((compW - w) / 2), top: Math.round((compH - h) / 2), width: w, height: h }
  }
  const box = fit()
  const itemId = crypto.randomUUID()

  st.updateUndoable((prev): UndoableState => {
    // 无轨道则建一条;目标轨道 = 首条;from = 该轨道末尾(顺排,避免叠放)
    const tracks: Track[] = prev.tracks.length
      ? prev.tracks
      : [{ id: crypto.randomUUID(), name: 'Track 1', hidden: false, muted: false }]
    const trackId = tracks[0].id
    const from = Object.values(prev.items)
      .filter((it) => it.trackId === trackId)
      .reduce((end, it) => Math.max(end, it.from + it.durationInFrames), 0)

    const base = {
      id: itemId,
      trackId,
      from,
      durationInFrames,
      left: box.left,
      top: box.top,
      width: box.width,
      height: box.height,
      rotation: 0,
      opacity: 1,
      borderRadius: 0,
      fadeInDurationInFrames: 0,
      fadeOutDurationInFrames: 0,
    }
    const item: EditorStarterItem =
      kind === 'image'
        ? { ...base, type: 'image', assetId, crop: null }
        : kind === 'video'
          ? { ...base, type: 'video', assetId, crop: null, trimBefore: 0, playbackRate: 1, volume: 1, muted: false }
          : { ...base, type: 'audio', assetId, trimBefore: 0, playbackRate: 1, volume: 1, muted: false }

    return {
      ...prev,
      tracks,
      assets: { ...prev.assets, [assetId]: editorAsset },
      items: { ...prev.items, [itemId]: item },
    }
  }, { commit: true })

  st.setSelected([itemId]) // 选中新条目,给点反馈
}
