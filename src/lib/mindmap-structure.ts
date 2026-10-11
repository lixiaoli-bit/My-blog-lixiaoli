import { randomUUID } from "node:crypto";
import { reference, MapError } from "./mindmap-service";
import {
  validateMapDocument,
  type MapNode,
  type MapSource,
} from "./mindmap-types";

// Preserve mathematical superscripts/subscripts and letter case when deduplicating.
const label = (text: string) => text.normalize("NFC").replace(/\s+/g, "");
export interface ArticleOutline {
  sections: { id: string; parentId: string; title: string; level: number }[];
  owners: Map<string, string>;
}
/** Use the complete authoritative block index, including heading levels and repeated titles. */
export function analyseArticleStructure(source: MapSource): ArticleOutline {
  const sections: ArticleOutline["sections"] = [];
  const owners = new Map<string, string>();
  const stack: { id: string; level: number }[] = [];
  for (const block of source.blocks) {
    if (block.kind === "heading") {
      const level = block.level ?? 1;
      while (stack.length && stack.at(-1)!.level >= level) stack.pop();
      sections.push({
        id: block.blockId,
        parentId: stack.at(-1)?.id || "",
        title: block.title,
        level,
      });
      stack.push({ id: block.blockId, level });
    }
    owners.set(block.blockId, stack.at(-1)?.id || "");
  }
  return { sections, owners };
}

/** Assemble one article tree; chunk roots never become parallel article/chapter copies. */
export function assembleArticleCandidate(
  source: MapSource,
  segments: { node: MapNode; blockIds: string[] }[],
) {
  const outline = analyseArticleStructure(source);
  const branch: MapNode = {
    data: {
      text: "AI 整理",
      uid: randomUUID(),
      expand: true,
      aiStructureVersion: 2,
    },
    children: [],
  };
  const containers = new Map<string, MapNode>([["", branch]]);
  const parents = new Map(
    outline.sections.map((section) => [section.id, section.parentId]),
  );
  const blocks = new Map(source.blocks.map((block) => [block.blockId, block]));
  const positions = new Map(
    source.blocks.map((block, index) => [block.blockId, index]),
  );
  const titles = new Map<string, string[]>();
  for (const section of outline.sections) {
    const node: MapNode = {
      data: {
        text: section.title,
        uid: randomUUID(),
        expand: true,
        aiSection: true,
        sourceRef: reference(source, section.id),
      },
      children: [],
    };
    containers.set(section.id, node);
    containers.get(section.parentId)!.children!.push(node);
    const key = label(section.title);
    titles.set(key, [...(titles.get(key) || []), section.id]);
  }
  const ancestors = (id: string) => {
    const result = [id];
    while (id) {
      id = parents.get(id) || "";
      result.push(id);
    }
    return result;
  };
  const home = (node: MapNode, fallback: string): string => {
    if (node.data.sourceRef)
      return outline.owners.get(node.data.sourceRef.blockId) || "";
    const owners: string[] = [];
    const collect = (n: MapNode) => {
      if (n.data.sourceRef)
        owners.push(outline.owners.get(n.data.sourceRef.blockId) || "");
      n.children?.forEach(collect);
    };
    collect(node);
    return owners.length
      ? ancestors(owners[0]!).find((id) =>
          owners.every((owner) => ancestors(owner).includes(id)),
        ) || ""
      : fallback;
  };
  const linked = new Map<string, MapNode>();
  const local = new WeakMap<MapNode, Map<string, MapNode>>();
  let mergedDuplicates = 0;
  for (const segment of segments) {
    const fallback = outline.owners.get(segment.blockIds[0] || "") || "";
    const segmentSections = new Set(
      segment.blockIds.flatMap((id) => ancestors(outline.owners.get(id) || "")),
    );
    const headingFor = (text: string, hint: string) => {
      const candidates = titles.get(label(text)) || [];
      if (candidates.length === 1) return candidates[0];
      const contextual = ancestors(hint).find((id) => candidates.includes(id));
      if (contextual) return contextual;
      const inSegment = candidates.filter((id) => segmentSections.has(id));
      return inSegment.length === 1 ? inSegment[0] : undefined;
    };
    const consume = (input: MapNode, hint: string, parent?: MapNode): void => {
      const ref = input.data.sourceRef;
      const sourceBlock = ref ? blocks.get(ref.blockId) : undefined;
      const headingId =
        sourceBlock?.kind === "heading"
          ? sourceBlock.blockId
          : !ref
            ? headingFor(input.data.text, hint)
            : undefined;
      if (headingId) {
        mergedDuplicates++;
        input.children?.forEach((child) =>
          consume(child, headingId, containers.get(headingId)),
        );
        return;
      }
      if (
        input.data.aiSupplement ||
        (!ref && label(input.data.text) === label(source.title))
      ) {
        input.children?.forEach((child) => consume(child, hint, parent));
        return;
      }
      const owner = home(input, hint);
      const destination =
        parent && owner === hint ? parent : containers.get(owner)!;
      const isCard =
        sourceBlock && ["callout", "blockquote"].includes(sourceBlock.kind);
      const key = ref
        ? isCard
          ? `card:${ref.blockId}`
          : `${ref.blockId}:${label(input.data.text)}`
        : label(input.data.text);
      const siblings = local.get(destination) || new Map<string, MapNode>();
      local.set(destination, siblings);
      let node = ref ? linked.get(key) : siblings.get(key);
      const created = !node;
      if (node) mergedDuplicates++;
      else {
        node = {
          data: { ...input.data, uid: randomUUID(), expand: true },
          children: [],
        };
        destination.children!.push(node);
        if (ref) linked.set(key, node);
        else siblings.set(key, node);
      }
      input.children?.forEach((child) => consume(child, owner, node));
      // A model wrapper may span sections: its contents belong under the canonical
      // headings. Do not retain an empty wrapper after those contents were moved.
      if (created && !ref && input.children?.length && !node.children?.length) {
        destination.children = destination.children!.filter(
          (child) => child !== node,
        );
        siblings.delete(key);
      }
    };
    const root = segment.node;
    if (root.data.sourceRef) consume(root, fallback);
    else if (root.children?.length)
      root.children.forEach((node) => consume(node, fallback));
    else if (!["AI整理", "本段内容"].includes(label(root.data.text)))
      consume(root, fallback);
  }
  let supplementedCards = 0;
  for (const block of source.blocks) {
    if (
      !["callout", "blockquote"].includes(block.kind) ||
      linked.has(`card:${block.blockId}`)
    )
      continue;
    containers.get(outline.owners.get(block.blockId) || "")!.children!.push({
      data: {
        text: block.title,
        uid: randomUUID(),
        expand: true,
        sourceRef: reference(source, block.blockId),
      },
      children: [],
    });
    supplementedCards++;
  }
  // Keep canonical headings and content in their original document order.
  const position = (node: MapNode): number =>
    node.data.sourceRef
      ? (positions.get(node.data.sourceRef.blockId) ?? Infinity)
      : Math.min(...(node.children || []).map(position), Infinity);
  const sort = (node: MapNode) => {
    node.children?.sort((a, b) => position(a) - position(b));
    node.children?.forEach(sort);
  };
  sort(branch);
  try {
    validateMapDocument({ root: branch });
  } catch {
    throw new MapError("整篇导图超过结构限制，请缩小文章范围");
  }
  return {
    branch,
    mergedDuplicates,
    supplementedCards,
    headingCount: outline.sections.length,
  };
}
