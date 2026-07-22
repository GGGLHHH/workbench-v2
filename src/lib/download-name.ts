// 渲染产物下载名策略(自 @gedatou/shared 签出:「项目名 + 导出时刻」是产品约定,不是库能力)。
// 经 EditorDeps.exportFileName 注入(见 editor-app.tsx);服务端仍用库的 sanitizeFileName 防御清洗。

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** 本地时区的 YYYY-MM-DD HH:mm:ss */
export const formatStamp = (d: Date): string =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
  `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`

/** 去掉文件系统非法字符并压缩空白;保留中文与连字符。限长防超头。
 *  用于名字的「基础名」部分(项目地址等),故连冒号一起去掉——时间戳的冒号是后拼的。 */
export const sanitizeBaseName = (name: string): string =>
  name.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)

/** 前端组装:`${baseName} ${YYYY-MM-DD HH:mm:ss}.${codec}`;无 baseName 则只有时间戳。 */
export const buildDownloadName = (codec: string, baseName: string | undefined, now: Date): string => {
  const cleaned = baseName ? sanitizeBaseName(baseName) : ''
  return `${cleaned ? `${cleaned} ` : ''}${formatStamp(now)}.${codec}`
}
