import * as React from "react"
import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area"

import { cn } from "@/lib/utils"

/**
 * 滚动条显示策略:
 * - hover  默认。平时隐去,指针进入或正在滚动时淡入(靠 Base UI 自带的
 *          data-hovering / data-scrolling,不用自己挂 group)
 * - always 常驻(shadcn 原版行为)
 * - none   完全不渲染(滚动照常)。用于边缘渐隐已经在示意可滚动的地方
 */
type ScrollbarMode = "always" | "hover" | "none"

function ScrollArea({
  className,
  children,
  viewportRef,
  viewportStyle,
  scrollbar = "hover",
  ...props
}: ScrollAreaPrimitive.Root.Props & {
  viewportRef?: React.Ref<HTMLDivElement>
  // 定高/滚动直接挂 Viewport(它才是滚动容器):Root 上的 max-height 不能约束 size-full 的
  // 百分比高度,列表会溢出。给 { maxHeight, overflowY:'auto' } 让 Viewport 自身封顶并滚动。
  viewportStyle?: React.CSSProperties
  scrollbar?: ScrollbarMode
}) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn("relative", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        ref={viewportRef}
        data-slot="scroll-area-viewport"
        style={viewportStyle}
        className="size-full rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1"
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      {scrollbar === "none" ? null : (
        <>
          <ScrollBar mode={scrollbar} />
          <ScrollBar mode={scrollbar} orientation="horizontal" />
          <ScrollAreaPrimitive.Corner />
        </>
      )}
    </ScrollAreaPrimitive.Root>
  )
}

function ScrollBar({
  className,
  orientation = "vertical",
  mode = "hover",
  ...props
}: ScrollAreaPrimitive.Scrollbar.Props & { mode?: ScrollbarMode }) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      data-slot="scroll-area-scrollbar"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        "flex touch-none p-px transition-[color,opacity] select-none data-horizontal:h-2.5 data-horizontal:flex-col data-horizontal:border-t data-horizontal:border-t-transparent data-vertical:h-full data-vertical:w-2.5 data-vertical:border-l data-vertical:border-l-transparent",
        mode === "hover" && "opacity-0 data-hovering:opacity-100 data-scrolling:opacity-100",
        className
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb
        data-slot="scroll-area-thumb"
        className="relative flex-1 rounded-full bg-border"
      />
    </ScrollAreaPrimitive.Scrollbar>
  )
}

export { ScrollArea, ScrollBar, type ScrollbarMode }
