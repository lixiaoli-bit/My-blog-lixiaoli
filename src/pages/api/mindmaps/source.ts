import type { APIRoute } from "astro";
import {
  getBinding,
  mapPayload,
  mapResponse,
  mapFailure,
  targetFrom,
  resolveSource,
} from "@/lib/mindmap-service";
import { listMindmaps } from "@/lib/mindmaps";
export const prerender = false;
export const GET: APIRoute = async ({ cookies, url }) => {
  try {
    const target = targetFrom(Object.fromEntries(url.searchParams));
    const source = await resolveSource(target, cookies),
      binding = await getBinding(target);
    const legacy =
      !binding && target.domain === "article"
        ? await listMindmaps(target.targetId)
        : [];
    const id = binding?.mapId ?? (legacy.length === 1 ? legacy[0]!.id : null);
    return mapResponse({
      source,
      map: id ? await mapPayload(id, cookies) : null,
      choosePrimary:
        legacy.length > 1 ? legacy.map(({ id, title }) => ({ id, title })) : [],
    });
  } catch (e) {
    return mapFailure(e);
  }
};
