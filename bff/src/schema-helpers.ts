// BFF 共享的零依赖 schema 构造小工具(谁都能安全 import,同 media.ts 的动机)。

/** nullable 类型:{ type: [type, 'null'] }。projects.ts / clips.ts 原各手写一份同构实现。 */
export const nullable = (type: 'string' | 'number') => ({ type: [type, 'null'] }) as const

/**
 * 分页 envelope schema:{ items, total, limit, offset },items 指向传入的 $id。
 * Tag/PromptPreset/Option/Project 四处本来各手抄一遍这段骨架,新增分页资源就得再复制、易漏改。
 */
export const pageSchema = (id: string, itemRef: string) => ({
  $id: id,
  type: 'object',
  required: ['items', 'total', 'limit', 'offset'],
  properties: {
    items: { type: 'array', items: { $ref: `${itemRef}#` } },
    total: { type: 'integer' },
    limit: { type: 'integer' },
    offset: { type: 'integer' },
  },
})
