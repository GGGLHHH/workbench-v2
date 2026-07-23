// provider 注册表:目录 + 别名 + 时长/参考图能力 + 配置校验 + 工厂。端口自 xchangeai providers.js 的
// 语义,但把 13 个 class 收敛成「元数据 + build 工厂」的声明式表。默认 provider = ltx-2-3-fast。
import type { Durations, ProviderDeps, ProviderOption, ProviderOptionWithStatus, ReferenceSupport, VideoProvider } from './types';
import { snapDuration, MAX_CLIP_DURATION_SECONDS, MIN_CLIP_DURATION_SECONDS } from './constants';
import { envInt } from './env';
import { HttpVideoProvider } from './http-provider';
import {
  falKlingDescriptor,
  lumaDescriptor,
  minimaxDescriptor,
  runwayDescriptor,
  seedanceDescriptor,
} from './descriptors';
import { GeminiOmniProvider, VeoProvider, geminiOmniDefaultModel } from './gemini';
import { MockVideoProvider } from './mock';
import { ltxDescriptor } from './descriptors';

/* eslint-disable @typescript-eslint/no-explicit-any */

// —— 时长预设 ——
const MODEL_PICKS: Durations = { adjustable: false, values: null, min: null, max: null };
const ANY_DURATION: Durations = { adjustable: true, values: null, min: MIN_CLIP_DURATION_SECONDS, max: MAX_CLIP_DURATION_SECONDS };
const FIVE_OR_TEN: Durations = { adjustable: true, values: [5, 10], min: 5, max: 10 };
// LTX 2.3:1080p 且 ≤25fps 时 6..20 偶数;更高帧率/分辨率只 6/8/10。
const ltxDurations = (): Durations => {
  const fps = envInt('LTX_FPS', 24);
  const height = Number.parseInt(String(process.env.LTX_RESOLUTION || '1920x1080').split('x')[1] || '1080', 10);
  const extended = fps <= 25 && height <= 1080;
  const values = extended ? [6, 8, 10, 12, 14, 16, 18, 20] : [6, 8, 10];
  return { adjustable: true, values, min: values[0], max: values[values.length - 1] };
};

// —— 参考图能力(max 含 hero)——
const NO_REFERENCE: ReferenceSupport = { supported: false, max: 0 };
const REF_3: ReferenceSupport = { supported: true, max: 3 };

// —— 默认 model(env 覆盖)——
const MODELS = {
  VEO: 'veo-3.1-generate-preview',
  VEO_FAST: 'veo-3.1-fast-generate-preview',
  VEO_LITE: 'veo-3.1-lite-generate-preview',
  RUNWAY_GEN4_TURBO: 'gen4_turbo',
  RUNWAY_GEN45: 'gen4.5',
  FAL_KLING: 'fal-ai/kling-video/v2.1/standard/image-to-video',
  LUMA_RAY_2: 'ray-2',
  LUMA_RAY_2_FLASH: 'ray-flash-2',
  MINIMAX: 'video-01',
  LTX: 'ltx-2-3-fast',
} as const;

export const DEFAULT_CLIP_PROVIDER = 'ltx-2-3-fast';

type ProviderDefinition = {
  id: string;
  label: string;
  inputMode: ProviderOption['inputMode'];
  model: () => string;
  durations: () => Durations;
  requiredEnv: string[];
  referenceImages: ReferenceSupport;
  build: (deps: ProviderDeps) => VideoProvider;
};

const http =
  (descriptor: ReturnType<typeof seedanceDescriptor>, model: () => string, durations: () => Durations) =>
  (deps: ProviderDeps): VideoProvider =>
    new HttpVideoProvider(descriptor, { model: model(), durations: durations() }, deps);

const PROVIDER_DEFINITIONS: ProviderDefinition[] = [
  {
    id: 'mock',
    label: 'Mock local',
    inputMode: 'base64',
    model: () => 'ffmpeg-zoompan',
    durations: () => ANY_DURATION,
    requiredEnv: [],
    referenceImages: NO_REFERENCE,
    build: (deps) => new MockVideoProvider(deps),
  },
  {
    id: 'gemini-omni',
    label: 'Gemini Omni Flash',
    inputMode: 'base64',
    model: geminiOmniDefaultModel,
    durations: () => MODEL_PICKS,
    requiredEnv: ['GEMINI_API_KEY'],
    referenceImages: NO_REFERENCE,
    build: (deps) => new GeminiOmniProvider(geminiOmniDefaultModel(), deps),
  },
  {
    id: 'veo-3.1',
    label: 'Veo 3.1',
    inputMode: 'base64',
    model: () => process.env.VEO_MODEL || MODELS.VEO,
    durations: () => MODEL_PICKS,
    requiredEnv: ['GEMINI_API_KEY'],
    referenceImages: REF_3,
    build: (deps) => new VeoProvider({ id: 'veo-3.1', model: process.env.VEO_MODEL || MODELS.VEO }, deps),
  },
  {
    id: 'veo-3.1-fast',
    label: 'Veo 3.1 Fast',
    inputMode: 'base64',
    model: () => process.env.VEO_FAST_MODEL || MODELS.VEO_FAST,
    durations: () => MODEL_PICKS,
    requiredEnv: ['GEMINI_API_KEY'],
    referenceImages: REF_3,
    build: (deps) => new VeoProvider({ id: 'veo-3.1-fast', model: process.env.VEO_FAST_MODEL || MODELS.VEO_FAST }, deps),
  },
  {
    id: 'veo-3.1-lite',
    label: 'Veo 3.1 Lite',
    inputMode: 'base64',
    model: () => process.env.VEO_LITE_MODEL || MODELS.VEO_LITE,
    durations: () => MODEL_PICKS,
    requiredEnv: ['GEMINI_API_KEY'],
    referenceImages: REF_3,
    build: (deps) => new VeoProvider({ id: 'veo-3.1-lite', model: process.env.VEO_LITE_MODEL || MODELS.VEO_LITE }, deps),
  },
  {
    id: 'seedance',
    label: 'Seedance 2.0',
    inputMode: 'public-url',
    model: () => process.env.SEEDANCE_MODEL || 'seedance-2-0',
    durations: () => ANY_DURATION,
    requiredEnv: ['SEEDANCE_API_KEY'],
    referenceImages: REF_3,
    build: http(seedanceDescriptor('seedance'), () => process.env.SEEDANCE_MODEL || 'seedance-2-0', () => ANY_DURATION),
  },
  {
    id: 'runway-gen4-turbo',
    label: 'Runway Gen-4 Turbo',
    inputMode: 'public-url',
    model: () => process.env.RUNWAY_GEN4_TURBO_MODEL || MODELS.RUNWAY_GEN4_TURBO,
    durations: () => FIVE_OR_TEN,
    requiredEnv: ['RUNWAY_API_KEY'],
    referenceImages: NO_REFERENCE,
    build: http(runwayDescriptor('runway-gen4-turbo'), () => process.env.RUNWAY_GEN4_TURBO_MODEL || MODELS.RUNWAY_GEN4_TURBO, () => FIVE_OR_TEN),
  },
  {
    id: 'runway-gen4.5',
    label: 'Runway Gen-4.5',
    inputMode: 'public-url',
    model: () => process.env.RUNWAY_GEN45_MODEL || MODELS.RUNWAY_GEN45,
    durations: () => FIVE_OR_TEN,
    requiredEnv: ['RUNWAY_API_KEY'],
    referenceImages: NO_REFERENCE,
    build: http(runwayDescriptor('runway-gen4.5'), () => process.env.RUNWAY_GEN45_MODEL || MODELS.RUNWAY_GEN45, () => FIVE_OR_TEN),
  },
  {
    id: 'fal-kling-2.1-standard',
    label: 'fal Kling 2.1 Standard',
    inputMode: 'data-uri',
    model: () => process.env.FAL_KLING_MODEL || MODELS.FAL_KLING,
    durations: () => FIVE_OR_TEN,
    requiredEnv: ['FAL_KEY'],
    referenceImages: NO_REFERENCE,
    build: http(falKlingDescriptor('fal-kling-2.1-standard'), () => process.env.FAL_KLING_MODEL || MODELS.FAL_KLING, () => FIVE_OR_TEN),
  },
  {
    id: 'luma-ray-2',
    label: 'Luma Ray 2',
    inputMode: 'public-url',
    model: () => process.env.LUMA_RAY_2_MODEL || MODELS.LUMA_RAY_2,
    durations: () => MODEL_PICKS,
    requiredEnv: ['LUMA_API_KEY'],
    referenceImages: NO_REFERENCE,
    build: http(lumaDescriptor('luma-ray-2'), () => process.env.LUMA_RAY_2_MODEL || MODELS.LUMA_RAY_2, () => MODEL_PICKS),
  },
  {
    id: 'luma-ray-2-flash',
    label: 'Luma Ray 2 Flash',
    inputMode: 'public-url',
    model: () => process.env.LUMA_RAY_2_FLASH_MODEL || MODELS.LUMA_RAY_2_FLASH,
    durations: () => MODEL_PICKS,
    requiredEnv: ['LUMA_API_KEY'],
    referenceImages: NO_REFERENCE,
    build: http(lumaDescriptor('luma-ray-2-flash'), () => process.env.LUMA_RAY_2_FLASH_MODEL || MODELS.LUMA_RAY_2_FLASH, () => MODEL_PICKS),
  },
  {
    id: 'minimax-i2v-direct',
    label: 'MiniMax/Hailuo Direct',
    inputMode: 'public-url',
    model: () => process.env.MINIMAX_MODEL || MODELS.MINIMAX,
    durations: () => MODEL_PICKS,
    requiredEnv: ['MINIMAX_API_KEY'],
    referenceImages: NO_REFERENCE,
    build: http(minimaxDescriptor('minimax-i2v-direct'), () => process.env.MINIMAX_MODEL || MODELS.MINIMAX, () => MODEL_PICKS),
  },
  {
    id: 'ltx-2-3-fast',
    label: 'LTX 2.3 Fast',
    inputMode: 'public-url',
    model: () => process.env.LTX_MODEL || MODELS.LTX,
    durations: ltxDurations,
    requiredEnv: ['LTX_API_KEY'],
    referenceImages: NO_REFERENCE,
    build: http(ltxDescriptor('ltx-2-3-fast'), () => process.env.LTX_MODEL || MODELS.LTX, ltxDurations),
  },
];

const BY_ID = new Map(PROVIDER_DEFINITIONS.map((d) => [d.id, d]));

// UI / env 用的各种别名 → 规范 id。
const ALIASES = new Map<string, string>([
  ['mock', 'mock'],
  ['gemini', 'gemini-omni'], ['gemini-omni', 'gemini-omni'], ['omni', 'gemini-omni'],
  ['veo', 'veo-3.1'], ['veo-3.1', 'veo-3.1'], ['veo31', 'veo-3.1'],
  ['veo-fast', 'veo-3.1-fast'], ['veo-3.1-fast', 'veo-3.1-fast'], ['veo31-fast', 'veo-3.1-fast'], ['veo-3.1-fast-generate-preview', 'veo-3.1-fast'],
  ['veo-lite', 'veo-3.1-lite'], ['veo-3.1-lite', 'veo-3.1-lite'], ['veo31-lite', 'veo-3.1-lite'], ['veo-3.1-lite-generate-preview', 'veo-3.1-lite'],
  ['seedance', 'seedance'], ['seedance-2.0', 'seedance'], ['seedance2', 'seedance'],
  ['runway', 'runway-gen4-turbo'], ['runway-gen4', 'runway-gen4-turbo'], ['runway-gen4-turbo', 'runway-gen4-turbo'], ['gen4_turbo', 'runway-gen4-turbo'],
  ['runway-gen4.5', 'runway-gen4.5'], ['runway-gen45', 'runway-gen4.5'], ['gen4.5', 'runway-gen4.5'],
  ['fal-kling', 'fal-kling-2.1-standard'], ['kling', 'fal-kling-2.1-standard'], ['kling-2.1', 'fal-kling-2.1-standard'], ['fal-kling-2.1-standard', 'fal-kling-2.1-standard'],
  ['luma', 'luma-ray-2'], ['luma-ray-2', 'luma-ray-2'], ['ray-2', 'luma-ray-2'],
  ['luma-ray-2-flash', 'luma-ray-2-flash'], ['ray-2-flash', 'luma-ray-2-flash'], ['ray-flash-2', 'luma-ray-2-flash'],
  ['minimax', 'minimax-i2v-direct'], ['hailuo', 'minimax-i2v-direct'], ['minimax-i2v', 'minimax-i2v-direct'], ['minimax-i2v-direct', 'minimax-i2v-direct'],
  ['ltx', 'ltx-2-3-fast'], ['ltx-fast', 'ltx-2-3-fast'], ['ltx2-fast', 'ltx-2-3-fast'], ['ltx2 fast', 'ltx-2-3-fast'], ['ltx-2-fast', 'ltx-2-3-fast'], ['ltx-2-3-fast', 'ltx-2-3-fast'], ['ltx-2.3-fast', 'ltx-2-3-fast'],
]);

export const normalizeProviderName = (name: unknown): string | null =>
  ALIASES.get(String(name || '').trim().toLowerCase()) || null;

export const getProviderName = (): string => normalizeProviderName(process.env.VIDEO_PROVIDER) || DEFAULT_CLIP_PROVIDER;

const getDefinition = (name: string): ProviderDefinition | null => BY_ID.get(normalizeProviderName(name) || name) || null;

export const getProviderConfigurationIssue = (name: string): string | null => {
  const def = getDefinition(name);
  if (!def) return 'unsupported provider';
  const missing = def.requiredEnv.find((key) => !process.env[key]);
  return missing ? `needs ${missing}` : null;
};

export const isProviderConfigured = (name: string): boolean => !getProviderConfigurationIssue(name);

export const getProviderDurations = (name: string): Durations => getDefinition(name)?.durations() ?? MODEL_PICKS;

export const getProviderReferenceSupport = (name: string): ReferenceSupport =>
  getDefinition(name)?.referenceImages ?? NO_REFERENCE;

export const snapProviderDuration = (name: string, seconds: unknown): number =>
  snapDuration(getProviderDurations(name), seconds);

const publicOption = (def: ProviderDefinition): ProviderOption => ({
  id: def.id,
  label: def.label,
  inputMode: def.inputMode,
  model: def.model(),
  durations: def.durations(),
  referenceImages: def.referenceImages,
  requiredEnv: def.requiredEnv,
});

export const getProviderOptions = (): ProviderOptionWithStatus[] =>
  PROVIDER_DEFINITIONS.map((def) => ({
    ...publicOption(def),
    configured: isProviderConfigured(def.id),
    configurationIssue: getProviderConfigurationIssue(def.id),
  }));

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const defaultDeps = (): ProviderDeps => ({ fetch: (...a: Parameters<typeof fetch>) => globalThis.fetch(...a), sleep: realSleep });

export const createProvider = (name: string = getProviderName(), deps: ProviderDeps = defaultDeps()): VideoProvider => {
  const def = getDefinition(name) || getDefinition(getProviderName());
  if (!def) throw new Error(`unsupported provider: ${name}`);
  const issue = getProviderConfigurationIssue(def.id);
  if (issue) throw new Error(`${def.label} is not configured: ${issue}`);
  return def.build(deps);
};

const parseProviderError = (error: unknown): any => {
  if (!error) return null;
  if (typeof error === 'object' && (error as any).error) return error;
  const message = typeof error === 'string' ? error : (error as any).message;
  if (!message || typeof message !== 'string') return null;
  try {
    return JSON.parse(message);
  } catch {
    return null;
  }
};

export const formatProviderError = (error: unknown, name: string): string => {
  const parsed = parseProviderError(error);
  const code = parsed?.code || parsed?.error?.code;
  const status = parsed?.status || parsed?.error?.status;
  const message = parsed?.message || parsed?.error?.message || (error as any)?.message || String(error);
  const def = getDefinition(name);
  if (code === 429 || status === 'RESOURCE_EXHAUSTED' || /quota|rate limit|resource_exhausted/i.test(message)) {
    return [
      `${def?.label || 'Provider'} quota/rate limit hit.`,
      'Your credit balance can still be available; providers also apply per-project, per-model, and spend-window limits.',
      'Wait a few minutes or choose a less restricted model.',
    ].join(' ');
  }
  return message;
};
