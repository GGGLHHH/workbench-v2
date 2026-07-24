import { afterEach, describe, expect, it } from 'vitest';
import {
  buildAssistInstruction,
  clampPrompt,
  extractResponseText,
  generatePromptAssist,
  mockAssist,
  parseAssistResponse,
} from './prompt-assist';

afterEach(() => {
  delete process.env.PROMPT_ASSIST_MOCK;
  delete process.env.GEMINI_API_KEY;
});

describe('clampPrompt', () => {
  it('折叠空白并截断到上限', () => {
    expect(clampPrompt('  a\n\n b   c ')).toBe('a b c');
    expect(clampPrompt('x'.repeat(2000)).length).toBe(1000);
  });
});

describe('buildAssistInstruction', () => {
  it('generate 与 improve 走不同任务句;improve 内嵌现有正文', () => {
    expect(buildAssistInstruction('generate')).toContain('Write a real-estate');
    const imp = buildAssistInstruction('improve', 'slow pan left');
    expect(imp).toContain('Improve this existing');
    expect(imp).toContain('slow pan left');
  });
  it('improve 但正文为空 → 退回 generate 语义', () => {
    expect(buildAssistInstruction('improve', '   ')).toContain('Write a real-estate');
  });
});

describe('mockAssist', () => {
  it('返回确定性建议且标记 mock', () => {
    const g = mockAssist('generate');
    expect(g.mock).toBe(true);
    expect(g.suggestedPrompt.length).toBeGreaterThan(0);
    expect(g.warnings.length).toBeGreaterThan(0);
  });
  it('improve 把现有正文并入建议', () => {
    const r = mockAssist('improve', 'pan right across the kitchen');
    expect(r.suggestedPrompt).toContain('pan right across the kitchen');
  });
});

describe('extractResponseText', () => {
  it('兼容 text 字符串 / 函数 / candidates parts', () => {
    expect(extractResponseText({ text: '{"a":1}' })).toBe('{"a":1}');
    expect(extractResponseText({ text: () => 'fn' })).toBe('fn');
    expect(extractResponseText({ candidates: [{ content: { parts: [{ text: 'a' }, { text: 'b' }] } }] })).toBe('ab');
    expect(extractResponseText(null)).toBe('');
  });
});

describe('parseAssistResponse', () => {
  it('解析干净 JSON', () => {
    const r = parseAssistResponse('{"suggestedPrompt":"push in","rationale":"why","warnings":["w"]}');
    expect(r).toEqual({ suggestedPrompt: 'push in', rationale: 'why', warnings: ['w'], mock: false });
  });
  it('剥离 ```json 代码围栏', () => {
    const r = parseAssistResponse('```json\n{"suggestedPrompt":"x"}\n```');
    expect(r.suggestedPrompt).toBe('x');
    expect(r.warnings).toEqual([]);
  });
  it('非 JSON 抛错', () => {
    expect(() => parseAssistResponse('not json')).toThrow(/valid JSON/);
  });
  it('缺 suggestedPrompt 抛错', () => {
    expect(() => parseAssistResponse('{"rationale":"x"}')).toThrow(/suggestedPrompt/);
  });
});

describe('generatePromptAssist mock 路径', () => {
  it('无 GEMINI_API_KEY → 走 mock,不碰 SDK', async () => {
    const r = await generatePromptAssist({ imageUrl: 'https://example.com/a.jpg', action: 'generate' });
    expect(r.mock).toBe(true);
  });
  it('PROMPT_ASSIST_MOCK 强制 mock,即便有 key', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.PROMPT_ASSIST_MOCK = '1';
    const r = await generatePromptAssist({ imageUrl: 'https://example.com/a.jpg', action: 'improve', currentPrompt: 'tilt up' });
    expect(r.mock).toBe(true);
    expect(r.suggestedPrompt).toContain('tilt up');
  });
});
