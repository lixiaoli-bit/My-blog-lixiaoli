import type { APIRoute } from 'astro';
import { and, eq, sql } from 'drizzle-orm';
import { dbWrite } from '../../../../../db';
import { articles } from '../../../../../db/schema.sqlite';
import { badJson, badRequest, guardManager, json, readJson } from '@/lib/api';

export const prerender = false;
/** Update only the cover; concurrent body/metadata saves cannot be overwritten. */
export const PUT: APIRoute = async ({ request, cookies, params }) => {
  const denied = await guardManager(cookies);
  if (denied) return denied;
  const body = await readJson<{ url?: unknown; expectedCover?: unknown }>(request);
  if (!body) return badJson();
  if (!params.id || typeof body.url !== 'string' || typeof body.expectedCover !== 'string') return badRequest('缺少封面或原封面信息');
  const url = body.url.trim();
  if (url && !/^\/api\/images\/[a-zA-Z0-9-]+$/.test(url)) return badRequest('请使用本站上传的图片');
  try {
    const rows = await dbWrite(d => d.update(articles).set({ cover: url || null, updatedAt: new Date() })
      .where(and(eq(articles.id, params.id!), sql`coalesce(${articles.cover}, '') = ${body.expectedCover}`))
      .returning({ id: articles.id }));
    if (!rows.length) return json({ error: '封面已在其他窗口变化，请刷新后重试' }, 409);
    return json({ ok: true, url }, { headers: { 'cache-control': 'private, no-store' } });
  } catch (error) {
    console.error('[article-cover]', error);
    return json({ error: '封面保存失败，请重试' }, 500);
  }
};
