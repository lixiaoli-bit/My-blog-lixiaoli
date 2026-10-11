import { beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { AstroCookies } from "astro";
import * as schema from "../db/schema.sqlite";
const state = vi.hoisted(() => ({
  db: null as unknown,
  content: "# 章节\n\n> [!NOTE] 卡片\n> 原文重点",
  encrypted: false,
  exists: true,
  aiEnabled: true,
  invalidAi: false,
  aiAborted: false,
  aiWrapping: "plain" as "plain" | "annotated" | "multiple" | "malformed",
}));
vi.mock("../src/lib/ai-config", () => ({
  getAiConfig: async () => ({
    enabled: state.aiEnabled,
    editContextTokens: 16384,
    editMaxTokens: 4096,
  }),
  isAiReady: (cfg: { enabled: boolean }) => cfg.enabled,
}));
vi.mock("../src/lib/pi-ai", () => ({
  createSiteAi: async () => ({}),
  streamSiteText: async function* (
    _cfg: unknown,
    context: { messages: { content: string }[] },
    options: { signal: AbortSignal },
  ) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    if (options.signal.aborted) {
      state.aiAborted = true;
      throw new Error("aborted");
    }
    const prompt = context.messages[0]!.content,
      blocks = JSON.parse(prompt.slice(prompt.indexOf("\n[") + 1));
    const raw = JSON.stringify({
      text: "生成章节",
      children: blocks
        .filter((b: { kind: string }) =>
          ["callout", "blockquote"].includes(b.kind),
        )
        .map((b: { blockId: string }) => ({
          text: "AI 卡片名",
          blockId: state.invalidAi ? "invented" : b.blockId,
        })),
    });
    if (state.aiWrapping === "annotated")
      yield "以下是生成的思维导图：\n```json\n";
    yield raw.slice(0, Math.floor(raw.length / 2));
    yield raw.slice(Math.floor(raw.length / 2));
    if (state.aiWrapping === "annotated")
      yield "\n```\n以上结果可在画布中继续编辑。";
    if (state.aiWrapping === "multiple") yield "\n" + raw;
    if (state.aiWrapping === "malformed") yield '\n{"text":"未完成的另一份';
  },
}));
vi.mock("../db", () => ({
  getPrimaryDb: () => state.db,
  get db() {
    return state.db;
  },
}));
vi.mock("../src/lib/articles", () => ({
  getArticleById: async (id: string) =>
    state.exists
      ? {
          id,
          title: "测试文章",
          slug: "test",
          content: state.content,
          encrypted: state.encrypted,
          encryptMeta: null,
        }
      : null,
}));
vi.mock("../src/lib/docs", () => ({
  getDocNode: async (id: string) => ({
    id,
    kind: "article",
    title: "文档文章",
    bundleId: "bundle",
    content: state.content,
  }),
}));
vi.mock("../src/lib/admin-auth", () => ({
  canManage: async (cookies: { rights: string[] }, permission: string) =>
    cookies.rights.includes(permission),
  isTopAdmin: async (cookies: { top?: boolean }) => Boolean(cookies.top),
}));
import {
  ensureMap,
  mapPayload,
  saveMap,
  reference,
  validateDocument,
} from "../src/lib/mindmap-service";
import { GET, PUT } from "../src/pages/api/mindmaps/[id]";
import { POST as addRef } from "../src/pages/api/mindmaps/[id]/refs";
import { POST as aiMap } from "../src/pages/api/ai/mindmaps";
import { POST as renderNames } from "../src/pages/api/mindmaps/[id]/render";
const owner = {
  rights: ["articles", "docs"],
  top: true,
  get: () => undefined,
} as unknown as AstroCookies;
const guest = { rights: [], get: () => undefined } as unknown as AstroCookies;
let sqlite: Database.Database;
beforeEach(() => {
  sqlite?.close();
  sqlite = new Database(":memory:");
  sqlite.exec(`CREATE TABLE mindmaps (id text PRIMARY KEY,title text NOT NULL,article_id text,data text NOT NULL,revision integer NOT NULL DEFAULT 0,created_at integer NOT NULL,updated_at integer NOT NULL);
    CREATE TABLE mindmap_bindings (id text PRIMARY KEY,domain text NOT NULL,target_id text NOT NULL,map_id text NOT NULL,updated_at integer NOT NULL);
    CREATE TABLE source_block_indexes (id text PRIMARY KEY,data text NOT NULL,updated_at integer NOT NULL);
    CREATE TABLE mindmap_backups (id text PRIMARY KEY,map_id text NOT NULL,data text NOT NULL,updated_at integer NOT NULL);`);
  state.db = drizzle(sqlite, { schema });
  state.encrypted = false;
  state.exists = true;
  state.content = "# 章节\n\n> [!NOTE] 卡片\n> 原文重点";
  state.aiEnabled = true;
  state.invalidAi = false;
  state.aiAborted = false;
  state.aiWrapping = "plain";
});
describe("Markdown node names", () => {
  const render = (id: string, nodes: unknown[], cookies = owner) =>
    renderNames({
      params: { id },
      cookies,
      request: new Request(`http://test/api/mindmaps/${id}/render`, {
        method: "POST",
        body: JSON.stringify({ nodes }),
      }),
    } as never);
  it("uses the article pipeline for formulas, callouts, tabs and highlighted text without saving HTML", async () => {
    const map = await ensureMap({ domain: "article", targetId: "id" }, owner);
    const text =
      "**名称** $\\frac{a}{b}$\n\n> [!NOTE] 提示\n> 原文重点\n\n:::tabs\n@tab 第一项\n内容一\n@tab 第二项\n内容二\n:::";
    const response = await render(map.id, [{ uid: "draft", text }]);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const result = (await response.json()).nodes[0];
    expect(result.html).toContain("<strong>名称</strong>");
    expect(result.html).toContain('class="katex"');
    expect(result.html).toContain("callout");
    expect(result.html).toContain('role="tab"');
    expect(result.text).toBe(text);
    expect((await mapPayload(map.id, owner)).data).toEqual(map.data);
  });
  it("allows visitors to render persisted names and rejects draft or forged names", async () => {
    let map = await ensureMap({ domain: "doc", targetId: "id" }, owner);
    map = await saveMap(
      map.id,
      map.revision,
      {
        version: map.version,
        data: { root: { data: { uid: "root", text: "**章节**" } } },
      },
      owner,
    );
    expect(
      (await render(map.id, [{ uid: "root", text: "**章节**" }], guest)).status,
    ).toBe(200);
    expect(
      (await render(map.id, [{ uid: "root", text: "**替换**" }], guest)).status,
    ).toBe(403);
    expect(
      (await render(map.id, [{ uid: "unknown", text: "**章节**" }], guest))
        .status,
    ).toBe(403);
  });
  it("enforces the article password gate before rendering", async () => {
    const map = await ensureMap({ domain: "article", targetId: "id" }, owner);
    state.encrypted = true;
    expect(
      (await render(map.id, [{ uid: "root", text: "秘密" }], guest)).status,
    ).toBe(403);
  });
  it("renders legacy visitor nodes without persisted UIDs while rejecting other text", async () => {
    let map = await ensureMap({ domain: "doc", targetId: "id" }, owner);
    map = await saveMap(
      map.id,
      map.revision,
      {
        version: map.version,
        data: { root: { data: { text: "**旧节点**" } } },
      },
      owner,
    );
    expect(
      (
        await render(
          map.id,
          [{ uid: "engine-generated", text: "**旧节点**" }],
          guest,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await render(
          map.id,
          [{ uid: "engine-generated", text: "**未知节点**" }],
          guest,
        )
      ).status,
    ).toBe(403);
  });
  it("bounds render requests and reports invalid Markdown per node", async () => {
    const map = await ensureMap({ domain: "article", targetId: "id" }, owner);
    expect(
      (
        await render(
          map.id,
          Array.from({ length: 33 }, () => ({ uid: "root", text: "x" })),
        )
      ).status,
    ).toBe(400);
    expect(
      (await render(map.id, [{ uid: "root", text: "x".repeat(10001) }])).status,
    ).toBe(400);
    const response = await render(map.id, [
      { uid: "broken", text: "<UnknownWidget />" },
      { uid: "valid", text: "**正常**" },
    ]);
    const results = (await response.json()).nodes;
    expect(results[0].error).toContain("源码已保留");
    expect(results[1].html).toContain("<strong>正常</strong>");
  });
});

describe("AI stream does not mutate saved maps", () => {
  it("rejects malformed source references before loading an imported map", () => {
    expect(() =>
      validateDocument({
        root: {
          data: {
            text: "主题",
            sourceRef: { domain: "article", targetId: "id", blockId: "block" },
          },
        },
      }),
    ).toThrow("原文引用格式");
  });
  const context = (body: unknown, cookies = owner) => ({
    cookies,
    request: new Request("http://test/api", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  });
  it("streams an annotated model reply as a verified preview without modifying the map", async () => {
    state.aiWrapping = "annotated";
    const map = await ensureMap({ domain: "doc", targetId: "id" }, owner);
    const response = await aiMap(
      context({
        mapId: map.id,
        revision: map.revision,
        version: map.version,
        contentHash: map.source!.contentHash,
      }) as never,
    );
    const events = (await response.text())
      .trim()
      .split("\n\n")
      .map((line) => JSON.parse(line.replace(/^data: /, "")));
    expect(events.map((event) => event.type)).toEqual([
      "progress",
      "progress",
      "progress",
      "candidate",
    ]);
    expect(events[0].phase).toBe("structure");
    expect(events[2].phase).toBe("merge");
    const card = map.source!.blocks.find((block) => block.kind === "callout")!;
    expect(
      events[3].branch.children[0].children[0].data.sourceRef.blockId,
    ).toBe(card.blockId);
    expect(events[3].branch.children[0].data.text).toBe("章节");
    const saved = await mapPayload(map.id, owner);
    expect(saved.revision).toBe(map.revision);
    expect(saved.data).toEqual(map.data);
  });
  it.each(["multiple", "malformed"] as const)(
    "reports %s JSON without returning or saving a candidate",
    async (wrapping) => {
      state.aiWrapping = wrapping;
      const map = await ensureMap({ domain: "doc", targetId: "id" }, owner);
      const response = await aiMap(
        context({
          mapId: map.id,
          revision: map.revision,
          version: map.version,
          contentHash: map.source!.contentHash,
        }) as never,
      );
      const text = await response.text();
      expect(text).toContain('"type":"error"');
      expect(text).not.toContain('"type":"candidate"');
      expect(text).not.toContain("Unexpected non-whitespace");
      expect((await mapPayload(map.id, owner)).data).toEqual(map.data);
    },
  );
  it("streams progress and verified candidates while retaining the map revision", async () => {
    const map = await ensureMap({ domain: "doc", targetId: "id" }, owner),
      body = {
        mapId: map.id,
        revision: map.revision,
        version: map.version,
        contentHash: map.source!.contentHash,
      };
    const response = await aiMap(context(body) as never),
      text = await response.text();
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(text).toContain('"type":"progress"');
    expect(text).toContain('"type":"candidate"');
    expect(text).toContain(
      map.source!.blocks.find((b) => b.kind === "callout")!.blockId,
    );
    expect((await mapPayload(map.id, owner)).revision).toBe(0);
    expect((await mapPayload(map.id, owner)).data.root.children).toHaveLength(
      0,
    );
    expect(
      (await aiMap(context({ ...body, contentHash: "stale" }) as never)).status,
    ).toBe(409);
    expect((await aiMap(context(body, guest) as never)).status).toBe(403);
    state.aiEnabled = false;
    expect((await aiMap(context(body) as never)).status).toBe(503);
  });
  it("rejects fabricated source IDs and propagates client cancellation", async () => {
    const map = await ensureMap({ domain: "doc", targetId: "id" }, owner),
      body = {
        mapId: map.id,
        revision: 0,
        version: map.version,
        contentHash: map.source!.contentHash,
      };
    state.invalidAi = true;
    const invalid = await aiMap(context(body) as never),
      text = await invalid.text();
    expect(text).toContain('"type":"error"');
    expect(text).not.toContain('"type":"candidate"');
    state.invalidAi = false;
    const response = await aiMap(context(body) as never),
      reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(state.aiAborted).toBe(true);
    expect((await mapPayload(map.id, owner)).revision).toBe(0);
  });
});
describe("article map authority and concurrency", () => {
  it("atomically reserves one map during concurrent first opens for both domains", async () => {
    for (const domain of ["article", "doc"] as const) {
      const maps = await Promise.all(
        Array.from({ length: 8 }, () =>
          ensureMap({ domain, targetId: "id" }, owner),
        ),
      );
      expect(new Set(maps.map((map) => map.id)).size).toBe(1);
    }
    expect(sqlite.prepare("SELECT count(*) count FROM mindmaps").get()).toEqual(
      { count: 2 },
    );
  });
  it("rejects stale saves and preserves the newest data", async () => {
    const map = await ensureMap({ domain: "article", targetId: "id" }, owner);
    const first = structuredClone(map.data),
      second = structuredClone(map.data);
    first.root.data.text = "first";
    second.root.data.text = "second";
    const results = await Promise.allSettled([
      saveMap(map.id, 0, { data: first, version: map.version }, owner),
      saveMap(map.id, 0, { data: second, version: map.version }, owner),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect((await mapPayload(map.id, owner)).revision).toBe(1);
    await expect(
      saveMap(map.id, undefined, { data: first }, owner),
    ).rejects.toMatchObject({ status: 428 });
  });
  it("also rejects divergent sync content when the numeric revision is unchanged", async () => {
    const map = await ensureMap({ domain: "article", targetId: "id" }, owner);
    sqlite
      .prepare("UPDATE mindmaps SET title = ? WHERE id = ?")
      .run("同步后的另一份内容", map.id);
    await expect(
      saveMap(
        map.id,
        map.revision,
        { data: map.data, version: map.version },
        owner,
      ),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("checks password gating on the detail API and source-specific write permissions", async () => {
    const map = await ensureMap({ domain: "article", targetId: "id" }, owner);
    state.encrypted = true;
    const response = await GET({
      params: { id: map.id },
      cookies: guest,
    } as never);
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("原文重点");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const writer = {
      rights: ["docs"],
      get: () => undefined,
    } as unknown as AstroCookies;
    await expect(
      saveMap(map.id, 0, { title: "changed" }, writer),
    ).rejects.toMatchObject({ status: 403 });
    const privateMap = {
      id: "private",
      title: "secret",
      articleId: null,
      data: JSON.stringify(map.data),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await (state.db as ReturnType<typeof drizzle>)
      .insert(schema.mindmaps)
      .values(privateMap);
    await expect(mapPayload("private", guest)).rejects.toMatchObject({
      status: 403,
    });
  });
  it("keeps renamed card references and rejects missing parents, foreign articles, and invalid source IDs", async () => {
    const map = await ensureMap({ domain: "doc", targetId: "id" }, owner),
      block = map.source!.blocks.find((b) => b.kind === "callout")!;
    const context = (body: unknown) => ({
      params: { id: map.id },
      cookies: owner,
      request: new Request("http://test/api", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    });
    const body = {
      source: { domain: "doc", targetId: "id" },
      blockId: block.blockId,
      revision: 0,
      version: map.version,
      text: "自定义名称",
    };
    expect(
      (await addRef(context({ ...body, parentId: "missing" }) as never)).status,
    ).toBe(409);
    expect(
      (
        await addRef(
          context({
            ...body,
            source: { domain: "doc", targetId: "other" },
          }) as never,
        )
      ).status,
    ).toBe(400);
    expect((await addRef(context(body) as never)).status).toBe(200);
    const saved = await mapPayload(map.id, owner);
    expect(saved.data.root.children![0]!.data.sourceRef?.blockId).toBe(
      block.blockId,
    );
    expect(saved.data.root.children![0]!.data.text).toBe("自定义名称");
    expect(() => reference(map.source!, "made-up")).toThrow();
    const upgrade = await PUT({
      params: { id: map.id },
      cookies: owner,
      request: new Request("http://test/api", {
        method: "PUT",
        body: JSON.stringify({ data: saved.data }),
      }),
    } as never);
    expect(upgrade.status).toBe(428);
  });
  it("requires primary selection for legacy duplicates, backs up and detaches the rest", async () => {
    const now = Date.now(),
      data = JSON.stringify({ root: { data: { text: "root" } } });
    const insert = sqlite.prepare(
      "INSERT INTO mindmaps VALUES (?, ?, ?, ?, 0, ?, ?)",
    );
    insert.run("one", "one", "id", data, now, now);
    insert.run("two", "two", "id", data, now, now);
    await expect(
      ensureMap({ domain: "article", targetId: "id" }, owner),
    ).rejects.toMatchObject({
      status: 409,
      details: { choosePrimary: [{ id: "one" }, { id: "two" }] },
    });
    const chosen = await ensureMap(
      { domain: "article", targetId: "id" },
      owner,
      "two",
    );
    expect(chosen.id).toBe("two");
    expect(
      sqlite.prepare("SELECT article_id FROM mindmaps WHERE id = ?").get("one"),
    ).toEqual({ article_id: null });
    expect(
      sqlite.prepare("SELECT count(*) count FROM mindmap_backups").get(),
    ).toEqual({ count: 1 });
  });
});
