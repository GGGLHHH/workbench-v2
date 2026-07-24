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
  it('单图:generate 与 improve 走不同任务句;improve 内嵌现有正文', () => {
    expect(buildAssistInstruction('generate', undefined, 1, 'batch')).toContain('Write a single');
    const imp = buildAssistInstruction('improve', 'slow pan left', 1, 'batch');
    expect(imp).toContain('Improve this existing');
    expect(imp).toContain('slow pan left');
  });
  it('多图 sequence:提到首帧/末帧与连续运动', () => {
    const seq = buildAssistInstruction('generate', undefined, 3, 'sequence');
    expect(seq).toContain('start frame');
    expect(seq).toContain('end frame');
    expect(seq).toContain('continuous camera motion');
  });
  it('多图 batch:提到协调的一组图', () => {
    const b = buildAssistInstruction('generate', undefined, 3, 'batch');
    expect(b).toContain('coordinated set');
  });
});

describe('mockAssist', () => {
  it('返回确定性建议且标记 mock', () => {
    const g = mockAssist('generate', undefined, 1, 'batch');
    expect(g.mock).toBe(true);
    expect(g.suggestedPrompt.length).toBeGreaterThan(0);
    expect(g.warnings.length).toBeGreaterThan(0);
  });
  it('improve 把现有正文并入建议', () => {
    const r = mockAssist('improve', 'pan right across the kitchen', 1, 'batch');
    expect(r.suggestedPrompt).toContain('pan right across the kitchen');
  });
  it('多图 sequence 用穿越序列的措辞', () => {
    const r = mockAssist('generate', undefined, 3, 'sequence');
    expect(r.suggestedPrompt.toLowerCase()).toContain('first');
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
    const r = await generatePromptAssist({ imageUrls: ['https://example.com/a.jpg'], action: 'generate' });
    expect(r.mock).toBe(true);
  });
  it('多图 sequence + 强制 mock', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.PROMPT_ASSIST_MOCK = '1';
    const r = await generatePromptAssist({
      imageUrls: ['https://example.com/a.jpg', 'https://example.com/b.jpg'],
      action: 'generate',
      mode: 'sequence',
    });
    expect(r.mock).toBe(true);
  });
  it('空 imageUrls 抛错', async () => {
    await expect(generatePromptAssist({ imageUrls: [], action: 'generate' })).rejects.toThrow(/image required/);
  });
});
