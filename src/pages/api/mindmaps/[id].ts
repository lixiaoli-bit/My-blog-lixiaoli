import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { db } from "../../../../db";
import { mindmaps, mindmapBindings } from "../../../../db/schema.sqlite";
import {
  mapPayload,
  saveMap,
  mapResponse,
  mapFailure,
  MapError,
} from "@/lib/mindmap-service";
export const prerender = false;
export const GET: APIRoute = async ({ params, cookies }) => {
  try {
    return mapResponse({ map: await mapPayload(params.id!, cookies) });
  } catch (e) {
    return mapFailure(e);
  }
};
export const PUT: APIRoute = async ({ params, cookies, request }) => {
  try {
    const body = await request.json();
    if ("articleId" in body)
      throw new MapError(
        "请从文章入口创建或打开唯一关联导图，不能通过旧客户端改绑",
      );
    return mapResponse({
      map: await saveMap(params.id!, body.revision, body, cookies),
    });
  } catch (e) {
    return mapFailure(e);
  }
};
export const DELETE: APIRoute = async ({ params, cookies }) => {
  try {
    await mapPayload(params.id!, cookies, true);
    await db
      .delete(mindmapBindings)
      .where(eq(mindmapBindings.mapId, params.id!));
    await db.delete(mindmaps).where(eq(mindmaps.id, params.id!));
    return mapResponse({ ok: true });
  } catch (e) {
    return mapFailure(e);
  }
};
