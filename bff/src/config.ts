const port = Number(process.env.BFF_PORT ?? 4100);

/** BFF 配置:前端唯一入口(控制面 + 产品面)。渲染服务为其下游。 */
export const config = {
  port,
  // 下游渲染服务(server/):编辑器 transport 契约的实现方
  renderUpstream: process.env.RENDER_UPSTREAM ?? 'http://localhost:3011',
};
