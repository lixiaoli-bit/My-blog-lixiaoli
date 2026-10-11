import { afterEach, describe, expect, it, vi } from 'vitest';
import { invalidatePrefetchedDocNode, prefetchDocNode, takePrefetchedDocNode } from '../src/lib/doc-viewport';

afterEach(() => vi.unstubAllGlobals());
const reply = (content: string) => ({ ok: true, json: async () => ({ node: { content } }) }) as Response;
const settle = async () => { await new Promise(resolve => setTimeout(resolve, 0)); };

describe('文档正文预取失效', () => {
  it('保存后不会重开缓存里的旧正文', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply('旧正文')));
    prefetchDocNode('saved-doc'); await settle();
    invalidatePrefetchedDocNode('saved-doc');
    expect(takePrefetchedDocNode('saved-doc')).toBeUndefined();
  });

  it('旧请求迟到不会覆盖保存后开始的新预取', async () => {
    let oldReply!: (response: Response) => void;
    const fetch = vi.fn().mockImplementationOnce(() => new Promise(resolve => { oldReply = resolve; })).mockResolvedValue(reply('新正文'));
    vi.stubGlobal('fetch', fetch);
    prefetchDocNode('late-doc');
    invalidatePrefetchedDocNode('late-doc');
    prefetchDocNode('late-doc'); await settle();
    oldReply(reply('旧正文')); await settle();
    expect(takePrefetchedDocNode('late-doc')).toBe('新正文');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('取用仍只消费一次，正常预取继续去重', async () => {
    const fetch = vi.fn().mockResolvedValue(reply('正文'));
    vi.stubGlobal('fetch', fetch);
    prefetchDocNode('once-doc'); prefetchDocNode('once-doc'); await settle();
    expect(takePrefetchedDocNode('once-doc')).toBe('正文');
    expect(takePrefetchedDocNode('once-doc')).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
