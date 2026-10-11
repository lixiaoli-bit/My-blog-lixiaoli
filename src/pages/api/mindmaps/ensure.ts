import type { APIRoute } from "astro";
import {
  ensureMap,
  mapResponse,
  mapFailure,
  targetFrom,
} from "@/lib/mindmap-service";
export const prerender = false;
export const POST: APIRoute = async ({ cookies, request }) => {
  try {
    const body = await request.json();
    return mapResponse({
      map: await ensureMap(targetFrom(body.source), cookies, body.primaryId),
    });
  } catch (e) {
    return mapFailure(e);
  }
};
