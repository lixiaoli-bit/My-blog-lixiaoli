import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
const root = path.resolve(import.meta.dirname, ".."),
  output = path.join(root, "outputs/article-mindmap"),
  base = "http://127.0.0.1:43227";
const browser = await chromium.launch({ channel: "msedge", headless: true });
fs.rmSync(path.join(output, "browser-results.json"), { force: true });
fs.rmSync(path.join(output, "browser-failure.json"), { force: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 950 },
  extraHTTPHeaders: { Origin: base },
});
const errors = [],
  results = [];
let currentCheck = "startup";
context.on("page", (page) =>
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.error("PAGE_ERROR", currentCheck, page.url(), error.stack);
  }),
);
const check = async (label, task) => {
  currentCheck = label;
  try {
    await task();
  } catch (error) {
    fs.writeFileSync(
      path.join(output, "browser-failure.json"),
      JSON.stringify(
        { label, error: String(error), passed: results, errors },
        null,
        2,
      ),
    );
    throw error;
  }
  results.push(label);
  console.log("PASS", label);
};
const post = async (url, data) => {
  const response = await context.request.post(base + url, { data });
  const result = await response.json();
  assert.ok(response.ok(), `${url}: ${JSON.stringify(result)}`);
  return result;
};
const fetchMap = async (id) =>
  (await (await context.request.get(`${base}/api/mindmaps/${id}`)).json()).map;
const waitFor = async (predicate) => {
  for (let i = 0; i < 80; i++) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw Error("Timed out");
};
try {
  await post("/api/admin-auth/login", { password: "mindmap-review-local" });
  // Production builds issue Secure cookies. This isolated HTTP-only fixture uses local cookies.
  await context.addCookies(
    (await context.cookies()).map((cookie) => ({ ...cookie, secure: false })),
  );
  const source = { domain: "article", targetId: "map-review" };
  let map;
  await check("parallel ensure produces one map", async () => {
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => post("/api/mindmaps/ensure", { source })),
    );
    assert.equal(new Set(responses.map((r) => r.map.id)).size, 1);
    map = responses[0].map;
  });
  const article = await context.newPage();
  await article.goto(`${base}/edit/map-review`);
  await article.locator("[data-map-open]").waitFor();
  await check(
    "article entry follows Edit; complete card has drag and add controls",
    async () => {
      await article.locator(".map-card-tools").first().waitFor();
      assert.equal(
        await article.locator("#doc-inline-edit + [data-map-open]").count(),
        1,
      );
      assert.ok(
        (await article.locator(".map-card-tools button[draggable]").count()) >=
          2,
      );
    },
  );
  const windowPromise = context.waitForEvent("page");
  await article.locator("[data-map-open]").click();
  const editor = await windowPromise;
  await editor.waitForLoadState();
  await editor.locator(".smm-node").first().waitFor();
  await check("independent canvas and keyboard editing persist", async () => {
    await editor.locator(".smm-node").first().click();
    await editor.keyboard.press("Tab");
    await editor.locator(".smm-node-edit-wrap").waitFor();
    await editor.keyboard.type("键盘子主题");
    await editor.keyboard.press("Enter");
    await waitFor(async () =>
      JSON.stringify((await fetchMap(map.id)).data).includes("键盘子主题"),
    );
    await editor.keyboard.press("Control+Enter");
    await editor.locator(".smm-node-edit-wrap").waitFor();
    await editor.keyboard.type("父主题");
    await editor.keyboard.press("Enter");
    await waitFor(async () =>
      JSON.stringify((await fetchMap(map.id)).data).includes("父主题"),
    );
  });
  await check(
    "structured card drop onto canvas persists source independent of its name",
    async () => {
      const ref = await article.evaluate(() => {
        const button = document.querySelector(
            ".map-card-tools button[draggable]",
          ),
          transfer = new DataTransfer();
        button.dispatchEvent(
          new DragEvent("dragstart", { dataTransfer: transfer, bubbles: true }),
        );
        return JSON.parse(
          transfer.getData("application/x-byqx-mindmap-reference"),
        );
      });
      ref.text = "自由重命名的卡片";
      await editor.locator(".map-canvas").evaluate((canvas, ref) => {
        const transfer = new DataTransfer();
        transfer.setData(
          "application/x-byqx-mindmap-reference",
          JSON.stringify(ref),
        );
        canvas.dispatchEvent(
          new DragEvent("drop", { bubbles: true, dataTransfer: transfer }),
        );
      }, ref);
      await waitFor(async () =>
        JSON.stringify((await fetchMap(map.id)).data).includes(
          "自由重命名的卡片",
        ),
      );
      const saved = await fetchMap(map.id),
        node = saved.data.root.children.find((n) => n.data.text === ref.text);
      assert.equal(node.data.sourceRef.blockId, ref.blockId);
      await editor.locator("[data-source-jump]").first().waitFor();
    },
  );
  await check(
    "node jump reuses the article window and reveals collapsed cards and hidden tabs",
    async () => {
      const saved = await fetchMap(map.id),
        refNode = saved.data.root.children.find(
          (node) => node.data.text === "自由重命名的卡片",
        );
      const pageCount = context.pages().length;
      await editor.locator(`[data-source-jump="${refNode.data.uid}"]`).click();
      await article.waitForURL(
        `**/blog/map-review#block-${refNode.data.sourceRef.blockId}`,
      );
      await article
        .locator(`[data-source-block="${refNode.data.sourceRef.blockId}"]`)
        .waitFor();
      assert.equal(
        await article
          .locator(`[data-source-block="${refNode.data.sourceRef.blockId}"]`)
          .evaluate((card) => card.open),
        true,
      );
      assert.equal(context.pages().length, pageCount);
      const tabCard = saved.source.blocks.find(
        (block) => block.title === "标签页卡片",
      );
      assert.ok(tabCard);
      const added = await post(`/api/mindmaps/${map.id}/refs`, {
        source,
        revision: saved.revision,
        version: saved.version,
        blockId: tabCard.blockId,
        text: "标签卡片引用",
      });
      await editor.reload();
      await editor.locator(".smm-node").first().waitFor();
      const node = added.map.data.root.children.find(
        (node) => node.data.text === "标签卡片引用",
      );
      await editor.locator(`[data-source-jump="${node.data.uid}"]`).click();
      await article.waitForURL(`**/blog/map-review#block-${tabCard.blockId}`);
      await article
        .locator(`[data-source-block="${tabCard.blockId}"]`)
        .waitFor();
      assert.equal(
        await article
          .locator(".md-tabs-tab")
          .nth(1)
          .getAttribute("aria-selected"),
        "true",
      );
    },
  );
  await check(
    "AI unavailable is visible; preview appends in one undo step",
    async () => {
      await editor
        .getByRole("button", { name: "AI 生成", exact: true })
        .click();
      await editor
        .getByText("请先在 AI 助手设置中启用并配置文字模型")
        .waitFor();
      await editor.getByRole("button", { name: "取消", exact: true }).click();
      const before = await fetchMap(map.id);
      await editor.route("**/api/ai/mindmaps", async (route) => {
        const input = route.request().postDataJSON();
        await route.fulfill({
          contentType: "text/event-stream",
          body: `data: ${JSON.stringify({ type: "progress", current: 1, total: 1, range: "章节" })}\n\ndata: ${JSON.stringify({ type: "candidate", revision: input.revision, mapVersion: input.version, contentHash: input.contentHash, branch: { data: { text: "AI 整理", expand: true }, children: [{ data: { text: "模型预览分支", expand: true }, children: [] }] } })}\n\n`,
        });
      });
      await editor
        .getByRole("button", { name: "AI 生成", exact: true })
        .click();
      await editor.getByText("模型预览分支", { exact: true }).waitFor();
      assert.equal(
        JSON.stringify((await fetchMap(map.id)).data).includes("模型预览分支"),
        false,
      );
      await editor
        .getByRole("button", { name: "作为新分支加入", exact: true })
        .click();
      await waitFor(async () =>
        JSON.stringify((await fetchMap(map.id)).data).includes("模型预览分支"),
      );
      await editor.getByRole("button", { name: "撤销", exact: true }).click();
      await waitFor(
        async () =>
          !JSON.stringify((await fetchMap(map.id)).data).includes(
            "模型预览分支",
          ),
      );
      assert.equal(
        (await fetchMap(map.id)).data.root.children.length,
        before.data.root.children.length,
      );
    },
  );
  await check(
    "light/dark 1440/1024/390 layouts keep canvas and controls within viewport",
    async () => {
      for (const width of [1440, 1024, 390]) {
        await editor.setViewportSize({ width, height: 900 });
        await editor.waitForTimeout(180);
        assert.ok(
          await editor.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        );
        const box = await editor.locator(".map-canvas").boundingBox();
        assert.ok(box.height > 300);
        assert.equal(
          await editor
            .locator(".map-canvas")
            .evaluate((canvas) => getComputedStyle(canvas).overflow),
          "hidden",
        );
        await editor
          .locator(".map-canvas")
          .click({
            button: "right",
            position: { x: box.width - 12, y: box.height - 12 },
          });
        const menu = editor.getByRole("menu", { name: "节点展开与折叠菜单" });
        await menu.waitFor();
        const menuBox = await menu.boundingBox();
        assert.ok(menuBox.x >= 0 && menuBox.x + menuBox.width <= width);
        assert.ok(menuBox.y >= 0 && menuBox.y + menuBox.height <= 900);
        await editor.keyboard.press("Escape");
        assert.equal(await menu.count(), 0);
        if (width === 390) {
          await editor.locator(".map-mobile-tools summary").click();
          await editor
            .getByRole("button", { name: "属性", exact: true })
            .waitFor();
          await editor
            .getByRole("textbox", { name: "搜索节点", exact: true })
            .waitFor();
          await editor.locator(".map-mobile-tools summary").click();
        }
        await editor.screenshot({
          path: path.join(output, `map-light-${width}.png`),
          fullPage: true,
        });
        await editor.getByRole("button", { name: "明暗", exact: true }).click();
        assert.equal(
          await editor.evaluate(
            () => JSON.parse(localStorage.getItem("my-blog-theme")).mode,
          ),
          "dark",
        );
        await editor.waitForTimeout(350);
        assert.equal(
          await editor
            .getByRole("combobox", { name: "布局", exact: true })
            .isDisabled(),
          false,
        );
        await editor.screenshot({
          path: path.join(output, `map-dark-${width}.png`),
          fullPage: true,
        });
        await editor.getByRole("button", { name: "明暗", exact: true }).click();
        await editor.waitForTimeout(350);
      }
    },
  );
  await check(
    "XMind fold shortcuts toggle both ways; inputs and IME composition do not change the tree; exports restore full JSON",
    async () => {
      await editor.setViewportSize({ width: 1440, height: 950 });
      await editor.getByRole("button", { name: "保存", exact: true }).click();
      await editor.locator(".map-canvas").click({ position: { x: 60, y: 60 } });
      await editor.keyboard.press("Control+Alt+/");
      await editor.getByRole("button", { name: "保存", exact: true }).click();
      await editor.locator(".map-canvas").click({ position: { x: 60, y: 60 } });
      await waitFor(async () =>
        (await fetchMap(map.id)).data.root.children.some(
          (node) => node.children?.length && node.data.expand === false,
        ),
      );
      await editor.keyboard.press("Control+Alt+/");
      await editor.getByRole("button", { name: "保存", exact: true }).click();
      await waitFor(async () =>
        (await fetchMap(map.id)).data.root.children.every(
          (node) => !node.children?.length || node.data.expand !== false,
        ),
      );
      const before = JSON.stringify((await fetchMap(map.id)).data.root);
      await editor
        .getByRole("textbox", { name: "搜索节点", exact: true })
        .focus();
      await editor.keyboard.press("Control+Enter");
      await editor.locator(".map-canvas").evaluate((canvas) =>
        canvas.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Tab",
            code: "Tab",
            keyCode: 9,
            isComposing: true,
            bubbles: true,
          }),
        ),
      );
      await editor.getByRole("button", { name: "保存", exact: true }).click();
      assert.equal(JSON.stringify((await fetchMap(map.id)).data.root), before);
      await editor.locator(".map-header summary").click();
      for (const [name, extension] of [
        ["JSON 备份", "json"],
        ["SVG", "svg"],
        ["PNG", "png"],
        ["MD", "md"],
      ]) {
        const download = editor.waitForEvent("download");
        await editor.getByRole("button", { name, exact: true }).click();
        const file = await download;
        await file.saveAs(path.join(output, `export.${extension}`));
        assert.ok(
          fs.statSync(path.join(output, `export.${extension}`)).size > 40,
        );
      }
      const backup = JSON.parse(
        fs.readFileSync(path.join(output, "export.json"), "utf8"),
      );
      assert.ok(backup.theme.config.root);
      assert.ok(backup.view.state);
      assert.ok(JSON.stringify(backup).includes("sourceRef"));
      await editor.locator(".map-header summary").click();
      await editor
        .getByRole("combobox", { name: "布局", exact: true })
        .selectOption("mindMap");
      await editor.getByRole("button", { name: "保存", exact: true }).click();
      await editor.locator(".map-header summary").click();
      const originalBackup = editor.waitForEvent("download");
      await editor
        .locator('input[type="file"]')
        .setInputFiles(path.join(output, "export.json"));
      await (
        await originalBackup
      ).saveAs(path.join(output, "before-import.json"));
      await waitFor(
        async () => (await fetchMap(map.id)).data.layout === backup.layout,
      );
      const restored = await fetchMap(map.id);
      assert.equal(
        await editor
          .getByRole("combobox", { name: "布局", exact: true })
          .inputValue(),
        backup.layout,
      );
      assert.deepEqual(restored.data.root, backup.root);
      assert.deepEqual(restored.data.theme, backup.theme);
      assert.equal(restored.data.view.state.scale, backup.view.state.scale);
      await editor.locator('input[type="file"]').setInputFiles({
        name: "invalid-reference.json",
        mimeType: "application/json",
        buffer: Buffer.from(
          JSON.stringify({
            root: {
              data: {
                text: "invalid",
                sourceRef: { blockId: "missing-fields" },
              },
            },
          }),
        ),
      });
      await editor
        .locator(".map-alert")
        .filter({ hasText: "节点的原文引用格式不合法" })
        .waitFor();
      assert.deepEqual((await fetchMap(map.id)).data.root, restored.data.root);
      await editor
        .locator(".map-alert")
        .filter({ hasText: "节点的原文引用格式不合法" })
        .getByRole("button", { name: "关闭", exact: true })
        .click();
      await editor.locator(".map-header summary").click();
    },
  );
  await check(
    "common editing tools persist rename, notes, style, boundaries, summaries, relationships and layouts",
    async () => {
      const toolMap = (
        await post("/api/mindmaps", {
          title: "编辑工具验收",
          data: {
            layout: "logicalStructure",
            root: {
              data: { text: "工具根节点", uid: "tools-root" },
              children: [
                {
                  data: { text: "工具左分支", uid: "tools-left" },
                  children: [
                    {
                      data: { text: "工具叶节点", uid: "tools-leaf" },
                      children: [],
                    },
                  ],
                },
                {
                  data: { text: "工具右分支", uid: "tools-right" },
                  children: [],
                },
              ],
            },
          },
        })
      ).map;
      const page = await context.newPage();
      await page.goto(`${base}/mindmaps?id=${toolMap.id}`);
      const left = () =>
        page.locator(".smm-node").filter({ hasText: "工具左分支" }).first();
      await left().waitFor();
      const otherBranchExpanded =
        (await fetchMap(toolMap.id)).data.root.children[1].data.expand !==
        false;
      await left().click({ button: "right" });
      const menu = page.getByRole("menu", { name: "节点展开与折叠菜单" });
      await menu
        .getByRole("menuitem", { name: "折叠所有", exact: true })
        .click();
      await waitFor(
        async () =>
          (await fetchMap(toolMap.id)).data.root.children[0].data.expand ===
          false,
      );
      assert.equal(
        (await fetchMap(toolMap.id)).data.root.children[1].data.expand !==
          false,
        otherBranchExpanded,
      );
      await left().click({ button: "right" });
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Home");
      assert.equal(
        await page.evaluate(() => document.activeElement.textContent),
        "展开所有",
      );
      await page.keyboard.press("Enter");
      await waitFor(
        async () =>
          (await fetchMap(toolMap.id)).data.root.children[0].data.expand ===
          true,
      );
      await left().click({ button: "right" });
      await menu
        .getByRole("menuitem", { name: "折叠整张图", exact: true })
        .click();
      await waitFor(
        async () =>
          (await fetchMap(toolMap.id)).data.root.children[0].data.expand ===
          false,
      );
      await page
        .locator(".smm-node")
        .filter({ hasText: "工具根节点" })
        .click({ button: "right" });
      await menu
        .getByRole("menuitem", { name: "展开所有", exact: true })
        .click();
      await waitFor(
        async () =>
          (await fetchMap(toolMap.id)).data.root.children[0].data.expand ===
          true,
      );
      await left().click();
      await page.keyboard.press("Control+b");
      await page
        .locator(".map-tools > details")
        .first()
        .locator("summary")
        .click();
      await page.getByRole("button", { name: "概要", exact: true }).click();
      await page.locator(".smm-node-edit-wrap").waitFor();
      await page.keyboard.type("分支概要");
      await page.keyboard.press("Enter");
      await page
        .locator(".map-tools > details")
        .first()
        .locator("summary")
        .click();
      await left().click();
      await page.getByRole("button", { name: "属性", exact: true }).click();
      await page
        .getByRole("textbox", { name: "备注", exact: true })
        .fill("工具备注");
      await page
        .getByRole("combobox", { name: "形状", exact: true })
        .selectOption("roundedRectangle");
      await page.getByRole("button", { name: "收起属性", exact: true }).click();
      await left().click();
      await page.keyboard.press("Control+Shift+r");
      await page
        .locator(".smm-node")
        .filter({ hasText: "工具右分支" })
        .first()
        .hover();
      await page.waitForTimeout(150);
      await page
        .locator(".smm-node")
        .filter({ hasText: "工具右分支" })
        .first()
        .click();
      await page.getByRole("button", { name: "保存", exact: true }).click();
      await waitFor(async () =>
        JSON.stringify((await fetchMap(toolMap.id)).data).includes(
          "associativeLineTargets",
        ),
      );
      const saved = await fetchMap(toolMap.id),
        branch = saved.data.root.children.find(
          (n) => n.data.uid === "tools-left",
        );
      assert.ok(branch.data.outerFrame);
      assert.ok(branch.data.generalization);
      assert.equal(branch.data.note, "工具备注");
      assert.equal(branch.data.shape, "roundedRectangle");
      assert.ok(branch.data.associativeLineTargets.includes("tools-right"));
      for (const layout of [
        "mindMap",
        "catalogOrganization",
        "organizationStructure",
        "logicalStructure",
      ]) {
        await page
          .getByRole("combobox", { name: "布局", exact: true })
          .selectOption(layout);
        await page.getByRole("button", { name: "保存", exact: true }).click();
        await waitFor(
          async () => (await fetchMap(toolMap.id)).data.layout === layout,
        );
      }
      await left().click();
      await page.keyboard.press("F2");
      await page.locator(".smm-node-edit-wrap").waitFor();
      await page.keyboard.type("工具改名");
      await page.keyboard.press("Enter");
      await waitFor(async () =>
        JSON.stringify((await fetchMap(toolMap.id)).data).includes("工具改名"),
      );
      await page
        .locator(".smm-node")
        .filter({ hasText: "工具改名" })
        .first()
        .click();
      await page.keyboard.press("Delete");
      await waitFor(
        async () =>
          !JSON.stringify((await fetchMap(toolMap.id)).data).includes(
            "工具改名",
          ),
      );
      await page.keyboard.press("Control+z");
      await waitFor(async () =>
        JSON.stringify((await fetchMap(toolMap.id)).data).includes("工具改名"),
      );
      await page.keyboard.press("Control+Shift+z");
      await waitFor(
        async () =>
          !JSON.stringify((await fetchMap(toolMap.id)).data).includes(
            "工具改名",
          ),
      );
    },
  );
  await check(
    "doc switching binds the current article and keeps bundle-aware URLs",
    async () => {
      const doc = await context.newPage();
      await doc.goto(`${base}/doc/map-bundle?article=map-doc`);
      await doc.locator(".map-card-tools").first().waitFor();
      const result = await post("/api/mindmaps/ensure", {
        source: { domain: "doc", targetId: "map-doc" },
      });
      assert.ok(result.map.source.url.includes("map-bundle?article=map-doc"));
      await doc.goto(`${base}/doc/map-bundle?article=map-doc-two`);
      await doc
        .locator('[data-map-open][data-map-target="map-doc-two"]')
        .waitFor();
    },
  );
  await check(
    "broken references open the matching node properties and can be explicitly relinked",
    async () => {
      const broken = (
        await post("/api/mindmaps/ensure", {
          source: { domain: "doc", targetId: "map-doc-two" },
        })
      ).map;
      broken.data.root.children = [
        {
          data: {
            text: "失效卡片",
            uid: "broken-card",
            sourceRef: {
              domain: "doc",
              targetId: "map-doc-two",
              blockId: "deleted-block",
              fingerprint: "old",
              quote: "已删除的原文",
            },
          },
          children: [],
        },
      ];
      const result = await context.request.put(
        `${base}/api/mindmaps/${broken.id}`,
        {
          data: {
            revision: broken.revision,
            version: broken.version,
            data: broken.data,
          },
        },
      );
      assert.equal(result.status(), 200);
      const page = await context.newPage();
      await page.goto(`${base}/mindmaps?id=${broken.id}`);
      await page.locator('[data-source-jump="broken-card"]').click();
      assert.equal(
        await page
          .getByRole("textbox", { name: "名称", exact: true })
          .inputValue(),
        "失效卡片",
      );
      await page.screenshot({
        path: path.join(output, "broken-reference.png"),
        fullPage: true,
      });
      const block = broken.source.blocks.find((b) => b.kind === "callout");
      await page
        .getByRole("combobox", { name: "重新关联", exact: true })
        .selectOption(block.blockId);
      await page.getByRole("button", { name: "保存", exact: true }).click();
      await waitFor(
        async () =>
          (await fetchMap(broken.id)).data.root.children[0].data.sourceRef
            .blockId === block.blockId,
      );
      assert.equal(
        (await fetchMap(broken.id)).data.root.children[0].data
          .referenceNeedsRepair,
        false,
      );
      await page
        .locator('[data-source-jump="broken-card"]')
        .filter({ hasText: "↗" })
        .waitFor();
    },
  );
  await check(
    "locked article and independent map data stay inaccessible to visitors",
    async () => {
      const locked = (
        await post("/api/mindmaps/ensure", {
          source: { domain: "article", targetId: "locked-review" },
        })
      ).map;
      const guest = await browser.newContext(),
        response = await guest.request.get(`${base}/api/mindmaps/${locked.id}`);
      assert.equal(response.status(), 403);
      assert.equal(response.headers()["cache-control"], "private, no-store");
      const html = await (
        await guest.request.get(`${base}/blog/locked-review`)
      ).text();
      assert.equal(html.includes("卡片中保存的重要内容"), false);
      assert.equal(html.includes("MindMapViewer"), false);
      await guest.close();
    },
  );
  await check(
    "public map visitors can select and inspect nodes without editing or accessing AI",
    async () => {
      const guest = await browser.newContext(),
        page = await guest.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${base}/mindmaps?id=${map.id}`);
      await page.locator(".smm-node").first().waitFor();
      await page.locator(".smm-node").first().click();
      await page.getByRole("button", { name: "属性", exact: true }).click();
      await page.getByRole("textbox", { name: "名称", exact: true }).waitFor();
      assert.equal(
        await page
          .getByRole("textbox", { name: "名称", exact: true })
          .isDisabled(),
        true,
      );
      assert.equal(
        await page
          .getByRole("button", { name: "AI 生成", exact: true })
          .count(),
        0,
      );
      const before = (await fetchMap(map.id)).revision;
      await page.locator(".map-canvas").click({ position: { x: 30, y: 30 } });
      await page.keyboard.press("Tab");
      assert.equal((await fetchMap(map.id)).revision, before);
      await guest.close();
    },
  );
  await check(
    "stale saves are rejected and missing client revisions require upgrade",
    async () => {
      const saved = await fetchMap(map.id),
        one = await context.request.put(`${base}/api/mindmaps/${map.id}`, {
          data: {
            revision: saved.revision,
            version: saved.version,
            title: saved.title,
          },
        });
      assert.equal(one.status(), 200);
      const stale = await context.request.put(
        `${base}/api/mindmaps/${map.id}`,
        {
          data: {
            revision: saved.revision,
            version: saved.version,
            data: saved.data,
          },
        },
      );
      assert.equal(stale.status(), 409);
      const old = await context.request.put(`${base}/api/mindmaps/${map.id}`, {
        data: { data: saved.data },
      });
      assert.equal(old.status(), 428);
    },
  );
  await check(
    "offline edits survive reload and recover after connection returns",
    async () => {
      const offline = await context.newPage(),
        docMap = (
          await post("/api/mindmaps/ensure", {
            source: { domain: "doc", targetId: "map-doc" },
          })
        ).map;
      await offline.goto(`${base}/mindmaps?id=${docMap.id}`);
      await offline.locator(".smm-node").first().waitFor();
      await offline.getByRole("button", { name: "保存", exact: true }).click();
      await offline
        .locator(".map-save-status")
        .filter({ hasText: "已保存" })
        .waitFor();
      await offline.route("**/api/mindmaps/*", (route) =>
        route.request().method() === "PUT"
          ? route.abort("internetdisconnected")
          : route.continue(),
      );
      await offline.locator(".smm-node").first().click();
      await offline.keyboard.press("Tab");
      await offline.locator(".smm-node-edit-wrap").waitFor();
      await offline.keyboard.type("断网保留主题");
      await offline.keyboard.press("Enter");
      await waitFor(async () =>
        offline.evaluate(() =>
          Object.keys(localStorage).some(
            (key) =>
              key.startsWith("mindmap-draft:") &&
              localStorage.getItem(key).includes("断网保留主题"),
          ),
        ),
      );
      assert.equal(
        JSON.stringify((await fetchMap(docMap.id)).data).includes(
          "断网保留主题",
        ),
        false,
      );
      offline.once("dialog", (dialog) => dialog.accept());
      await offline.reload();
      await offline.locator(".smm-node").first().waitFor();
      assert.ok(
        await offline
          .locator(".smm-node")
          .filter({ hasText: "断网保留主题" })
          .count(),
      );
      await offline.unroute("**/api/mindmaps/*");
      await offline.getByRole("button", { name: "保存", exact: true }).click();
      await waitFor(async () =>
        JSON.stringify((await fetchMap(docMap.id)).data).includes(
          "断网保留主题",
        ),
      );
    },
  );
  await check(
    "clickable high fidelity prototype covers creation, reference repair and AI preview",
    async () => {
      const prototype = await context.newPage();
      await prototype.goto("http://127.0.0.1:43228");
      await prototype.locator(".toolbar select").selectOption("empty");
      assert.equal(await prototype.locator("#branches").isVisible(), false);
      await prototype.locator(".toolbar select").selectOption("broken");
      await prototype.getByText("节点属性", { exact: true }).waitFor();
      await prototype
        .getByRole("button", { name: "关闭", exact: true })
        .click();
      await prototype
        .getByRole("button", { name: "AI 生成", exact: true })
        .click();
      await prototype
        .getByRole("button", { name: "作为新分支加入", exact: true })
        .click();
      assert.ok((await prototype.locator(".node").count()) >= 4);
      await prototype.screenshot({
        path: path.join(output, "prototype-desktop.png"),
        fullPage: true,
      });
      await prototype.setViewportSize({ width: 390, height: 900 });
      await prototype.screenshot({
        path: path.join(output, "prototype-mobile.png"),
        fullPage: true,
      });
    },
  );
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    path.join(output, "browser-results.json"),
    JSON.stringify(
      { checkedAt: new Date().toISOString(), results, errors },
      null,
      2,
    ),
  );
  console.log(`BROWSER_ACCEPTANCE ${results.length} groups passed`);
} finally {
  await browser.close();
}
