import { describe, expect, it } from 'vitest';
import { DEFAULT_SHOT_DIRECTION, PROPERTY_FIDELITY_GUARDRAIL, compileClipPrompt } from './clip-prompt';

describe('compileClipPrompt', () => {
  it('always leads with the property-fidelity guardrail', () => {
    const out = compileClipPrompt({ promptBody: 'A kitchen.' });
    expect(out.startsWith(PROPERTY_FIDELITY_GUARDRAIL)).toBe(true);
    expect(out.endsWith('A kitchen.')).toBe(true);
  });

  it('falls back to the default shot direction when body is empty', () => {
    expect(compileClipPrompt({}).endsWith(DEFAULT_SHOT_DIRECTION)).toBe(true);
  });

  it('injects a camera-move instruction when no focus subject', () => {
    const out = compileClipPrompt({ cameraMove: 'slowPushIn', promptBody: 'body' });
    expect(out).toContain('Camera path: use a slow, steady push toward the primary visible subject.');
  });

  it('focus subject overrides the standalone camera-move instruction (mutually exclusive)', () => {
    const out = compileClipPrompt({ focusSubject: 'the fireplace', cameraMove: 'slowPushIn' });
    expect(out).toContain('Visual center: the fireplace.');
    expect(out).toContain('Move the camera slowly toward it.');
    expect(out).not.toContain('Camera path:');
  });

  it('adds a light-transition exception + instruction', () => {
    const out = compileClipPrompt({ lightTransition: 'dayToNight' });
    expect(out).toContain('Exception for this shot');
    expect(out).toContain('from bright daytime to night');
  });

  it('ignores unknown camera-move / light-transition values', () => {
    const out = compileClipPrompt({ cameraMove: 'auto', lightTransition: 'none', promptBody: 'x' });
    expect(out).toBe(`${PROPERTY_FIDELITY_GUARDRAIL}\n\nx`);
  });
});
