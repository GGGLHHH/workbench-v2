// bespoke:Google GenAI SDK 的两个 provider。GeminiOmni(interactions 多模态)+ Veo(generateVideos 长轮询)。
// 端口自 xchangeai providers.js:373-507。SDK 动态导入(不拖慢注册表加载),sleep 依赖注入(测试即时)。
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ClipInput, ClipResult, InputMode, ProviderDeps, VideoProvider } from './types';
import { reportProgress } from './http-engine';
import { envInt } from './env';

/* eslint-disable @typescript-eslint/no-explicit-any */
const GEMINI_OMNI_MODEL = 'gemini-omni-flash-preview';

const findInlineVideo = (interaction: any): any => {
  if (interaction.output_video?.data) return interaction.output_video;
  for (const step of interaction.steps || []) {
    for (const content of step.content || []) {
      if (content.type === 'video' && content.data) return content;
    }
  }
  return null;
};

const findUriVideo = (interaction: any): any => {
  if (interaction.output_video?.uri) return interaction.output_video;
  for (const step of interaction.steps || []) {
    for (const content of step.content || []) {
      if (content.type === 'video' && content.uri) return content;
    }
  }
  return null;
};

export class GeminiOmniProvider implements VideoProvider {
  readonly id = 'gemini-omni';
  readonly inputMode: InputMode = 'base64';
  readonly model: string;
  private readonly deps: ProviderDeps;

  constructor(model: string, deps: ProviderDeps) {
    this.model = model;
    this.deps = deps;
  }

  async generateClip(input: ClipInput): Promise<ClipResult> {
    const { image, prompt, outputPath, aspectRatio = '16:9', onProgress } = input;
    await mkdir(path.dirname(outputPath), { recursive: true });
    const { GoogleGenAI } = await import('@google/genai');
    const ai: any = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const base64Image = image.base64;
    await reportProgress(onProgress, 0.38);

    const interaction = await ai.interactions.create({
      model: this.model,
      input: [
        { type: 'image', data: base64Image, mime_type: image.mimeType },
        { type: 'text', text: prompt },
      ],
      response_format: { type: 'video', aspect_ratio: aspectRatio, delivery: 'uri' },
      generationConfig: { videoConfig: { task: 'image_to_video' } },
    });
    await reportProgress(onProgress, 0.55);

    const inlineVideo = findInlineVideo(interaction);
    if (inlineVideo?.data) {
      await reportProgress(onProgress, 0.92);
      await writeFile(outputPath, Buffer.from(inlineVideo.data, 'base64'));
      return { provider: this.id, providerJobId: interaction.id, outputPath, duration: null };
    }

    const outputVideo = interaction.output_video || findUriVideo(interaction);
    if (!outputVideo?.uri) throw new Error('Gemini response did not include a video payload or URI');

    const fileId = outputVideo.uri.match(/files\/([^/:]+)/)?.[1];
    if (fileId) {
      const name = `files/${fileId}`;
      for (let attempt = 0; attempt < 120; attempt += 1) {
        const info = await ai.files.get({ name });
        const state = typeof info.state === 'string' ? info.state : info.state?.name;
        if (state === 'ACTIVE') break;
        if (state === 'FAILED') throw new Error('Gemini video generation failed');
        await reportProgress(onProgress, Math.min(0.88, 0.58 + attempt * 0.01));
        await this.deps.sleep(5000);
      }
    }

    await reportProgress(onProgress, 0.92);
    await ai.files.download({ file: outputVideo, downloadPath: outputPath });
    return { provider: this.id, providerJobId: interaction.id, outputPath, duration: null };
  }
}

export class VeoProvider implements VideoProvider {
  readonly id: string;
  readonly inputMode: InputMode = 'base64';
  readonly model: string;
  private readonly deps: ProviderDeps;

  constructor(meta: { id: string; model: string }, deps: ProviderDeps) {
    this.id = meta.id;
    this.model = meta.model;
    this.deps = deps;
  }

  async generateClip(input: ClipInput): Promise<ClipResult> {
    const { image, prompt, referenceImages = [], outputPath, onProgress } = input;
    await mkdir(path.dirname(outputPath), { recursive: true });
    const { GoogleGenAI } = await import('@google/genai');
    const ai: any = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const imageBytes = image.base64;
    await reportProgress(onProgress, 0.38);

    // Veo:首帧图与参考图互斥。有同房间角度时,把 hero + 参考当参考图("asset"),丢掉顶层首帧。
    const request: any = { model: this.model, prompt };
    if (referenceImages.length) {
      const max = 3; // hero + 2 参考
      const referenceBytes = referenceImages.map((reference) => ({
        imageBytes: reference.base64,
        mimeType: reference.mimeType,
      }));
      request.config = {
        referenceImages: [{ imageBytes, mimeType: image.mimeType }, ...referenceBytes]
          .slice(0, max)
          .map((img) => ({ image: img, referenceType: 'asset' })),
      };
    } else {
      request.image = { imageBytes, mimeType: image.mimeType };
    }

    let operation: any = await ai.models.generateVideos(request);
    await reportProgress(onProgress, 0.45);

    const timeoutMs = envInt('VEO_TIMEOUT_MS', 900000);
    const pollIntervalMs = envInt('VEO_POLL_INTERVAL_MS', 10000);
    const startedAt = Date.now();
    let pollCount = 0;
    while (!operation.done) {
      if (Date.now() - startedAt > timeoutMs) throw new Error(`Timed out waiting for ${this.model} generation`);
      await reportProgress(onProgress, Math.min(0.88, 0.48 + pollCount * 0.04));
      await this.deps.sleep(Math.max(1000, pollIntervalMs));
      operation = await ai.operations.getVideosOperation({ operation });
      pollCount += 1;
    }

    if (operation.error) throw new Error(operation.error.message || `${this.model} generation failed`);
    const video = operation.response?.generatedVideos?.[0]?.video;
    if (!video) throw new Error(`${this.model} response did not include a generated video`);

    await reportProgress(onProgress, 0.92);
    await ai.files.download({ file: video, downloadPath: outputPath });
    return {
      provider: this.id,
      providerJobId: operation.name || operation.id || `${this.id}-job`,
      outputPath,
      duration: null,
    };
  }
}

export const geminiOmniDefaultModel = (): string =>
  process.env.GEMINI_OMNI_MODEL || process.env.GEMINI_MODEL || GEMINI_OMNI_MODEL;
