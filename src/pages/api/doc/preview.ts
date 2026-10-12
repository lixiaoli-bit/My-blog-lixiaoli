/**
 * POST /api/doc/preview —— Markdown/MDX → HTML 预览（登录）
 *
 * body: { source }
 * 返回 { html, toc }，供编辑器弹窗"预览"使用。
 */
import type { APIRoute } from 'astro';
import { badJson, badRequest, json, readJson } from '@/lib/api';
import { renderMdx } from '@/lib/mdx';

export const prerender = false;

const MAX_SOURCE = 200_000;

export const POST: APIRoute = async ({ request }) => {
  const body = await readJson<{ source?: unknown }>(request);
  if (!body) return badJson();
  const source = typeof body.source === 'string' ? body.source : '';
  if (source.length > MAX_SOURCE) return json({ error: '内容过长，未截断源码，请缩短后重试' }, 413);
  if (!source) return badRequest('内容为空');
  try {
    const { html, toc, interactiveBlocks } = await renderMdx(source);
    return json({ html, toc, interactiveBlocks });
  } catch (err) {
    console.error('[api/doc/preview]', err);
    return json({ error: '渲染失败，请检查语法' }, 422);
  }
};
