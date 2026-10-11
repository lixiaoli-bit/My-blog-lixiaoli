import type { APIRoute } from "astro";
import { randomUUID } from "node:crypto";
import {
  mapPayload,
  saveMap,
  mapResponse,
  mapFailure,
  reference,
  MapError,
  targetFrom,
} from "@/lib/mindmap-service";
import { sameSource, walkMap, type MapNode } from "@/lib/mindmap-types";
export const prerender = false;
export const POST: APIRoute = async ({ params, cookies, request }) => {
  try {
    const body = await request.json(),
      map = await mapPayload(params.id!, cookies, true);
    if (!map.source || !sameSource(targetFrom(body.source), map.source))
      throw new MapError("仅可添加当前关联文章的引用");
    const ref = reference(
      map.source,
      String(body.blockId ?? ""),
      typeof body.quote === "string" ? body.quote : "",
    );
    let parent: MapNode | undefined = body.parentId ? undefined : map.data.root;
    walkMap(map.data.root, (node) => {
      if (body.parentId && node.data.uid === body.parentId) parent = node;
    });
    if (!parent) throw new MapError("目标父节点已不存在，请重新选择", 409);
    (parent.children ??= []).push({
      data: {
        uid: randomUUID(),
        text: String(
          body.text ||
            map.source.blocks.find((b) => b.blockId === ref.blockId)!.title,
        ).slice(0, 80),
        sourceRef: ref,
        expand: true,
      },
      children: [],
    });
    return mapResponse({
      map: await saveMap(map.id, body.revision, { data: map.data, version: body.version }, cookies),
    });
  } catch (e) {
    return mapFailure(e);
  }
};
