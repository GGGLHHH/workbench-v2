import { editorStore } from '@/editor-app'
import {
  applyBanner,
  applyBannerText,
  applyCover,
  applyCoverScale,
  applyEndCover,
  applyWatermark,
  type BannerConfig,
  type ListingMeta,
  type OverlayScale,
  type WatermarkLogo,
  type WatermarkPosition,
} from '@/lib/video-overlays'

// 把纯变换派发进编辑器单例(与「加入编辑器」同一入口):编辑器实时预览 + 走原有 Save 落库。
// { commit: true } 每次叠加改动记一条 undo。守卫「编辑器是否已加载本项目」由调用方(侧栏)负责。

export function setBanner(meta: ListingMeta, patch: Partial<BannerConfig>): void {
  editorStore.getState().updateUndoable((s) => applyBanner(s, meta, patch), { commit: true })
}

export function refreshBannerText(meta: ListingMeta): void {
  editorStore.getState().updateUndoable((s) => applyBannerText(s, meta), { commit: true })
}

export function setCover(meta: ListingMeta, on: boolean): void {
  editorStore.getState().updateUndoable((s) => applyCover(s, meta, on), { commit: true })
}

export function setEndCover(meta: ListingMeta, on: boolean): void {
  editorStore.getState().updateUndoable((s) => applyEndCover(s, meta, on), { commit: true })
}

export function setCoverScale(scale: OverlayScale): void {
  editorStore.getState().updateUndoable((s) => applyCoverScale(s, scale), { commit: true })
}

export function setWatermark(patch: { on?: boolean; position?: WatermarkPosition; opacity?: number; logo?: WatermarkLogo }): void {
  editorStore.getState().updateUndoable((s) => applyWatermark(s, patch), { commit: true })
}
