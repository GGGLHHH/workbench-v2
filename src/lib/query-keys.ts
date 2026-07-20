// 单一 surface(不像 xchangeai-web 分 admin/public)。会话缓存键。
export const queryKeys = {
  session: () => ['session'] as const,
}
