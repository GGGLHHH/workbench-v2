import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import zh from './locales/zh.json'
import en from './locales/en.json'

// i18n 单例（模块级 side-effect 初始化，main.tsx 顶部 import './i18n' 即生效）。
// 资源内联在 zh.json / en.json（收拢的全部 UI 文案），非 React 模块用 i18n.t()，
// React 组件用 useTranslation()。语言：localStorage > 浏览器语言前缀 > 默认 zh。
export type Lang = 'zh' | 'en'
const STORAGE_KEY = 'lang'

const detect = (): Lang => {
  const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
  if (saved === 'zh' || saved === 'en') return saved
  return 'en' // 默认英文；用户显式切换后走 localStorage
}

void i18n.use(initReactI18next).init({
  resources: { zh: { translation: zh }, en: { translation: en } },
  lng: detect(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false }, // React 已做 XSS 转义
  returnNull: false,
})

/** 切换语言并持久化（供语言切换控件调用）。 */
export function setLanguage(lng: Lang): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, lng)
  void i18n.changeLanguage(lng)
}

export default i18n
