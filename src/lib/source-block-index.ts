import { randomUUID } from "node:crypto";
import { unified, type PluggableList } from "unified";
import remarkParse from "remark-parse";
import { normalizeSource } from "./mdx";
import { remarkPlugins } from "./mdx-plugins";
import { contentVersion } from "./article-content-version";
import type { SourceBlock, SourceIndex } from "./mindmap-types";

export function reconcileBlocks(
  next: SourceBlock[],
  previous: SourceBlock[],
): SourceBlock[] {
  const used = new Set<string>();
  return next.map((block) => {
    const exact = previous.filter(
      (old) =>
        !used.has(old.blockId) &&
        old.kind === block.kind &&
        old.markdown === block.markdown,
    );
    let matches =
      exact.length === 1 &&
      next.filter(
        (item) => item.markdown === block.markdown && item.kind === block.kind,
      ).length === 1
        ? exact
        : exact.filter(
            (old) =>
              old.headingPath === block.headingPath &&
              old.before === block.before &&
              old.after === block.after,
          );
    if (!matches.length) {
      matches = previous.filter(
        (old) =>
          !used.has(old.blockId) &&
          old.kind === block.kind &&
          old.headingPath === block.headingPath &&
          old.before === block.before &&
          old.after === block.after &&
          (block.before || block.after),
      );
      if (
        next.filter(
          (item) =>
            item.kind === block.kind &&
            item.headingPath === block.headingPath &&
            item.before === block.before &&
            item.after === block.after,
        ).length !== 1
      )
        matches = [];
    }
    const blockId = matches.length === 1 ? matches[0]!.blockId : randomUUID();
    used.add(blockId);
    return { ...block, blockId };
  });
}
export async function buildSourceIndex(
  source: string,
  previous?: SourceIndex,
): Promise<SourceIndex> {
  const processor = unified()
    .use(remarkParse)
    .use(remarkPlugins as PluggableList);
  const value = normalizeSource(source),
    file = { value, data: {} as Record<string, unknown> };
  await processor.run(processor.parse(value), file);
  return {
    contentHash: contentVersion(source),
    blocks: reconcileBlocks(
      file.data.sourceBlocks as SourceBlock[],
      previous?.blocks ?? [],
    ),
  };
}
export function decorateSourceHtml(html: string, index: SourceIndex): string {
  const ids = new Map(index.blocks.map((block) => [block.key, block.blockId]));
  return html.replace(/data-source-key="([^"]+)"/g, (all, key: string) =>
    ids.has(key) ? `${all} data-source-block="${ids.get(key)}"` : all,
  );
}
