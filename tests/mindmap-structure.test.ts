import { describe, expect, it } from "vitest";
import { buildSourceIndex } from "../src/lib/source-block-index";
import {
  analyseArticleStructure,
  assembleArticleCandidate,
} from "../src/lib/mindmap-structure";
import { reference } from "../src/lib/mindmap-service";
import {
  walkMap,
  type MapNode,
  type MapSource,
} from "../src/lib/mindmap-types";

async function article(markdown: string): Promise<MapSource> {
  return {
    domain: "doc",
    targetId: "structure-test",
    title: "行列式综合笔记",
    url: "/doc/test?article=structure-test",
    ...(await buildSourceIndex(markdown)),
  };
}
const nodes = (root: MapNode) => {
  const result: MapNode[] = [];
  walkMap(root, (node) => result.push(node));
  return result;
};
const item = (
  text: string,
  children: MapNode[] = [],
  source?: MapSource,
  blockId?: string,
): MapNode => ({
  data: {
    text,
    ...(source && blockId ? { sourceRef: reference(source, blockId) } : {}),
  },
  children,
});
const segment = (node: MapNode, ...blockIds: string[]) => ({ node, blockIds });

describe("complete article structure across AI chunks", () => {
  it("preserves mathematically distinct labels while merging identical concepts", async () => {
    const source = await article("# 公式\n\n原文");
    const result = assembleArticleCandidate(source, [
      segment(
        item("本段内容", [
          item("n²"),
          item("n2"),
          item("A"),
          item("a"),
          item("n²"),
        ]),
        source.blocks[0]!.blockId,
      ),
    ]);
    expect(
      result.branch.children![0]!.children!.map((node) => node.data.text),
    ).toEqual(["n²", "n2", "A", "a"]);
  });
  it("creates a single chapter with all original sections despite repeated AI chapter wrappers", async () => {
    const source = await article(
      "# 第1章 行列式\n\n## 1.2 行列式的概念\n\n> 概念重点\n\n## 1.4 行列式的性质\n\n> 性质重点\n\n## 1.6 常见方法\n\n> 方法重点",
    );
    const headings = source.blocks.filter((block) => block.kind === "heading"),
      cards = source.blocks.filter((block) => block.kind === "blockquote");
    const segments = cards.map((card, i) =>
      segment(
        item("第1章 行列式", [
          item("第1章 行列式", [
            item(headings[i + 1]!.title, [
              item(`重点${i}`, [], source, card.blockId),
            ]),
          ]),
        ]),
        card.blockId,
      ),
    );
    const assembled = assembleArticleCandidate(source, segments);
    expect(assembled.branch.children).toHaveLength(1);
    const chapter = assembled.branch.children![0]!;
    expect(chapter.data.text).toBe("第1章 行列式");
    expect(chapter.children!.map((node) => node.data.text)).toEqual(
      headings.slice(1).map((block) => block.title),
    );
    expect(
      nodes(assembled.branch).filter(
        (node) => node.data.text === "第1章 行列式",
      ),
    ).toHaveLength(1);
    expect(assembled.headingCount).toBe(4);
    cards.forEach((card, i) =>
      expect(chapter.children![i]!.children![0]!.data.sourceRef?.blockId).toBe(
        card.blockId,
      ),
    );
  });

  it("merges repeated card references and concepts across chunks within the same section", async () => {
    const source = await article(
      "# 章节\n\n> [!NOTE] 完整卡片\n> 重点\n\n普通内容",
    );
    const card = source.blocks.find((block) => block.kind === "callout")!,
      paragraph = source.blocks.find((block) => block.kind === "paragraph")!;
    const parts = ["第一次名称", "另一个名称"].map((text) =>
      segment(
        item("章节", [
          item("章节", [
            item(text, [], source, card.blockId),
            item("相同知识点", [], source, paragraph.blockId),
            item("共同概念"),
          ]),
        ]),
        card.blockId,
      ),
    );
    const result = assembleArticleCandidate(source, parts);
    const children = result.branch.children![0]!.children!;
    expect(children).toHaveLength(3);
    expect(
      nodes(result.branch).filter(
        (node) => node.data.sourceRef?.blockId === card.blockId,
      ),
    ).toHaveLength(1);
    expect(result.mergedDuplicates).toBeGreaterThan(0);
  });

  it("keeps distinct same-title headings and same-name cards in their original sections", async () => {
    const source = await article(
      "# 第一章\n\n## 小结\n\n> [!NOTE] 重点\n> 第一章重点\n\n# 第二章\n\n## 小结\n\n> [!NOTE] 重点\n> 第二章重点",
    );
    const cards = source.blocks.filter((block) => block.kind === "callout");
    const parts = cards.map((card) =>
      segment(
        item("章节", [item("小结", [item("重点", [], source, card.blockId)])]),
        card.blockId,
      ),
    );
    const result = assembleArticleCandidate(source, parts);
    expect(result.branch.children!.map((node) => node.data.text)).toEqual([
      "第一章",
      "第二章",
    ]);
    result.branch.children!.forEach((chapter, i) => {
      expect(chapter.children![0]!.data.text).toBe("小结");
      expect(chapter.children![0]!.children![0]!.data.sourceRef?.blockId).toBe(
        cards[i]!.blockId,
      );
    });
  });

  it("places omitted cards under their actual sections and removes artificial supplement wrappers", async () => {
    const source = await article(
      "# 章节\n\n## 概念\n\n> [!TIP] 概念卡片\n> 概念\n\n## 方法\n\n> [!NOTE] 方法卡片\n> 方法",
    );
    const card = source.blocks.find((block) => block.kind === "callout")!;
    const wrapper = item("原文引用卡片（补齐）", [
      item("概念卡片", [], source, card.blockId),
    ]);
    wrapper.data.aiSupplement = true;
    const result = assembleArticleCandidate(source, [
      segment(item("AI整理", [wrapper]), card.blockId),
    ]);
    expect(result.supplementedCards).toBe(1);
    expect(
      nodes(result.branch).some((node) => node.data.text === wrapper.data.text),
    ).toBe(false);
    const sections = result.branch.children![0]!.children!;
    expect(sections.map((node) => node.children![0]!.data.text)).toEqual([
      "概念卡片",
      "方法卡片",
    ]);
  });

  it("uses referenced source sections even when a model puts content under the wrong heading", async () => {
    const source = await article(
      "# 章节\n\n## 概念\n\n> 概念重点\n\n## 方法\n\n> 方法重点",
    );
    const cards = source.blocks.filter((block) => block.kind === "blockquote");
    const result = assembleArticleCandidate(source, [
      segment(
        item("章节", [
          item(
            "概念",
            cards.map((card) => item(card.title, [], source, card.blockId)),
          ),
        ]),
        ...cards.map((card) => card.blockId),
      ),
    ]);
    const sections = result.branch.children![0]!.children!;
    expect(sections[0]!.children![0]!.data.sourceRef?.blockId).toBe(
      cards[0]!.blockId,
    );
    expect(sections[1]!.children![0]!.data.sourceRef?.blockId).toBe(
      cards[1]!.blockId,
    );
  });

  it("supports no headings and skipped heading levels without inventing chapter copies", async () => {
    const flat = await article("> 引用内容\n\n正文");
    const flatResult = assembleArticleCandidate(flat, []);
    expect(flatResult.headingCount).toBe(0);
    expect(flatResult.branch.children![0]!.data.sourceRef?.blockId).toBe(
      flat.blocks[0]!.blockId,
    );
    const nested = await article("# 一级\n\n### 三级\n\n## 二级\n\n# 新一级");
    const outline = analyseArticleStructure(nested);
    expect(outline.sections.map((section) => section.parentId)).toEqual([
      "",
      outline.sections[0]!.id,
      outline.sections[0]!.id,
      "",
    ]);
    expect(
      assembleArticleCandidate(nested, []).branch.children![0]!.children!.map(
        (node) => node.data.text,
      ),
    ).toEqual(["三级", "二级"]);
  });
  it("preserves a meaningful leaf reply for a paragraph-only article", async () => {
    const source = await article("正文知识点");
    const result = assembleArticleCandidate(source, [
      segment(item("一个知识点"), source.blocks[0]!.blockId),
    ]);
    expect(result.branch.children![0]!.data.text).toBe("一个知识点");
  });
  it("removes empty cross-section wrappers after routing their content to actual sections", async () => {
    const source = await article(
      "# 章节\n\n## 概念\n\n> 概念重点\n\n## 方法\n\n> 方法重点",
    );
    const cards = source.blocks.filter((block) => block.kind === "blockquote");
    const result = assembleArticleCandidate(source, [
      segment(
        item("本段内容", [
          item(
            "混合章节包装",
            cards.map((card) => item(card.title, [], source, card.blockId)),
          ),
        ]),
        ...cards.map((card) => card.blockId),
      ),
    ]);
    expect(
      nodes(result.branch).some((node) => node.data.text === "混合章节包装"),
    ).toBe(false);
    expect(result.branch.children![0]!.children).toHaveLength(2);
  });
});
