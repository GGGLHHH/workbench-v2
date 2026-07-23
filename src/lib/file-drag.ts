// 文件拖拽的纯判定(供 components/file-drop 用)。拖拽过程中浏览器只暴露 MIME/kind,故合法性只能按 MIME 判。
export type DragKind = 'idle' | 'valid' | 'invalid'

type DTLike = { dataTransfer: DataTransfer | null }

export const isFileDrag = (e: DTLike) => Array.from(e.dataTransfer?.types ?? []).includes('Files')

export const dragValidity = (e: DTLike, accept?: (mime: string) => boolean): 'valid' | 'invalid' => {
  const known = Array.from(e.dataTransfer?.items ?? []).filter((i) => i.kind === 'file' && i.type)
  // 无已知类型(部分浏览器拖拽时不给)或无 accept 限制 → 一律合法;有限制且无一命中 → 非法
  if (!known.length || !accept) return 'valid'
  return known.some((i) => accept(i.type)) ? 'valid' : 'invalid'
}
