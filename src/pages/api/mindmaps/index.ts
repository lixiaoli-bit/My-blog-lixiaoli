import type { APIRoute } from "astro";
import { createMindmap, emptyMindmapData, listMindmaps } from "@/lib/mindmaps";
import { canManage } from "@/lib/admin-auth";
import {
  ensureMap,
  mapPayload,
  mapResponse,
  mapFailure,
  validateDocument,
  MapError,
} from "@/lib/mindmap-service";
export const prerender = false;
export const GET: APIRoute = async ({ url, cookies }) => {
  try {
    const maps = await listMindmaps(
      url.searchParams.get("articleId") || undefined,
    );
    const visible = await Promise.all(
      maps.map(async (map) => {
        try {
          await mapPayload(map.id, cookies);
          return { ...map, updatedAt: map.updatedAt.toISOString() };
        } catch {
          return null;
        }
      }),
    );
    return mapResponse({ maps: visible.filter(Boolean) });
  } catch (e) {
    return mapFailure(e);
  }
};
export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const body = await request.json();
    if (body.articleId)
      return mapResponse(
        {
          map: await ensureMap(
            { domain: "article", targetId: body.articleId },
            cookies,
          ),
        },
        201,
      );
    if (!(await canManage(cookies, "articles")))
      throw new MapError("没有导图管理权限", 403);
    const title = String(body.title ?? "")
      .trim()
      .slice(0, 100);
    if (!title) throw new MapError("请填写导图标题");
    const data = validateDocument(
      body.data
        ? typeof body.data === "string"
          ? JSON.parse(body.data)
          : body.data
        : emptyMindmapData(title),
    );
    const created = await createMindmap({
      title,
      articleId: null,
      data: JSON.stringify(data),
    });
    return mapResponse({ map: await mapPayload(created.id, cookies) }, 201);
  } catch (e) {
    return mapFailure(e);
  }
};
