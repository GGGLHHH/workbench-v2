// AI 图生视频服务层 —— 共享类型契约。
// 参考 xchangeai-workbench/server/providers.js 的能力语义,但结构从头设计:
// 声明式 descriptor + 单一 HTTP 引擎,provider 之间零重复。

/** provider 需要什么形态的输入图。base64/data-uri 本地即可;public-url 需公网可达 URL。 */
export type InputMode = 'base64' | 'data-uri' | 'public-url';

/** 模型接受的 clip 时长。adjustable:false = 模型自选时长、忽略我们传的值。 */
export type Durations = {
  adjustable: boolean;
  values: number[] | null; // 离散可选值(如 [5,10]);null 表示按 min/max 连续
  min: number | null;
  max: number | null;
};

/** 参考图能力。max 含 hero 本身(如 Veo 共 3 张 = hero + 2 参考)。 */
export type ReferenceSupport = { supported: boolean; max: number };

/** 解析后可直接喂给 provider 的图片(按 inputMode 只填其一)。 */
export type ResolvedImage = {
  publicUrl?: string; // public-url 模式
  base64?: string; // base64 / data-uri 模式的原始字节
  dataUri?: string; // data-uri 模式:`data:<mime>;base64,...`
  mimeType?: string;
};

/** onProgress 用 0-1(与 server/src/renderer.ts 的 RenderTask.progress 对齐)。 */
export type ProgressFn = (progress: number) => void | Promise<void>;

/** provider.generateClip 的统一入参。 */
export type ClipInput = {
  image: ResolvedImage;
  prompt: string; // 已编译好的运镜 prompt(BFF 负责合成,server 不再加工)
  referenceImages?: ResolvedImage[];
  outputPath: string; // provider 把成片写到这里(临时路径),service 再落 storage
  aspectRatio?: string; // 默认 '16:9'
  durationSeconds?: number; // 请求时长;provider 内部按能力吸附
  onProgress?: ProgressFn;
};

/** provider.generateClip 的统一出参。 */
export type ClipResult = {
  provider: string;
  providerJobId: string;
  outputPath: string;
  // 仅 mock 填真实值;网络 provider 返回 null → 任务的 durationSeconds 也为 null。
  // ponytail: 尚未对下载成片做 ffprobe 兜底(v2 无该 helper);MODEL_PICKS 类真实时长只能后续补 probe 得到。
  duration: number | null;
};

/** 所有 provider 的最小接口。 */
export interface VideoProvider {
  id: string;
  inputMode: InputMode;
  model?: string;
  generateClip(input: ClipInput): Promise<ClipResult>;
}

/** 依赖注入:测试传 mock fetch / 即时 sleep;生产用全局 fetch / 真 setTimeout。 */
export type FetchLike = typeof fetch;
export type SleepFn = (ms: number) => Promise<void>;
export type ProviderDeps = { fetch: FetchLike; sleep: SleepFn };

/** `/api/clip-providers` 暴露给 BFF 的单个 provider 目录项(实现视角)。 */
export type ProviderOption = {
  id: string;
  label: string;
  inputMode: InputMode;
  model: string;
  durations: Durations;
  referenceImages: ReferenceSupport;
  requiredEnv: string[];
};

export type ProviderOptionWithStatus = ProviderOption & {
  configured: boolean;
  configurationIssue: string | null;
};

/** service 异步任务态(镜像 renderer.ts 的 RenderTask)。 */
export type ClipTask = {
  status: 'queued' | 'generating' | 'done' | 'error';
  progress: number; // 0-1
  url?: string;
  provider?: string;
  providerJobId?: string;
  durationSeconds?: number;
  error?: string;
};
