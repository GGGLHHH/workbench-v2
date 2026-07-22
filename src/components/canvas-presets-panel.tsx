import { useEditor } from '@gedatou/editor'
import { Button } from '@/components/ui/button'
import { ASPECT_PRESETS, RES_PRESETS, aspectDims, isAspect, scaleToShort } from '@/lib/canvas-presets'

// 画布尺寸预设(v2 产品功能):注入 @gedatou/editor 检查器「画布」区的 canvasExtra 槽,
// 与宽高输入框同区呈现。计算在 lib/canvas-presets(自库签出:严格对齐官方后库不含预设)。
// 比例键保留当前短边换比例;分辨率键保留比例缩放短边。
export function CanvasPresetsPanel() {
  const w = useEditor((s) => s.undoable.compositionWidth)
  const h = useEditor((s) => s.undoable.compositionHeight)
  const updateUndoable = useEditor((s) => s.updateUndoable)
  const setCanvas = (nw: number, nh: number) =>
    updateUndoable((s) => ({ ...s, compositionWidth: nw, compositionHeight: nh }))
  return (
    <>
      <div className="mt-2 flex gap-1">
        {ASPECT_PRESETS.map(([label, aw, ah]) => (
          <Button
            key={label}
            variant={isAspect(w, h, aw, ah) ? 'default' : 'outline'}
            size="sm"
            className="h-7 flex-1 px-1 text-xs tabular-nums"
            onClick={() => {
              const d = aspectDims(aw, ah, Math.min(w, h))
              setCanvas(d.w, d.h)
            }}
          >
            {label}
          </Button>
        ))}
      </div>
      <div className="mt-1 flex gap-1">
        {RES_PRESETS.map(([label, short]) => (
          <Button
            key={label}
            variant={Math.min(w, h) === short ? 'default' : 'outline'}
            size="sm"
            className="h-7 flex-1 px-1 text-xs tabular-nums"
            onClick={() => {
              const d = scaleToShort(w, h, short)
              setCanvas(d.w, d.h)
            }}
          >
            {label}
          </Button>
        ))}
      </div>
    </>
  )
}
