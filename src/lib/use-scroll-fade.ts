import { useEffect, type RefObject } from 'react'

// scroll-fade:按滚动位置给视口加边缘渐隐 mask —— 只有该方向还有更多内容时才隐,到边则不隐。
// 用于列表上下阴影、状态 tab 左右阴影、评论时间线上下阴影等。
export function useScrollFade(
  ref: RefObject<HTMLDivElement | null>,
  orientation: 'vertical' | 'horizontal',
) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const FADE = 24
    let lastMask = ''
    const apply = () => {
      const start = orientation === 'vertical' ? el.scrollTop > 1 : el.scrollLeft > 1
      const end =
        orientation === 'vertical'
          ? el.scrollTop + el.clientHeight < el.scrollHeight - 1
          : el.scrollLeft + el.clientWidth < el.scrollWidth - 1
      const dir = orientation === 'vertical' ? 'to bottom' : 'to right'
      const mask = `linear-gradient(${dir}, ${start ? 'transparent' : '#000'}, #000 ${FADE}px, #000 calc(100% - ${FADE}px), ${end ? 'transparent' : '#000'})`
      // 遮罩只有四种取值(两个布尔),值没变就别写 —— 改 mask-image 会让整层重绘,
      // 每个 scroll 事件都写一次是滚动卡顿的另一个来源。
      if (mask === lastMask) return
      lastMask = mask
      el.style.setProperty('mask-image', mask)
      el.style.setProperty('-webkit-mask-image', mask)
    }
    let raf = 0
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(() => ((raf = 0), apply()))
    }
    apply()
    el.addEventListener('scroll', onScroll, { passive: true })
    // 视口尺寸不随内容变 —— 只观察 el,内容变高(切 view/edit、加载更多)时不会重算,
    // 遮罩就停在旧状态。连内容容器一起观察才盖得住。
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      el.removeEventListener('scroll', onScroll)
      ro.disconnect()
    }
  }, [ref, orientation])
}
