import { registerCustomItem } from '@gedatou/shared'
import { COVER_KIND, LOWER_THIRD_KIND } from './overlay-design'
import { CoverRenderer, LowerThirdRenderer } from './renderers'

// 副作用模块:把业务叠加渲染器注册进库的 custom item 注册表。
// 必须在两个入口都 import:编辑器 app(editor-app.tsx,预览)和 render-entry.tsx(服务端渲染 bundle)。
registerCustomItem(LOWER_THIRD_KIND, LowerThirdRenderer)
registerCustomItem(COVER_KIND, CoverRenderer)
