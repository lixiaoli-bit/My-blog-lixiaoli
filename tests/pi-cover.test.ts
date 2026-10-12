import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
const state = vi.hoisted(() => ({
  article: { id: 'cover-article', title: '文章', content: '完整正文', summary: 'PRIVATE_SUMMARY_SENTINEL', cover: null as string | null },
  update: vi.fn(), returning: vi.fn(), config: { enabled: true, baseUrl: 'https://api.example/v1', apiKey: 'saved-api-key', imageModel: 'gpt-image-2', editContextTokens: 131072, imageProvider: 'openai' as 'openai' | 'cloudflare', cloudflareAccountId: 'a'.repeat(32), cloudflareApiToken: 'saved-cloudflare-token', cloudflareImageSteps: 4 },
  text: vi.fn(), storage: vi.fn(), githubUpload: vi.fn(), githubStorage: vi.fn(), bedReady: false, r2: false,
}));
vi.mock('../db', () => ({ db: { update: () => ({ set: state.update }) } }));
vi.mock('../src/lib/articles', () => ({ getArticleById: async () => ({ ...state.article }) }));
vi.mock('../src/lib/ai-config', () => ({ getAiConfig: async () => state.config, isAiReady: () => true, buildChatUrl: (url: string) => `${url.replace(/\/$/, '')}/chat/completions` }));
vi.mock('../src/lib/pi-ai', () => ({ completeSiteText: state.text }));
vi.mock('../src/lib/image-bed', () => ({ getImageBedConfig: async () => ({}), isImageBedReady: () => state.bedReady }));
vi.mock('../src/lib/object-storage', () => ({ r2Enabled: () => state.r2 }));
vi.mock('../src/lib/images', () => ({ storeImage: state.storage, storeImageViaGitHub: state.githubStorage, MAX_IMAGE_BYTES: 5242880 }));
vi.mock('../src/lib/gh-image-bed', () => ({ uploadToGitHub: state.githubUpload }));
vi.mock('../src/lib/image-transform', () => ({ resizeToWebp: async (buffer: Buffer) => ({ buffer }) }));
import { applyArticleCover, coverBaseline, CoverConflict, createArticleCover } from '../src/lib/ai-article-cover';
import { signPayload } from '../src/lib/auth';
import { siteImagesApi, imageApiUrl } from '../src/lib/pi-image-api';
const scenePrompt = 'An original traveler with a linen backpack watches a small train cross a forest valley. Soft morning light illuminates the trees, with a clear foreground silhouette and layered distant hills in muted green and warm cream.';
beforeEach(() => {
  vi.stubEnv('AUTH_SECRET', 'isolated-cover-signature-test-secret');
  state.article = { id: 'cover-article', title: '文章', content: '完整正文', summary: 'PRIVATE_SUMMARY_SENTINEL', cover: null };
  state.bedReady = false; state.r2 = false; state.config.imageProvider = 'openai'; vi.clearAllMocks();
  state.text.mockResolvedValue(scenePrompt); state.storage.mockResolvedValue({ id: 'generated-image' });
  state.update.mockReturnValue({ where: () => ({ returning: state.returning }) }); state.returning.mockResolvedValue([{ id: 'cover-article' }]);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function token(baseline = coverBaseline(state.article), id = state.article.id) { return signPayload({ purpose: 'ai-article-cover', id, url: '/api/images/generated', baseline, exp: Date.now() + 10000 }); }
describe('API cover storage and concurrency', () => {
  it('checks image storage before any paid request', async () => {
    await expect(createArticleCover(state.article.id, AbortSignal.timeout(1000))).rejects.toThrow('先配置');
    expect(state.text).not.toHaveBeenCalled(); expect(state.storage).not.toHaveBeenCalled();
  });
  it('runs the Pi custom image provider with saved credentials and returns a signed candidate without overwriting the article', async () => {
    state.r2 = true;
    state.article.title = 'PRIVATE_TITLE_SENTINEL'; state.article.content = 'PRIVATE_CONTENT_SENTINEL';
    const upstream = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer saved-api-key');
      expect(JSON.parse(String(init?.body))).toMatchObject({ model: 'gpt-image-2', size: '1536x1024', n: 1 });
      expect(JSON.parse(String(init?.body)).prompt).toContain(scenePrompt);
      expect(init?.body).not.toContain(state.article.title); expect(init?.body).not.toContain(state.article.content); expect(init?.body).not.toContain(state.article.summary);
      return Response.json({ data: [{ b64_json: Buffer.from('mock-image-bytes').toString('base64') }] });
    });
    vi.stubGlobal('fetch', upstream);
    const candidate = await createArticleCover(state.article.id, AbortSignal.timeout(1000));
    expect(candidate).toMatchObject({ url: '/api/images/generated-image', baseline: coverBaseline(state.article) });
    expect(candidate.token).toContain('.'); expect(upstream).toHaveBeenCalledOnce();
    expect(state.text).toHaveBeenCalledOnce();
    const textRequest = JSON.stringify(state.text.mock.calls[0]?.[1]);
    expect(textRequest).toMatch(/范围：(动漫|风景|人物|插画)/);
    expect(textRequest).not.toContain(state.article.title); expect(textRequest).not.toContain(state.article.content); expect(textRequest).not.toContain(state.article.summary);
    expect(state.storage).toHaveBeenCalledOnce(); expect(state.update).not.toHaveBeenCalled();
    await applyArticleCover(state.article.id, candidate.token);
    expect(state.update).toHaveBeenCalledWith({ cover: candidate.url, updatedAt: expect.any(Date) });
  });
  it.each([{ label: 'empty', content: '' }, { label: 'long', content: '超长正文'.repeat(500_000) }])('does not need a nonempty or bounded article body: $label', async ({ content }) => {
    state.article.content = content; state.r2 = true;
    const upstream = vi.fn().mockResolvedValue(Response.json({ data: [{ b64_json: Buffer.from('bitmap').toString('base64') }] }));
    vi.stubGlobal('fetch', upstream);
    await expect(createArticleCover(state.article.id, AbortSignal.timeout(1000))).resolves.toMatchObject({ url: '/api/images/generated-image' });
    expect(state.text).toHaveBeenCalledOnce(); expect(upstream).toHaveBeenCalledOnce();
  });
  it('passes the complete prompt to Cloudflare without truncation and keeps the same cover application flow', async () => {
    state.r2 = true; state.config.imageProvider = 'cloudflare'; state.text.mockResolvedValue('A'.repeat(1600));
    const upstream = vi.fn(async (url: unknown, init?: RequestInit) => {
      expect(url).toContain(`/accounts/${state.config.cloudflareAccountId}/ai/run/`);
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer saved-cloudflare-token');
      const request = JSON.parse(String(init?.body));
      expect(request.prompt).toContain('A'.repeat(1600)); expect(request.prompt).toContain('No text, lettering, logos or watermarks.');
      expect(request.prompt.length).toBeLessThanOrEqual(2048); expect(request.steps).toBe(4);
      return Response.json({ result: { image: Buffer.from('cloudflare-bitmap').toString('base64') } });
    });
    vi.stubGlobal('fetch', upstream);
    const candidate = await createArticleCover(state.article.id, AbortSignal.timeout(1000));
    await applyArticleCover(state.article.id, candidate.token);
    expect(state.update).toHaveBeenCalledWith({ cover: candidate.url, updatedAt: expect.any(Date) });
  });
  it('stores a generated candidate through the existing GitHub image bed', async () => {
    state.bedReady = true; state.githubUpload.mockResolvedValue({ ok: true, path: '/img/generated.webp' }); state.githubStorage.mockResolvedValue({ id: 'github-image' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ data: [{ b64_json: Buffer.from('bitmap').toString('base64') }] })));
    const candidate = await createArticleCover(state.article.id, AbortSignal.timeout(1000));
    expect(candidate.url).toBe('/api/images/github-image'); expect(state.githubStorage).toHaveBeenCalledWith('image/webp', expect.any(Buffer), '/img/generated.webp');
    expect(state.storage).not.toHaveBeenCalled();
    await applyArticleCover(state.article.id, candidate.token);
    expect(state.update).toHaveBeenCalledWith({ cover: candidate.url, updatedAt: expect.any(Date) });
  });
  it('does not generate an image or overwrite a cover when prompt generation fails', async () => {
    state.r2 = true; state.text.mockRejectedValueOnce(new Error('文字服务不可用'));
    const upstream = vi.fn(); vi.stubGlobal('fetch', upstream);
    await expect(createArticleCover(state.article.id, AbortSignal.timeout(1000))).rejects.toThrow('文字服务不可用');
    state.text.mockResolvedValueOnce('');
    await expect(createArticleCover(state.article.id, AbortSignal.timeout(1000))).rejects.toThrow('提示词');
    expect(upstream).not.toHaveBeenCalled(); expect(state.storage).not.toHaveBeenCalled(); expect(state.update).not.toHaveBeenCalled();
  });
  it('updates only cover and timestamp; retains candidate when article changes', async () => {
    const original = token(); state.article.content += '并发修改';
    await expect(applyArticleCover(state.article.id, original)).rejects.toBeInstanceOf(CoverConflict);
    expect(state.update).not.toHaveBeenCalled();
    await applyArticleCover(state.article.id, original, coverBaseline(state.article));
    expect(state.update).toHaveBeenCalledWith({ cover: '/api/images/generated', updatedAt: expect.any(Date) });
  });
  it('refuses a signed token for another article and detects a racing SQL write', async () => {
    await expect(applyArticleCover('another-article', token())).rejects.toThrow('无效');
    expect(state.update).not.toHaveBeenCalled(); state.returning.mockResolvedValue([]);
    await expect(applyArticleCover(state.article.id, token())).rejects.toBeInstanceOf(CoverConflict);
  });
  it('uses the saved image URL/key and does not fetch remote URLs returned by a relay', async () => {
    const model = { type: 'image' as const, id: 'gpt-image-2', name: 'image', api: 'site-images', provider: 'site-images', baseUrl: imageApiUrl('https://api.example/v1'), input: ['text' as const], output: ['image' as const], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
    const request = vi.fn().mockResolvedValue(Response.json({ data: [{ b64_json: Buffer.from('fake-bitmap').toString('base64') }] }));
    const result = await siteImagesApi.generateImages(model, { input: [{ type: 'text', text: 'article design' }] }, { apiKey: 'saved-key', fetch: request });
    expect(result.stopReason).toBe('stop'); expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]?.[0]).toBe('https://api.example/v1/images/generations');
    expect(request.mock.calls[0]?.[1].headers.authorization).toBe('Bearer saved-key');
    const remote = vi.fn().mockResolvedValue(Response.json({ data: [{ url: 'http://169.254.169.254/' }] }));
    expect((await siteImagesApi.generateImages(model, { input: [] }, { fetch: remote })).stopReason).toBe('error');
    expect(remote).toHaveBeenCalledOnce();
  });
});
