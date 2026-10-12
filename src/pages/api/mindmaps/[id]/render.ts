import type { APIRoute } from "astro";
import { renderMdx } from "@/lib/mdx";
import {
  MapError,
  mapPayload,
  mapResponse,
  mapFailure,
} from "@/lib/mindmap-service";
import { walkMap } from "@/lib/mindmap-types";

export const prerender = false;
/** Read-only rendering. Visitors may only request persisted node names. */
export const POST: APIRoute = async ({ params, cookies, request }) => {
  try {
    const map = await mapPayload(params.id!, cookies);
    if (Number(request.headers.get("content-length")) > 120000)
      throw new MapError("节点名称渲染请求过大", 413);
    const raw = await request.text();
    if (raw.length > 120000) throw new MapError("节点名称渲染请求过大", 413);
    const body = JSON.parse(raw);
    if (
      !Array.isArray(body.nodes) ||
      !body.nodes.length ||
      body.nodes.length > 32
    )
      throw new MapError("每次最多渲染 32 个节点");
    const names = new Map<string, string>();
    const legacyNames = new Set<string>();
    walkMap(map.data.root, (node) => {
      if (node.data.uid) names.set(node.data.uid, node.data.text);
      else legacyNames.add(node.data.text);
    });
    const nodes: { uid: string; text: string }[] = body.nodes.map(
      (node: { uid?: unknown; text?: unknown }) => {
        if (
          typeof node?.uid !== "string" ||
          !node.uid ||
          node.uid.length > 200 ||
          typeof node.text !== "string" ||
          node.text.length > 10000
        )
          throw new MapError("节点名称或标识不合法");
        if (
          !map.canEdit &&
          names.get(node.uid) !== node.text &&
          !legacyNames.has(node.text)
        )
          throw new MapError("只能渲染当前导图已保存的节点名称", 403);
        return { uid: node.uid, text: node.text };
      },
    );
    // Sequential compilation bounds memory use for formula-heavy batches.
    const results = [];
    for (const node of nodes) {
      try {
        const { html, interactiveBlocks } = await renderMdx(node.text);
        if (html.length > 1000000) throw new Error("render too large");
        results.push({ ...node, html, interactiveBlocks });
      } catch {
        results.push({
          ...node,
          error: "名称中的 Markdown 无法渲染，请检查语法；源码已保留",
        });
      }
    }
    return mapResponse({ nodes: results });
  } catch (error) {
    return mapFailure(error);
  }
};
