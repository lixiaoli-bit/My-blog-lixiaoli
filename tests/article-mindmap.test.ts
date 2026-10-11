import { describe, expect, it, vi } from "vitest";
import { buildSourceIndex } from "../src/lib/source-block-index";
import { renderMdx } from "../src/lib/mdx";
import { MindmapSaveQueue } from "../src/lib/mindmap-save-queue";
import { guardAssociativeLine } from "../src/lib/mindmap-engine-compat";
import { AiNodeFormatError, parseCandidate, parseCompleteCandidate, sourceChunks } from "../src/lib/mindmap-ai";
import { readMapDrag, writeMapDrag } from "../src/lib/mindmap-drag";
import type { MapDocument, MapSource } from "../src/lib/mindmap-types";
const markdown =
  "# 章节\n\n正文内容。\n\n> [!NOTE]+ 重点卡片\n> 卡片内容第一行\n>\n> 卡片内容第二行\n\n```md\n# 代码内伪标题\n```\n\n## 子章节\n\n> 普通引用内容\n";
it("ignores a delayed relationship overlap check after cancellation while retaining active checks", async () => {
  class Line {
    isCreatingLine = true;
    creatingStartNode: { uid: string } | null = { uid: "source" };
    checkOverlapNode() {
      return this.creatingStartNode!.uid;
    }
  }
  guardAssociativeLine(Line);
  guardAssociativeLine(Line);
  const line = new Line();
  expect(line.checkOverlapNode()).toBe("source");
  const queued = Promise.resolve().then(() => line.checkOverlapNode());
  line.isCreatingLine = false;
  line.creatingStartNode = null;
  await expect(queued).resolves.toBeUndefined();
});
describe("stable article block references", () => {
  it("uses the actual Markdown pipeline; keeps whole cards and ignores headings in fenced code", async () => {
    const index = await buildSourceIndex(markdown),
      rendered = await renderMdx(markdown);
    expect(
      index.blocks.filter((b) => b.kind === "heading").map((b) => b.title),
    ).toEqual(["章节", "子章节"]);
    const card = index.blocks.find((b) => b.kind === "callout")!;
    expect(card.markdown).toContain("卡片内容第二行");
    expect(rendered.html).toContain(`data-source-key="${card.key}"`);
    expect(rendered.html).toContain(
      `data-source-key="${index.blocks[0]!.key}"`,
    );
    expect(index.blocks.filter((b) => b.kind === "paragraph")).toHaveLength(1);
  });
  it("retains identity through insertion, renaming a heading, and moving an unchanged card", async () => {
    const first = await buildSourceIndex(markdown),
      oldCard = first.blocks.find((b) => b.kind === "callout")!;
    const inserted = await buildSourceIndex("新增段落。\n\n" + markdown, first);
    expect(inserted.blocks.find((b) => b.kind === "callout")!.blockId).toBe(
      oldCard.blockId,
    );
    const moved = await buildSourceIndex(
      "# 新章节\n\n" + oldCard.markdown + "\n\n其余内容",
      inserted,
    );
    expect(moved.blocks.find((b) => b.kind === "callout")!.blockId).toBe(
      oldCard.blockId,
    );
    const removed = await buildSourceIndex("# 章节\n\n卡片已删除", moved);
    expect(removed.blocks.some((b) => b.blockId === oldCard.blockId)).toBe(
      false,
    );
  });
  it("does not guess between indistinguishable duplicates", async () => {
    const first = await buildSourceIndex("相同段落\n\n相同段落");
    const next = await buildSourceIndex(
      "相同段落\n\n相同段落\n\n相同段落",
      first,
    );
    const ids = next.blocks.map((b) => b.blockId);
    expect(new Set(ids).size).toBe(3);
    // A middle duplicate cannot silently inherit either old boundary identity.
    expect(first.blocks.some((b) => b.blockId === ids[1])).toBe(false);
  });
  it("indexes renderable bodies inside tabs and collapse containers", async () => {
    const source =
      ":::tabs#demo\n\n@tab A\n\n第一段\n\n@tab B\n\n> [!TIP]- 标签卡片\n> 完整内容\n\n:::\n\n:::collapse\n\n- 折叠标签\n\n  折叠内文\n\n:::\n";
    const index = await buildSourceIndex(source),
      rendered = await renderMdx(source);
    expect(
      index.blocks.some(
        (block) =>
          block.text === "A" || block.text === "B" || block.text === "折叠标签",
      ),
    ).toBe(false);
    for (const block of index.blocks)
      expect(rendered.html).toContain(`data-source-key="${block.key}"`);
  });
});
describe("serial save queue", () => {
  const doc = (text: string): MapDocument => ({
    root: { data: { text }, children: [] },
  });
  it("serializes edits during an in-flight write and advances the expected revision", async () => {
    let release!: (version: number) => void;
    const write = vi
        .fn()
        .mockImplementationOnce(
          () => new Promise<number>((resolve) => (release = resolve)),
        )
        .mockResolvedValueOnce(2),
      persist = vi.fn();
    const queue = new MindmapSaveQueue(0, write, persist, () => {});
    queue.enqueue(doc("first"), "title");
    const done = queue.flush();
    queue.enqueue(doc("latest"), "title");
    release(1);
    expect(await done).toBe(true);
    expect(write.mock.calls.map((call) => call[0].revision)).toEqual([0, 1]);
    expect(write.mock.calls[1]![0].data.root.data.text).toBe("latest");
    expect(queue.pending).toBeNull();
    expect(queue.revision).toBe(2);
  });
  it("retains data on failure and freezes on conflict until explicitly resolved", async () => {
    const write = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(
        Object.assign(new Error("conflict"), { status: 409 }),
      );
    const queue = new MindmapSaveQueue(
      3,
      write,
      () => {},
      () => {},
    );
    queue.enqueue(doc("local"), "title");
    expect(await queue.flush()).toBe(false);
    expect(queue.pending?.data.root.data.text).toBe("local");
    expect(await queue.flush()).toBe(false);
    expect(queue.conflict).toBe(true);
    expect(await queue.flush()).toBe(false);
    expect(write).toHaveBeenCalledTimes(2);
  });
});
describe("AI candidates", () => {
  const source: MapSource = {
    domain: "article",
    targetId: "format-test",
    title: "格式测试",
    url: "/blog/format-test",
    contentHash: "test",
    blocks: [],
  };
  const json = JSON.stringify({ text: "知识", children: [{ text: "子主题" }] });
  it.each([
    ["plain JSON", json],
    ["trailing explanation", `${json}\n以上是文章的知识结构。`],
    [
      "fenced JSON with explanations",
      `以下是生成结果：\n\`\`\`json\n${json}\n\`\`\`\n已保留章节层级。`,
    ],
    ["uppercase fence and BOM", `\uFEFF\`\`\`JSON\r\n${json}\r\n\`\`\``],
    ["balanced brackets in prose", `[说明]\n${json}\n（可继续编辑）`],
  ])("extracts one complete map from %s", (_label, raw) => {
    const node = parseCandidate(raw, source);
    expect(node.data.text).toBe("知识");
    expect(node.children![0]!.data.text).toBe("子主题");
  });
  it("reproduces and fixes the reported error at position 4749", () => {
    const raw = json.padEnd(4749, " ") + "以上是生成的思维导图。";
    expect(() => JSON.parse(raw)).toThrow("Unexpected non-whitespace");
    expect(parseCandidate(raw, source).children![0]!.data.text).toBe("子主题");
  });
  it("keeps quotes, escaped backslashes, brackets and fence text inside node names", () => {
    const name = '集合 {A} [B] "引号" \\ 路径 ```json';
    const raw = `结果如下：\n${JSON.stringify({ text: name, children: [{ text: '\\"}' }] })}\n说明文字。`;
    const node = parseCandidate(raw, source);
    expect(node.data.text).toBe(name);
    expect(node.children![0]!.data.text).toBe('\\"}');
  });
  it.each([
    json + "\n" + json,
    `\`\`\`json\n${json}\n\`\`\`\n\`\`\`json\n${json}\n\`\`\``,
  ])(
    "rejects multiple complete maps instead of silently keeping one",
    (raw) => {
      expect(() => parseCandidate(raw, source)).toThrow("多个导图结果");
    },
  );
  it.each([
    "没有生成 JSON",
    '{"text":"被截断"',
    '{"text":"缺少逗号" "children":[]}',
    `${json}\n{"text":"第二份被截断"`,
    `${json}\n{"text":"第二份错误",}`,
  ])("reports malformed or truncated output in Chinese", (raw) => {
    expect(() => parseCandidate(raw, source)).toThrow(
      "JSON 不完整或格式不正确",
    );
  });
  it.each([
    '[{"text":"数组根"}]',
    '{"text":""}',
    '{"text":"根","children":"无效"}',
  ])("still validates the node schema", (raw) => {
    expect(() => parseCandidate(raw, source)).toThrow("节点格式不正确");
  });
  it("accepts nullable optional fields and preserves complete descriptive names", () => {
    const name = "完整的数学定义".repeat(20);
    const node = parseCandidate(JSON.stringify({ text: name, blockId: null, children: [{ text: "叶子", children: null, blockId: "" }] }), source);
    expect(node.data.text).toBe(name);
    expect(node.data.sourceRef).toBeUndefined();
    expect(node.children![0]!.children).toEqual([]);
  });
  it("does not reject a legitimate wide tree at 80 siblings; still enforces the total node limit", () => {
    const children = Array.from({ length: 90 }, (_, i) => ({ text: `概念 ${i}` }));
    expect(parseCandidate(JSON.stringify({ text: "概念", children }), source).children).toHaveLength(90);
    expect(() => parseCandidate(JSON.stringify({ text: "过大", children: Array.from({ length: 600 }, () => ({ text: "子主题" })) }), source)).toThrow("结构过大");
  });
  it("records schema failure paths without logging source or model content", () => {
    try {
      parseCandidate('{"text":"私有正文","children":[{"text":null}]}', source);
      expect.fail("invalid text accepted");
    } catch (error) {
      expect(error).toBeInstanceOf(AiNodeFormatError);
      expect((error as AiNodeFormatError).issues).toEqual([{ path: "children.0.text", code: "invalid_type" }]);
      expect(JSON.stringify((error as AiNodeFormatError).details)).not.toContain("私有正文");
    }
  });
  it("never converts an invented nonempty reference to an unlinked node", () => {
    expect(() => parseCandidate('{"text":"引用","blockId":"invented","children":null}', source)).toThrow("原文内容块已变化");
  });
  it("supplements omitted cards from verified source IDs without discarding generated structure", async () => {
    const index = await buildSourceIndex(markdown);
    const tree = parseCompleteCandidate('{"text":"原有生成结构","children":[{"text":"提炼概念"}]}', { ...source, ...index });
    expect(tree.data.text).toBe("原有生成结构");
    expect(tree.children![0]!.data.text).toBe("提炼概念");
    const added = tree.children![1]!;
    expect(added.data.text).toBe("原文引用卡片（补齐）");
    expect(added.children!.map(node => node.data.sourceRef!.blockId)).toEqual(index.blocks.filter(block => ["callout", "blockquote"].includes(block.kind)).map(block => block.blockId));
    expect(added.children![0]!.data.sourceRef!.quote).toContain("卡片内容第二行");
  });
  it("rejects empty responses and excessively deep JSON without a runtime stack error", () => {
    expect(() => parseCandidate(" \n ", source)).toThrow("未返回导图内容");
    expect(() =>
      parseCandidate("[".repeat(65) + "0" + "]".repeat(65), source),
    ).toThrow("结构过深");
  });
  it("validates source IDs after extracting a wrapped response", () => {
    expect(() =>
      parseCandidate(
        '结果：\n{"text":"伪造引用","blockId":"invented"}\n生成结束。',
        source,
      ),
    ).toThrow("原文内容块已变化");
  });
  it("accepts only supplied source block IDs and never splits a card", async () => {
    const index = await buildSourceIndex(markdown),
      source: MapSource = {
        domain: "article",
        targetId: "test",
        title: "test",
        url: "/blog/test",
        ...index,
      };
    const card = index.blocks.find((b) => b.kind === "callout")!;
    const tree = parseCandidate(
      JSON.stringify({
        text: "知识",
        children: [{ text: "改名后的卡片", blockId: card.blockId }],
      }),
      source,
    );
    expect(tree.children![0]!.data.sourceRef?.blockId).toBe(card.blockId);
    expect(() =>
      parseCandidate('{"text":"fake","blockId":"invented"}', source),
    ).toThrow();
    const chunks = sourceChunks(index.blocks, 600);
    expect(chunks.flat().map((b) => b.blockId)).toEqual(
      index.blocks.map((b) => b.blockId),
    );
    expect(() => sourceChunks(index.blocks, 20)).toThrow("单个内容块");
  });
});

describe("cross-window card drag data", () => {
  const ref = { version: 1 as const, source: { domain: "doc" as const, targetId: "article" }, blockId: "stable", fingerprint: "hash", text: "卡片", quote: "" };
  it("preserves source identity when the OS strips the custom MIME type", () => {
    const data = new Map<string, string>();
    writeMapDrag({ types: [], getData: (type) => data.get(type) || "", setData: (type, value) => { data.set(type, value); } }, ref);
    data.delete("application/x-byqx-mindmap-reference");
    expect(readMapDrag({ getData: (type) => data.get(type) || "" })).toEqual(ref);
  });
  it("does not treat arbitrary text, a partial payload or another protocol version as a reference", () => {
    expect(() => readMapDrag({ getData: () => "普通正文" })).toThrow();
    for (const value of [{ ...ref, version: 2 }, { text: "卡片" }, { ...ref, source: null }])
      expect(() => readMapDrag({ getData: (type) => type === "application/x-byqx-mindmap-reference" ? JSON.stringify(value) : "" })).toThrow();
  });
});
