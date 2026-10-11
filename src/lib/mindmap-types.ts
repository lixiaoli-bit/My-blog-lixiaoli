export interface SourceTarget {
  domain: "article" | "doc";
  targetId: string;
}
export interface SourceBlock {
  key: string;
  blockId: string;
  kind: string;
  title: string;
  text: string;
  markdown: string;
  fingerprint: string;
  headingPath: string;
  before: string;
  after: string;
  level?: number;
}
export interface SourceIndex {
  contentHash: string;
  blocks: SourceBlock[];
}
export interface SourceRef extends SourceTarget {
  blockId: string;
  fingerprint: string;
  quote: string;
}
export interface MapNode {
  data: {
    text: string;
    uid?: string;
    expand?: boolean;
    sourceRef?: SourceRef;
    anchorId?: string;
    snippet?: string;
    [key: string]: unknown;
  };
  children?: MapNode[];
  [key: string]: unknown;
}
export interface MapDocument {
  root: MapNode;
  layout?: string;
  theme?: { template?: string; config?: Record<string, unknown> };
  view?: {
    transform?: Record<string, number>;
    state?: { scale: number; x: number; y: number; sx: number; sy: number };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}
export interface MapSource extends SourceTarget {
  title: string;
  url: string;
  contentHash: string;
  blocks: SourceBlock[];
}
export interface MapPayload {
  id: string;
  title: string;
  articleId: string | null;
  revision: number;
  version: string;
  data: MapDocument;
  updatedAt: string;
  source: MapSource | null;
  canEdit: boolean;
  canAi: boolean;
}
export const REF_MIME = "application/x-byqx-mindmap-reference";
export function sourceKey(source: SourceTarget): string {
  return `${source.domain}:${source.targetId}`;
}
export function sameSource(a: SourceTarget, b: SourceTarget): boolean {
  return a.domain === b.domain && a.targetId === b.targetId;
}
export function walkMap(root: MapNode, visit: (node: MapNode) => void): void {
  visit(root);
  for (const child of root.children ?? []) walkMap(child, visit);
}
/** Validate imported and persisted trees before handing them to the canvas engine. */
export function validateMapDocument(value: unknown): MapDocument {
  const doc = value as MapDocument;
  if (!doc?.root) throw new Error("导图数据缺少根节点");
  let count = 0;
  const visit = (node: MapNode, depth: number) => {
    if (
      ++count > 3000 ||
      depth > 80 ||
      !node?.data ||
      typeof node.data.text !== "string" ||
      node.data.text.length > 10000 ||
      (node.children !== undefined && !Array.isArray(node.children))
    )
      throw new Error("导图结构或大小不合法");
    const ref = node.data.sourceRef;
    if (
      ref &&
      (!["article", "doc"].includes(ref.domain) ||
        typeof ref.targetId !== "string" ||
        !ref.targetId ||
        typeof ref.blockId !== "string" ||
        !ref.blockId ||
        typeof ref.fingerprint !== "string" ||
        typeof ref.quote !== "string")
    )
      throw new Error("节点的原文引用格式不合法");
    node.children?.forEach((child) => visit(child, depth + 1));
  };
  visit(doc.root, 0);
  if (JSON.stringify(doc).length > 4_000_000)
    throw new Error("导图超过 4MB 限制");
  return doc;
}
