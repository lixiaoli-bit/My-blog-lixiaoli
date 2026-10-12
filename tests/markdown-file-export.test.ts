import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
const { safeName, installMarkdownExport } = createRequire(import.meta.url)('../desktop/markdown-export.cjs');
function harness(identity: unknown = { identity: 'top' }) {
  const handles = new Map(), events = new Map();
  const event = { senderFrame: { url: 'http://127.0.0.1:4444/doc/book' }, sender: { id: 1, getURL: () => event.senderFrame.url,
    session: { cookies: { get: async () => [{ name: 'fixture', value: 'test' }] } }, startDrag: vi.fn() } };
  const request = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/me') ? identity : { node: { title: '数学:练习', kind: 'article', bundleId: 'book' } }), { status: 200 }));
  request.mockImplementation(async (url: string) => url.includes('/api/export/') ? new Response('---\ntitle: 数学\n---\n\n$x^2$\n:::collapse\n- 解答\n:::') : new Response(JSON.stringify(url.endsWith('/me') ? identity : { node: { title: '数学:练习', kind: 'article', bundleId: 'book' } })));
  const installed = installMarkdownExport({ app: { on: vi.fn() }, ipcMain: { handle: (name: string, fn: unknown) => handles.set(name, fn), on: (name: string, fn: unknown) => events.set(name, fn) },
    trustedWindow: (candidate: unknown) => candidate === event ? {} : null, baseUrl: () => 'http://127.0.0.1:4444', nativeImage: { createFromPath: () => ({ isEmpty: () => false }) }, fetch: request });
  return { event, request, prepare: (id: unknown) => handles.get('desktop:prepare-markdown-export')(event, id), drag: (token: unknown, sender = event) => events.get('desktop:start-markdown-drag')(sender, token), ...installed };
}
describe('restricted native Markdown export', () => {
  it('cleans Chinese names and Windows device names without exposing paths', () => {
    expect(safeName('../数学:练习?')).toBe('..数学练习.md'); expect(safeName('CON')).toBe('_CON.md'); expect(safeName('...')).toBe('文章.md');
  });
  it('exports complete UTF-8 source; binds opaque token to the originating window and page', async () => {
    const h = harness();
    try {
      const result = await h.prepare('study'); expect(result.ok).toBe(true); expect(result.filename).toBe('数学练习.md'); expect(result.file).toBeUndefined();
      h.drag('unknown'); expect(h.event.sender.startDrag).not.toHaveBeenCalled();
      h.drag(result.token, { ...h.event, sender: { ...h.event.sender, id: 2 } }); expect(h.event.sender.startDrag).not.toHaveBeenCalled();
      h.drag(result.token); const file = h.event.sender.startDrag.mock.calls[0]![0].file;
      expect(readFileSync(file, 'utf8')).toContain('$x^2$\n:::collapse');
      h.event.senderFrame.url = 'http://127.0.0.1:4444/doc/other'; h.event.sender.startDrag.mockClear(); h.drag(result.token); expect(h.event.sender.startDrag).not.toHaveBeenCalled();
      h.cleanup(); expect(existsSync(file)).toBe(false);
    } finally { h.cleanup(); }
  });
  it('rejects visitors, path injection and calls from other pages', async () => {
    const h = harness({ identity: 'anonymous' });
    try {
      expect((await h.prepare('../../secret')).ok).toBe(false); expect(h.request).not.toHaveBeenCalled();
      expect((await h.prepare('study')).ok).toBe(false);
      h.event.senderFrame.url = 'http://127.0.0.1:4444/toolchain'; h.request.mockClear(); expect((await h.prepare('study')).ok).toBe(false); expect(h.request).not.toHaveBeenCalled();
    } finally { h.cleanup(); }
  });
});
