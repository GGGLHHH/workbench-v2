/**
 * 媒体类型判定。单独成模块的两个理由:
 *  1. 它已经错过一次 —— .txt 被判成 image,评论附件渲染出碎图。需要能被测试直接 import。
 *  2. projects.ts 依赖 fastify,而 fastify 的类型增强只在 bff 的 tsconfig 里生效;
 *     纯函数留在那儿的话,前端侧的测试一 import 就把整套 fastify 类型拖进来炸掉 typecheck。
 * 这里零依赖,谁都能安全 import。
 */
export type MediaKind = 'image' | 'video' | 'file'

export const mediaKind = (mime: string | null | undefined): MediaKind => {
  const m = String(mime || '')
  return m.startsWith('video/') ? 'video' : m.startsWith('image/') ? 'image' : 'file'
}
