import { registerRoot } from 'remotion'
import { CompositionRoot } from '@gedatou/shared/composition'
import './overlays/register'

// 服务端渲染入口:BFF bundle 此文件而非库内 entry —— 先注册业务 custom item 渲染器,
// 再注册库的 composition,否则渲染 bundle 里查不到 lowerThird/cover 渲染器(画面为空)。
registerRoot(CompositionRoot)
