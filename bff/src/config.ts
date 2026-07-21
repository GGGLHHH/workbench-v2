const port = Number(process.env.BFF_PORT ?? 4100);

/** BFF 配置:前端唯一入口(控制面 + 产品面 + 业务面)。两个下游都藏在其后。 */
export const config = {
  port,
  // 下游①渲染服务(server/):编辑器 transport 契约的实现方(/api/*)。
  // 默认从共享的 RENDER_PORT 派生(见 .env.example),和 server 自身绑定的口同源、天然一致;
  // RENDER_UPSTREAM 是整段 URL 覆盖(server 部署到别处/远端时用)。
  renderUpstream: process.env.RENDER_UPSTREAM ?? `http://localhost:${process.env.RENDER_PORT ?? 3011}`,
  // 下游②xchangeai-server(Go/huma):业务数据面。BFF 服务端用 typed client 调它,
  // 前端不认它。鉴权按用户:登录时转发凭据拿 xchangeai 会话 cookie 回传浏览器,
  // 之后每请求把浏览器带来的 cookie 透传给 xchangeai(见 xchange-client/session)。
  xchangeUpstream: process.env.XCHANGE_UPSTREAM ?? 'http://localhost:8080',
};
