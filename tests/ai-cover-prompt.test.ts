import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiConfig } from '../src/lib/ai-config';
const state = vi.hoisted(() => ({ text: vi.fn(), pick: vi.fn((_max: number) => 0) }));
vi.mock('../src/lib/pi-ai', () => ({ completeSiteText: state.text }));
vi.mock('node:crypto', async importOriginal => ({ ...await importOriginal<typeof import('node:crypto')>(), randomInt: state.pick }));
import { chooseCoverDirection, COVER_CATEGORIES, generateRandomCoverPrompt } from '../src/lib/ai-cover-prompt';

const config = {} as AiConfig;
const scene = 'An original illustration of a tiny garden suspended above a quiet ocean, with delicate leaves in the foreground, a winding path leading to a warm glass greenhouse and distant islands fading into a soft blue horizon.';
beforeEach(() => { vi.clearAllMocks(); state.pick.mockImplementation(() => 0); state.text.mockResolvedValue(scene); });
afterEach(() => vi.unstubAllGlobals());

describe('random cover prompts independent of article data', () => {
  it.each(COVER_CATEGORIES)('can choose %s and expand it with the existing text model', async category => {
    state.pick.mockReturnValueOnce(COVER_CATEGORIES.indexOf(category));
    const result = await generateRandomCoverPrompt(config, AbortSignal.timeout(1000));
    expect(result.category).toBe(category); expect(result.prompt).toContain(scene); expect(result.prompt).toContain('3:2');
    expect(state.pick.mock.calls[0]?.[0]).toBe(4);
    const [usedConfig, context, options] = state.text.mock.calls[0]!;
    expect(usedConfig).toBe(config); expect(context.messages).toHaveLength(1);
    expect(context.messages[0].content).toContain(`范围：${category}`);
    expect(context.systemPrompt).toContain('具体主体'); expect(context.systemPrompt).toContain('不要解释');
    expect(options).toMatchObject({ signal: expect.any(AbortSignal), maxTokens: 700 });
  });
  it('varies visual directions within every category, without a numeric prompt suffix', () => {
    for (const categoryIndex of [0, 1, 2, 3]) {
      let seed = 1234;
      const briefs = new Set<string>();
      for (let sample = 0; sample < 200; sample++) {
        let first = true;
        const direction = chooseCoverDirection(max => {
          if (first) { first = false; return categoryIndex; }
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          return Math.floor(seed / 2 ** 32 * max);
        });
        expect(direction.category).toBe(COVER_CATEGORIES[categoryIndex]);
        expect(direction.brief.split('\n')).toHaveLength(7); expect(direction.brief).not.toMatch(/\d/);
        briefs.add(direction.brief);
      }
      expect(briefs.size).toBeGreaterThan(190);
    }
  });
  it('uses fresh model output as the scene rather than a fixed image prompt', async () => {
    const first = await generateRandomCoverPrompt(config, AbortSignal.timeout(1000));
    const nextScene = scene.replace('quiet ocean', 'misty forest').replace('distant islands', 'distant mountains');
    state.text.mockResolvedValueOnce(nextScene);
    const second = await generateRandomCoverPrompt(config, AbortSignal.timeout(1000));
    expect(second.prompt).toContain(nextScene); expect(second.prompt).not.toBe(first.prompt);
  });
  it.each(['', '   ', 'short fragment', 'x'.repeat(1601)])('rejects empty, incomplete or oversized output before image generation', async invalid => {
    state.text.mockResolvedValueOnce(invalid);
    await expect(generateRandomCoverPrompt(config, AbortSignal.timeout(1000))).rejects.toThrow('提示词');
  });
  it('does not call the model when cancelled, and does not use a result returned after cancellation', async () => {
    await expect(generateRandomCoverPrompt(config, AbortSignal.abort())).rejects.toThrow();
    expect(state.text).not.toHaveBeenCalled();
    const controller = new AbortController();
    state.text.mockImplementationOnce(async () => { controller.abort(); return scene; });
    await expect(generateRandomCoverPrompt(config, controller.signal)).rejects.toThrow();
  });
});
