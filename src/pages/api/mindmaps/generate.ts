import type { APIRoute } from "astro";
import {
  ensureMap,
  mapFailure,
  mapResponse,
  reference,
  saveMap,
} from "@/lib/mindmap-service";
import type { MapNode } from "@/lib/mindmap-types";
export const prerender = false;
export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const body = await request.json(),
      map = await ensureMap(
        { domain: "article", targetId: body.articleId },
        cookies,
      );
    const branch: MapNode = {
      data: { text: "文章结构", expand: true },
      children: [],
    };
    const stack = [{ level: 0, node: branch }];
    for (const block of map.source!.blocks.filter(
      (block) => block.kind === "heading",
    )) {
      while (stack.length > 1 && stack.at(-1)!.level >= block.level!)
        stack.pop();
      const node: MapNode = {
        data: {
          text: block.title,
          expand: true,
          sourceRef: reference(map.source!, block.blockId),
        },
        children: [],
      };
      stack.at(-1)!.node.children!.push(node);
      stack.push({ level: block.level!, node });
    }
    (map.data.root.children ??= []).push(branch);
    return mapResponse({
      map: await saveMap(map.id, map.revision, { data: map.data, version: map.version }, cookies),
    });
  } catch (e) {
    return mapFailure(e);
  }
};
