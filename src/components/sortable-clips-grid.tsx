import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

// 二维网格拖拽排序(D 方案),项目里凡是"拖着排一组缩略图"的都复用它(项目资产 Clips 组、组合生成源图序列)。
// @dnd-kit 三件套:
//   - DragOverlay:拖拽浮层 portal 到 body、1:1 跟指针,真实网格在下面重排 → 快拖不脱手,且不受祖先 transform 影响。
//   - rectSortingStrategy:专为二维网格的排序/让位策略。
//   - PointerSensor 的 5px 激活阈值:天然区分「拖 vs 点」——纯点击不触发拖拽 → 瓦片 onClick 照常(如开预览),无需手写守卫。
//   - KeyboardSensor:键盘可排序,a11y 免费。
// order 只存稳定键(getKey,通常是 content_id / ref):底层重建 id 也不影响 → 渲染按 key 取最新对象。
// 落库交给 onReorder(新的键顺序);组件不认业务,纯排序 + 渲染回调。renderTile 收 (item, index) 以便画序号类角标。
export function SortableClipsGrid<T>({
  items,
  getKey,
  renderTile,
  onReorder,
}: {
  items: T[]
  getKey: (item: T) => string
  renderTile: (item: T, index: number) => ReactNode
  onReorder: (keys: string[]) => void
}) {
  const byKey = new Map(items.map((it) => [getKey(it), it]))
  const [order, setOrder] = useState<string[]>(() => items.map(getKey))
  const [activeId, setActiveId] = useState<string | null>(null)

  // 仅成员(增删 / 落库回填)变化时 resync:留存活项原顺序 + 末尾补新(拖动中成员不变 → 不打断、不乱序)
  const memberSig = [...byKey.keys()].sort().join('|')
  useEffect(() => {
    setOrder((prev) => {
      const kept = prev.filter((k) => byKey.has(k))
      const added = [...byKey.keys()].filter((k) => !prev.includes(k))
      return kept.length === prev.length && added.length === 0 ? prev : [...kept, ...added]
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberSig])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const ordered = order.map((k) => byKey.get(k)).filter((it): it is T => it != null)
  const orderedKeys = ordered.map(getKey)
  const active = activeId != null ? byKey.get(activeId) : null

  const onDragStart = ({ active }: DragStartEvent) => setActiveId(String(active.id))
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null)
    if (!over || active.id === over.id) return
    const next = arrayMove(orderedKeys, orderedKeys.indexOf(String(active.id)), orderedKeys.indexOf(String(over.id)))
    setOrder(next)
    onReorder(next)
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <SortableContext items={orderedKeys} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-4 gap-1.5">
          {ordered.map((it, i) => (
            <SortableTile key={getKey(it)} id={getKey(it)}>
              {renderTile(it, i)}
            </SortableTile>
          ))}
        </div>
      </SortableContext>
      {/* 拖拽浮层跟指针 1:1;真实项拖动中变淡(见 SortableTile)。
          portal 到 body:面板可能处于带 transform 的祖先内(如 Embla 切 Tab 的 translate3d),transform 会让
          DragOverlay 的 position:fixed 相对该祖先而非视口定位 → 浮层偏到指针右下。挂到 body 脱离 transform 祖先即修复;
          createPortal 保留 DndContext。 */}
      {createPortal(
        <DragOverlay>
          {active ? (
            <div className="group relative rounded-md shadow-xl">{renderTile(active, orderedKeys.indexOf(String(activeId)))}</div>
          ) : null}
        </DragOverlay>,
        document.body,
      )}
    </DndContext>
  )
}

// 单个可排序瓦片:整块可拖(listeners),5px 阈值内的点击照常穿到内部按钮;拖动中变淡,浮层是可见的那份。
function SortableTile({ id, children }: { id: string; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.35 : 1 }}
      {...attributes}
      {...listeners}
      className="group relative cursor-grab rounded-md outline-none active:cursor-grabbing"
    >
      {children}
    </div>
  )
}
