export type Panel = 'list' | 'detail'
export type ProjectSummary = {
  id: string
  title: string
  assignee: string | null
  agency: string | null
  status: string
  resourceCount: number
  clipCount: number
  durationSeconds: number
  thumbnailUrl: string | null
  thumbnailKind: string | null
  updatedAt: string
}

// 视口顶部那一条 + 视口切在它内部的像素偏移。存这个而不是 scrollTop:
// scrollTop 依赖"上方所有行的真实高度",行高一被实测修正它就失真。
export type Anchor = { index: number; offsetInItem: number }
