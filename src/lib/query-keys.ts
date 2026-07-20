// 查询键工厂:按业务域分层(对齐 xchangeai-web/src/lib/query-keys)。
// session 独立(会话软探测,api-client/router-auth 都读它);projects 下分 list/stats/detail。
//
// list 与 stats 共享 [...projects.all] 前缀、且读的是同一批项目(行 + 状态计数)——任何改到
// status 的写入都要让两者一起失效(见 api/projects invalidateProjectListViews)。detail 走独立
// 子键,不被列表失效波及(否则会重拉冲掉详情里的嵌套数据)。
const projectsRoot = ['bff', 'projects'] as const

export interface ProjectListParams {
  search: string
  status: string
  sort: string
}

export const queryKeys = {
  session: () => ['session'] as const,
  projects: {
    all: projectsRoot,
    lists: () => [...projectsRoot, 'list'] as const,
    list: (params: ProjectListParams) => [...projectsRoot, 'list', params] as const,
    // 单页(按页随机访问:虚拟化器要第 N 屏,就只取覆盖它的那几页)。
    // 挂在 list(params) 之下 → 现有的 lists() 前缀失效/乐观写入照样命中。
    page: (params: ProjectListParams, index: number) =>
      [...projectsRoot, 'list', params, index] as const,
    stats: () => [...projectsRoot, 'stats'] as const,
    detail: (id: string) => [...projectsRoot, 'detail', id] as const,
    // 表单下拉候选:全局一份,不随项目变 → 平级于 list/detail
    options: () => [...projectsRoot, 'options'] as const,
  },
}
