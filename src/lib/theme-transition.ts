// 主题切换的圆形揭示动画(从 xchangeai-web 接过来):以最后的鼠标位置为圆心,clip-path 圆从 0
// 扩到覆盖全屏,把新主题揭示在旧主题之上。走 View Transitions API;不支持 / 用户偏好减少动效时
// 直接切换,无动画。配套 CSS 见 index.css 的 .theme-transitioning 规则。
let lastMouseX = typeof window !== 'undefined' ? window.innerWidth / 2 : 0
let lastMouseY = typeof window !== 'undefined' ? window.innerHeight / 2 : 0

if (typeof window !== 'undefined') {
  window.addEventListener(
    'mousemove',
    (event) => {
      lastMouseX = event.clientX
      lastMouseY = event.clientY
    },
    { passive: true },
  )
}

export function toggleThemeWithTransition(callback: () => void): void {
  const reduceMotion =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (typeof document === 'undefined' || !('startViewTransition' in document) || reduceMotion) {
    callback()
    return
  }

  const x = lastMouseX
  const y = lastMouseY
  const endRadius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))

  document.documentElement.classList.add('theme-transitioning')

  const transition = document.startViewTransition(async () => {
    callback()
    // 让 next-themes 把 .dark class 落到 DOM 后再快照新态
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  transition.ready.then(() => {
    document.documentElement.animate(
      {
        clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${endRadius}px at ${x}px ${y}px)`],
      },
      {
        duration: 400,
        easing: 'ease-in-out',
        pseudoElement: '::view-transition-new(root)',
      },
    )
  })

  transition.finished.finally(() => {
    document.documentElement.classList.remove('theme-transitioning')
  })
}
