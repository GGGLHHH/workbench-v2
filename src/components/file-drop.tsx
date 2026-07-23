import { useEffect, useRef, useState, type DragEvent as ReactDragEvent } from 'react'
import { Ban, UploadCloud } from 'lucide-react'
import { type DragKind, dragValidity, isFileDrag } from '@/lib/file-drag'
import { cn } from '@/lib/utils'

// 通用文件拖拽反馈。两级状态:
//  - windowDrag:文件一进浏览器窗口即感知(不必悬停目标),用于「arm」。合法性按 accept(MIME)判。
//  - over:光标是否正悬停在本目标上,用于从 arm 转「强」态。
// 两种用法:
//  - 传 onDrop → 「活动放置区」:自身 preventDefault + 接管 drop(如上传区)。
//  - 不传 onDrop → 「纯观察」:只跟踪 over 供覆盖层用,drop 交给下层/库处理(如编辑器画布/时间轴,
//    库内部已按精确落点调 importFiles;不 preventDefault 就不会抢它的 drop)。

export function useFileDrag({
  accept,
  onDrop,
}: {
  accept?: (mime: string) => boolean
  onDrop?: (files: File[]) => void
} = {}) {
  const [windowDrag, setWindowDrag] = useState<DragKind>('idle')
  const [over, setOver] = useState(false)
  const acceptRef = useRef(accept)
  acceptRef.current = accept

  // window 级 arm:进出计数 + rAF 延迟清除判「离开窗口」——兄弟元素间切换时 leave 先到会打到 0,
  // 但下一帧的 enter 会取消清除 → 不闪;真离开窗口才没有 enter 来救。比 debounce 抗静止、比 relatedTarget 跨浏览器稳。
  useEffect(() => {
    let depth = 0
    let raf = 0
    const clear = () => {
      setWindowDrag('idle')
      setOver(false)
    }
    const onEnter = (e: DragEvent) => {
      if (!isFileDrag(e)) return
      depth += 1
      if (raf) {
        cancelAnimationFrame(raf)
        raf = 0
      }
      setWindowDrag(dragValidity(e, acceptRef.current))
    }
    const onOver = (e: DragEvent) => {
      if (isFileDrag(e)) setWindowDrag(dragValidity(e, acceptRef.current)) // 悬停中类型可能才解析出来 → 保持最新
    }
    const onLeave = (e: DragEvent) => {
      if (!isFileDrag(e)) return
      depth -= 1
      if (depth <= 0) {
        depth = 0
        if (raf) cancelAnimationFrame(raf)
        raf = requestAnimationFrame(clear)
      }
    }
    const onEnd = () => {
      depth = 0
      if (raf) cancelAnimationFrame(raf)
      clear()
    }
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragover', onOver)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('drop', onEnd)
    window.addEventListener('dragend', onEnd)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop', onEnd)
      window.removeEventListener('dragend', onEnd)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  // 局部 over:目标元素进出计数(移过子元素不闪,同样用 rAF 延迟清除)。
  const depthRef = useRef(0)
  const overRaf = useRef(0)
  useEffect(() => () => void (overRaf.current && cancelAnimationFrame(overRaf.current)), [])
  const active = !!onDrop

  const onDragEnter = (e: ReactDragEvent) => {
    if (!isFileDrag(e)) return
    if (active) e.preventDefault()
    depthRef.current += 1
    if (overRaf.current) {
      cancelAnimationFrame(overRaf.current)
      overRaf.current = 0
    }
    setOver(true)
  }
  const onDragLeave = (e: ReactDragEvent) => {
    if (!isFileDrag(e)) return
    depthRef.current -= 1
    if (depthRef.current <= 0) {
      depthRef.current = 0
      if (overRaf.current) cancelAnimationFrame(overRaf.current)
      overRaf.current = requestAnimationFrame(() => setOver(false))
    }
  }
  const dragProps: {
    onDragEnter: (e: ReactDragEvent) => void
    onDragLeave: (e: ReactDragEvent) => void
    onDragOver?: (e: ReactDragEvent) => void
    onDrop?: (e: ReactDragEvent) => void
  } = { onDragEnter, onDragLeave }
  if (active) {
    dragProps.onDragOver = (e) => {
      if (!isFileDrag(e)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = dragValidity(e, acceptRef.current) === 'valid' ? 'copy' : 'none' // 光标:合法拷贝(＋)/非法禁止
    }
    dragProps.onDrop = (e) => {
      e.preventDefault()
      depthRef.current = 0
      if (overRaf.current) cancelAnimationFrame(overRaf.current)
      setOver(false)
      onDrop!(Array.from(e.dataTransfer.files)) // 非法拖入也无妨:调用方按需过滤
    }
  }

  return { windowDrag, over, dragProps }
}

// 拖拽反馈覆盖层:盖住目标(父容器需 relative),armed 脉动引导、over 转强。pointer-events-none —— 观察模式下
// 不吞事件(下层/库照常接 drop);活动模式下 drop 由 useFileDrag 的 dragProps 在容器上接。
export function FileDropOverlay({
  state,
  over,
  labels,
}: {
  state: DragKind
  over?: boolean
  labels: { dragHere: string; dropToUpload: string; dropInvalid: string }
}) {
  if (state === 'idle') return null
  const invalid = state === 'invalid'
  return (
    // 中性冻雾遮罩(bg-background 自动适配明暗,不再是半透明彩色大色块)+ 彩色边框:armed 虚线、over 实线。
    <div
      className={cn(
        'pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-lg border-2 bg-background/70 backdrop-blur-[2px] transition-colors',
        over ? 'border-solid' : 'border-dashed',
        invalid ? (over ? 'border-destructive' : 'border-destructive/60') : over ? 'border-primary' : 'border-primary/60',
      )}
    >
      {/* 只脉动图标+文案,不脉动整块遮罩(避免忽明忽暗发闷) */}
      <div
        className={cn(
          'flex flex-col items-center gap-2',
          invalid ? 'text-destructive' : 'text-primary',
          !over && 'animate-pulse',
        )}
      >
        {invalid ? <Ban className="size-7" /> : <UploadCloud className="size-7" />}
        <span className="text-sm font-medium">{invalid ? labels.dropInvalid : over ? labels.dropToUpload : labels.dragHere}</span>
      </div>
    </div>
  )
}
