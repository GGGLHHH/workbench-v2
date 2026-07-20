import React, { useRef } from 'react'
import type { MouseEventHandler, ReactNode } from 'react'
import { motion, useInView } from 'motion/react'

// 取自 React Bits 的 AnimatedList,只保留 item 层(滚入视野时 scale/opacity 入场)。
// 原组件的容器层已裁掉:它自带 w-[500px]/max-h-[400px] 滚动容器、写死 #120F17 的上下渐变、
// 自定义滚动条,与 ScrollArea + useScrollFade + scrollbar 枚举三处重复;items 也只收 string[],
// 装不下 ProjectCard。它还把 keydown 挂在 window 上并 preventDefault 掉 Tab/方向键,
// 会劫持整个 app 的键盘导航(含详情面板的表单)。要恢复原版见 reactbits.dev/components/animated-list

interface AnimatedItemProps {
  children: ReactNode
  delay?: number
  index: number
  onMouseEnter?: MouseEventHandler<HTMLDivElement>
  onClick?: MouseEventHandler<HTMLDivElement>
  /** 容器自己排版时置空,去掉默认的 mb-4/cursor-pointer */
  className?: string
}

export const AnimatedItem: React.FC<AnimatedItemProps> = ({
  children,
  delay = 0,
  index,
  onMouseEnter,
  onClick,
  className = 'mb-4 cursor-pointer',
}) => {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { amount: 0.5, once: false })
  return (
    <motion.div
      ref={ref}
      data-index={index}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
      initial={{ scale: 0.7, opacity: 0 }}
      animate={inView ? { scale: 1, opacity: 1 } : { scale: 0.7, opacity: 0 }}
      transition={{ duration: 0.2, delay }}
      className={className}
    >
      {children}
    </motion.div>
  )
}
