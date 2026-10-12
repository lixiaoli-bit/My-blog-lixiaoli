import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPendingArticleSaves, pendingArticleField, rememberArticleSave, saveArticleSnapshot } from '../src/lib/pending-article-saves';

beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', { get length() { return data.size; }, key: (index: number) => [...data.keys()][index] ?? null, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) });
});
afterEach(() => vi.unstubAllGlobals());

describe('silent article navigation saves', () => {
  it('shows the HTTP status and server reason while retaining a rejected snapshot', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: '正文过长，未保存' }), { status: 413 })));
    await expect(saveArticleSnapshot('/api/articles/rejected', { content: 'retained' })).rejects.toThrow('HTTP 413');
    expect(pendingArticleField('/api/articles/rejected', 'content')).toBe('retained');
  });
  it('retains a failed save and retries it after navigation', async () => {
    const request = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', request);
    await expect(saveArticleSnapshot('/api/articles/one', { content: 'latest' })).rejects.toThrow('网络连接失败，修改已暂存');
    expect(pendingArticleField('/api/articles/one', 'content')).toBe('latest');
    await flushPendingArticleSaves();
    expect(pendingArticleField('/api/articles/one', 'content')).toBeNull();
  });
  it('sends newer typing after an in-flight save instead of dropping it', async () => {
    let resolveFirst!: (response: Response) => void;
    const request = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { resolveFirst = resolve; })).mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', request);
    const first = saveArticleSnapshot('/api/articles/one', { content: 'old' });
    rememberArticleSave('/api/articles/one', { content: 'new' });
    resolveFirst(new Response('{}'));
    await first;
    expect(JSON.parse(request.mock.calls[1]![1].body)).toEqual({ content: 'new' });
    expect(pendingArticleField('/api/articles/one', 'content')).toBeNull();
  });
  it('preserves independent title and content snapshots for the same document', async () => {
    const request = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', request);
    rememberArticleSave('/api/doc/nodes/one', { title: 'Title' });
    rememberArticleSave('/api/doc/nodes/one', { content: 'Body' });
    await flushPendingArticleSaves(true);
    expect(request).toHaveBeenCalledTimes(2);
    expect(localStorage.length).toBe(0);
  });
  it('continues saving when browser storage is full', async () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    const request = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', request);
    await saveArticleSnapshot('/api/articles/full-storage', { content: 'retained' });
    expect(request).toHaveBeenCalledOnce();
    expect(pendingArticleField('/api/articles/full-storage', 'content')).toBeNull();
  });
});
