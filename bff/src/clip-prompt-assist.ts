// Prompt Assist 归一层:前端 /bff/clip-prompt-assist ↔ server /api/prompt-assist。
// BFF 只解析图片引用(/bff/content/<id> → xchangeai 预签名 URL,server 才能 fetch 到字节),
// action/currentPrompt 原样透传;真正的 Gemini 调用在 server(复用其 @google/genai + GEMINI_API_KEY)。
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { config } from './config';
import { forwardAuth } from './xchange-client';
import { resolveImageUrl } from './clips';

/* eslint-disable @typescript-eslint/no-explicit-any */

type AssistBody = {
  imageUrl: string;
  action?: 'generate' | 'improve';
  currentPrompt?: string;
};

export const registerClipPromptAssistRoutes = (app: FastifyInstance): void => {
  app.addSchema({
    $id: 'BffPromptAssistRequest',
    type: 'object',
    required: ['imageUrl'],
    properties: {
      imageUrl: { type: 'string' }, // /bff/content/<id> 或已公网的 URL
      action: { type: 'string' }, // generate | improve(缺省 generate)
      currentPrompt: { type: 'string' }, // improve 时的现有正文
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
      const imageUrl = await resolveImageUrl(b.imageUrl, auth);
      const res = await fetch(`${config.renderUpstream}/api/prompt-assist`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ imageUrl, action: b.action, currentPrompt: b.currentPrompt }),
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
