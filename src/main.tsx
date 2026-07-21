import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import './index.css'
import './i18n' // i18n 单例初始化（须在任何组件用 t 之前）
import { router } from './router'

// 入口极简:所有接线在 router.tsx / __root.tsx。QueryClientProvider 在 __root。
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
