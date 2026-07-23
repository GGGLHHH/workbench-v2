# AI 图生视频服务层(workbench-v2)— 设计

> 目标:在 workbench-v2 里从头实现干净的「AI 图生视频(image-to-video clip 生成)」服务层。
> xchangeai-workbench 是参考(其 `server/providers.js` 1093 行单文件又乱又重复,**只取知识不照抄结构**)。
> 本 spec 覆盖**第一步:服务层接线**(server 底层实现 + bff 归一契约)。客户端 UI / 时间线接入 / 候选take 模型是后续步骤。

## 分层职责

| 层 | 职责 |
|---|---|
| **server/**(Fastify, :3011) | 底层实现:真调 provider、异步任务、落盘。入参贴近实现(绝对 imageUrl + 已编译 prompt),不懂业务。镜像现有 `renderer.ts` 的 tasks/轮询 + `storage.ts` 落盘 + `/media` 静态。 |
| **bff/**(Fastify, :4100) | 归一:前端友好参数 ↔ server 底层参数互译;typed `/bff/*` + swagger → 前端 codegen。做 4 件事:①图片引用解析 ②prompt 合成 ③时长吸附 ④provider 目录/任务状态归一。 |

**无 S3/R2**:v2 已有本地存储(`storage.ts`)。输入图在真实流程里来自 xchangeai content(BFF 解析出的 `download_url` 本就是公网预签名),public-url 类 provider 直接用它;clip 输出走 v2 本地 `writeBuffer('clips/…')→/media`。

## 已定决策(用户批准「按推荐方向走」)

1. 粒度:`POST /bff/clips` = 单图单 clip;批量交上层 fan-out。
2. prompt 合成放 **BFF**(运镜/焦点/光照 + 保真护栏 → 一条已编译 prompt);server 只收成品,不再加工。
3. 进度单位:server/bff 均 **0-1**(与 `renderer.ts` 对齐)。
4. 成片落点:本机 `/media/clips/`;交付 xchangeai 留后续。
5. provider:全量声明式描述符(Gemini Omni / Veo×3 / Seedance / Runway×2 / fal-Kling / Luma×2 / MiniMax / LTX)+ mock。base64/data-uri 类本地开箱可用;public-url 类需(BFF 提供的)公网输入 URL。

## server/ 底层契约(`/api/*`,BFF 自动代理)

```ts
GET  /api/clip-providers
→ { providers: Array<{ id; label; inputMode: 'base64'|'data-uri'|'public-url';
      durations: { adjustable; values: number[]|null; min: number|null; max: number|null };
      referenceImages: { supported; max }; configured; configurationIssue: string|null }> }

POST /api/generate-clip
  body { provider?; imageUrl: string; prompt: string; durationSeconds?; aspectRatio?; referenceImageUrls?: string[] }
→ 202 { taskId }

POST /api/clip-progress
  body { taskId }
→ 200 { status: 'queued'|'generating'|'done'|'error'; progress /*0-1*/; url?; provider?; providerJobId?; durationSeconds?; error? }
→ 404 { error }
```

## bff/ 归一契约(`/bff/*`,swagger → codegen)

```ts
GET  /bff/clip-providers                 operationId: listBffClipProviders  → BffClipProviderList
POST /bff/clips                          operationId: generateBffClip       → BffClipTask
GET  /bff/clips/:taskId                  operationId: getBffClip            → BffClipTask
```

- `BffClipProvider`: `{ id; label; durations{adjustable,values,min,max}; referenceImages{supported,max}; configured; configurationIssue }`(丢 server-only 的 inputMode)。
- `BffGenerateClipRequest`: `{ imageUrl; provider?; durationSeconds?; aspectRatio?; promptBody?; cameraMove?; focusSubject?; lightTransition?; referenceImageUrls?[] }`。
- `BffClipTask`: `{ taskId; status; progress /*0-1*/; url|null; provider|null; durationSeconds|null; error|null }`。

**BFF→server 映射**(`generateBffClip`):①`imageUrl` 若 `/bff/content/<id>` → `getUpload` 取 `download_url`(公网),否则原样;referenceImageUrls 同。②`prompt = compileClipPrompt({promptBody,cameraMove,focusSubject,lightTransition})`。③`durationSeconds` 按 provider 吸附。④`fetch(renderUpstream+'/api/generate-clip', …)`。

## 模块布局(`server/src/clip/`)

- `types.ts` — `Provider`/`ClipInput`/`ClipResult`/`ProviderDescriptor`/`Durations`/`InputMode`/`ClipTask`。
- `config.ts` — 一次性读 provider env → typed config(endpoints/keys/models/durations/poll)。
- `prompt.ts` — 端口 `PROPERTY_FIDELITY_GUARDRAIL` + `compileClipPrompt`(运镜/焦点/光照;护栏置顶)。
- `image-input.ts` — `resolveImageInput(imageUrl, inputMode, fetchImpl)` → `{base64,mimeType}` 或 `{publicUrl}`(**无 R2**)。
- `engine.ts` — 单一 submit→poll→download 引擎:`jsonRequest` / `pollTask` / `downloadVideo` / 进度曲线;`fetch` 依赖注入。
- `descriptors.ts` — 6 个 HTTP provider 声明式描述符(submit 路径 / body 构造器 / status 路径 / 字段提取器)。
- `gemini.ts` — bespoke:Veo + GeminiOmni(`@google/genai`)。
- `mock.ts` — bespoke:本地 ffmpeg zoompan(免花钱本地测)。
- `providers.ts` — 注册表:`getProviderName`/`getProviderOptions`/`createProvider`/`normalizeProviderName`/`getConfigurationIssue`/`getProviderDurations`/`getProviderReferenceSupport`/`snapProviderDuration`/`formatProviderError`。
- `service.ts` — `enqueueClip(input) → taskId` + `clipTasks` Map,镜像 `renderer.ts`;产物 `writeBuffer('clips/…')`。

## 测试接缝(沿用 xchangeai 已验证 + 补它缺的)

- HTTP provider:`fetch` 依赖注入(路由表 `"METHOD url"→payload`,捕获请求断言 body/headers)+ `*_POLL_INTERVAL_MS=0`。
- **补齐 xchangeai 缺的覆盖**:`pollTask` 多轮/超时/失败/无URL 分支;Gemini/Veo(`vi.mock('@google/genai')`);mock provider;registry 默认/别名/config-issue;时长吸附。
- service:注入 mock provider,端到端断言 task 进度/落盘。

## 契约保真(从 xchangeai 逐字端口的请求体,不得漂移)

- Seedance:`input.image_urls[]`(hero + ≤2 参考,max 3)、`duration`、`aspect_ratio`;`Authorization: Bearer`。
- Runway:`{ model, promptImage, promptText, ratio, duration }`(gen4_turbo,ratio 如 `1280:720`,duration 5/10)。
- fal-Kling:`{ image_url(dataUri 或 url), prompt, duration:string枚举, aspect_ratio }`;`Authorization: Key`。
- Luma:`{ model:'ray-2', keyframes.frame0.url, prompt }`。
- MiniMax:`{ model, first_frame_image, prompt }` → 二段 file 取回。
- LTX:`{ image_uri, prompt, model, duration, resolution, fps, generate_audio }`。
- Veo:first-frame image 与 referenceImages 互斥,hero-first,≤3。
- 默认 provider:`ltx-2-3-fast`;别名归一(veo-fast→veo-3.1-fast 等)。
