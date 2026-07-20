import type { ParsedLocation } from '@tanstack/react-router'

/**
 * 列表滚动位置的缓存键 —— 只认「决定列表内容」的那几个筛选参数。
 *
 * 默认键是整个 href,那样选中项目(?project=xxx)也会换键、滚动位置就丢了。
 * 换筛选 = 换了一批数据,回顶是对的;换选中项 = 同一批数据,位置该留着。
 *
 * 写在这里而不是 router.tsx:router 经 routeTree 间接 import 到组件,
 * 组件再反过来 import router 会成环。读写两端必须用同一个函数 ——
 * router 的 getScrollRestorationKey 管写,useElementScrollRestoration 的 getKey 管读,
 * 它俩各有各的默认值,不显式对齐就会「存得进去读不出来」。
 */
export const listScrollKey = (location: ParsedLocation): string => {
  const s = location.search as { search?: string; status?: string; sort?: string }
  return `${location.pathname}?${s.search ?? ''}|${s.status ?? ''}|${s.sort ?? ''}`
}
