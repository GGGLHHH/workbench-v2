// Prompt Assist 归一层:前端 /bff/clip-prompt-assist ↔ server /api/prompt-assist。
// BFF 只解析图片引用(/bff/content/<id> → xchangeai 预签名 URL,server 才能 fetch 到字节),
// action/currentPrompt 原样透传;真正的 Gemini 调用在 server(复用其 @google/genai + GEMINI_API_KEY)。
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { config } from './config';
import { forwardAuth } from './xchange-client';
import { resolveImageUrl } from './clips';

/* eslint-disable @typescript-eslint/no-explicit-any */

type AssistBody = {
  imageUrls: string[];
  action?: 'generate' | 'improve';
  currentPrompt?: string;
  mode?: 'batch' | 'sequence';
};

export const registerClipPromptAssistRoutes = (app: FastifyInstance): void => {
  app.addSchema({
    $id: 'BffPromptAssistRequest',
    type: 'object',
    required: ['imageUrls'],
    properties: {
      imageUrls: { type: 'array', items: { type: 'string' }, maxItems: 8 }, // /bff/content/<id> 或已公网 URL,1 张或一组有序
      action: { type: 'string' }, // generate | improve(缺省 generate)
      currentPrompt: { type: 'string' }, // improve 时的现有正文
      mode: { type: 'string' }, // batch | sequence(仅多图有意义)
    },
  });
  app.addSchema({
    $id: 'BffPromptAssist',
    type: 'object',
    required: ['suggestedPrompt', 'rationale', 'warnings', 'mock'],
    properties: {
      suggestedPrompt: { type: 'string' },
      rationale: { type: 'string' },
      warnings: { type: 'array', items: { type: 'string' } },
      mock: { type: 'boolean' }, // true = 离线 mock(未配 GEMINI_API_KEY)
    },
  });

  app.post<{ Body: AssistBody }>(
    '/bff/clip-prompt-assist',
    {
      schema: {
        operationId: 'assistBffClipPrompt',
        tags: ['bff'],
        body: { $ref: 'BffPromptAssistRequest#' },
        response: { 200: { $ref: 'BffPromptAssist#' } },
      },
    },
    async (req: FastifyRequest<{ Body: AssistBody }>, reply) => {
      const b = req.body;
      const auth = forwardAuth(req);
      const imageUrls = await Promise.all((b.imageUrls ?? []).slice(0, 8).map((u) => resolveImageUrl(u, auth)));
      const res = await fetch(`${config.renderUpstream}/api/prompt-assist`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ imageUrls, action: b.action, currentPrompt: b.currentPrompt, mode: b.mode }),
      });
      if (!res.ok) return reply.code(res.status).send(await res.json().catch(() => ({ error: 'assist failed' })));
      const d = (await res.json()) as {
        suggestedPrompt?: string;
        rationale?: string;
        warnings?: string[];
        mock?: boolean;
      };
      return {
        suggestedPrompt: d.suggestedPrompt ?? '',
        rationale: d.rationale ?? '',
        warnings: d.warnings ?? [],
        mock: !!d.mock,
      };
    },
  );
};
