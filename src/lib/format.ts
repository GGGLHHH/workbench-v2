import { format, formatDistanceToNow } from 'date-fns'

/** 状态串人类化:下划线换空格 */
export const statusLabel = (status: string) => status.replaceAll('_', ' ')

/** 相对时间(date-fns),如 "5 minutes ago";解析失败原样返回 */
export const relTime = (iso: string) => {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true })
  } catch {
    return iso
  }
}

/** 绝对时间 yyyy-MM-dd HH:mm(本地时区);解析失败原样返回 */
export const absTime = (iso: string) => {
  try {
    return format(new Date(iso), 'yyyy-MM-dd HH:mm')
  } catch {
    return iso
  }
}

/** 价格:Intl USD、无小数;非数字返回 null */
export const usd = (n: number | null | undefined) =>
  typeof n === 'number'
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
    : null
