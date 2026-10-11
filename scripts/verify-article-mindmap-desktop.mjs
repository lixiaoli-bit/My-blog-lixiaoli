/** Verify the shipped executable with a fresh database and isolated Electron profile. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { createServer } from "node:http";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { _electron } from "playwright-core";
import { reviewMarkdown } from "./mindmap-markdown-review.mjs";

const root = path.resolve(import.meta.dirname, "..");
const portable = path.resolve(
  root,
  "release",
  process.env.BYQX_DESKTOP_BUNDLE_DIR || "portable",
);
const executable = path.join(portable, "白衣卿相.exe");
const verifySource = process.env.BYQX_MAP_VERIFY_SOURCE === "1";
const hiddenReview = process.env.BYQX_DESKTOP_VERIFY_HIDDEN === "1";
const payload = verifySource ? root : path.join(portable, "resources/app");
const output = path.join(
  root,
  "outputs/desktop-mindmap-build",
  `review-${Date.now()}`,
);
const appData = path.join(output, "appdata"),
  profile = path.join(output, "profile");
fs.mkdirSync(path.join(appData, "byqx-blog-desktop"), { recursive: true });
fs.mkdirSync(profile, { recursive: true });
const report = {
  executable,
  isolated: true,
  sourceBuild: verifySource,
  hiddenReview,
  cases: [],
  errors: [],
};
const record = (label) => {
  report.cases.push(label);
  console.log("PASS", label);
};
const digest = (file) =>
  crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
for (const file of [
  "main.cjs",
  "preload.cjs",
  "server.cjs",
  "server-process.cjs",
  "local-db.cjs",
])
  assert.equal(
    digest(path.join(root, "desktop", file)),
    digest(path.join(payload, "desktop", file)),
    file,
  );
record(
  verifySource
    ? "Built server runs in an isolated Electron profile before portable replacement"
    : "Packaged desktop runtime matches the current source",
);

const databasePath = path.join(output, "test.db");
fs.copyFileSync(
  path.join(portable, "resources/desktop-assets/template.db"),
  databasePath,
);
const db = new Database(databasePath),
  now = Date.now();
const content =
  "# 桌面关联测试\n\n普通正文。\n\n> [!NOTE]- 桌面引用卡片\n> 完整卡片的重要内容。\n>\n> 第二段内容。\n\n## 标签\n\n:::tabs\n@tab 第一页\n普通内容。\n@tab 第二页\n> [!TIP]- 标签引用卡片\n> 标签内需要复用的内容。\n:::\n";
const chapterContent =
  "# 第1章 行列式\n\n" +
  Array.from(
    { length: 8 },
    (_, index) =>
      `## 1.${index + 1} 行列式章节\n\n${"完整正文内容。".repeat(180)}\n\n> [!NOTE] 章节卡片${index + 1}\n> ${"引用卡片的完整内容。".repeat(110)}\n\n`,
  ).join("");
db.prepare(
  "INSERT INTO articles (id,slug,title,type,content,summary,encrypted,created_at,updated_at) VALUES (?,?,?,?,?,?,0,?,?)",
).run(
  "desktop-map-review",
  "desktop-map-review",
  "桌面思维导图验收",
  "note",
  content,
  "隔离验收数据",
  now,
  now,
);
db.prepare(
  "INSERT INTO doc_categories (id,name,created_at,updated_at) VALUES (?,?,?,?)",
).run("desktop-map-category", "验收", now, now);
db.prepare(
  "INSERT INTO doc_bundles (id,category_id,name,created_at,updated_at) VALUES (?,?,?,?,?)",
).run("desktop-map-bundle", "desktop-map-category", "桌面文档", now, now);
db.prepare(
  "INSERT INTO doc_nodes (id,bundle_id,kind,title,content,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
).run(
  "desktop-map-doc",
  "desktop-map-bundle",
  "article",
  "桌面文档思维导图",
  chapterContent,
  now,
  now,
);
for (const table of [
  "mindmap_bindings",
  "source_block_indexes",
  "mindmap_backups",
])
  assert.ok(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
      .get(table),
    table,
  );
assert.ok(
  db
    .prepare("PRAGMA table_info(mindmaps)")
    .all()
    .some((column) => column.name === "revision"),
);
db.close();
record(
  "Shipped empty template includes source bindings, stable block indexes and revisions",
);

const port = await new Promise((resolve) => {
  const server = net.createServer();
  server.listen(0, "127.0.0.1", () => {
    const port = server.address().port;
    server.close(() => resolve(port));
  });
});
let aiReply = "explanation";
let repairCalls = 0;
const model = createServer(async (request, response) => {
  try {
    assert.equal(request.url, "/v1/chat/completions");
    let body = "";
    for await (const chunk of request) body += chunk;
    const input = JSON.parse(body),
      prompt = input.messages.at(-1).content;
    const sourcePrompt = prompt.split("\n请修正上次结果")[0];
    const blocks = JSON.parse(
      sourcePrompt.slice(sourcePrompt.indexOf("\n[") + 1),
    );
    const tree = {
      text: "AI 修复章节",
      children: blocks
        .filter((block) => ["callout", "blockquote"].includes(block.kind))
        .map((block) => ({
          text: "AI 修复卡片",
          blockId: aiReply === "invalid-source" ? "invented" : block.blockId,
        })),
    };
    if (aiReply === "nullable") {
      tree.blockId = null;
      tree.children.forEach((node) => {
        node.children = null;
      });
    }
    if (aiReply === "repair-once" && repairCalls++ === 0)
      tree.children[0].text = null;
    if (aiReply === "invalid-schema") tree.children[0].text = null;
    if (aiReply === "omitted-card") tree.children = [];
    if (aiReply === "repeated-chapter") {
      assert.ok(sourcePrompt.includes("全文标题结构"));
      assert.ok(
        sourcePrompt.includes("1.8 行列式章节"),
        "every chunk receives the complete article outline",
      );
      tree.text = "第1章 行列式";
      tree.children = tree.children.flatMap((card) => [
        { text: "第1章 行列式", children: [card] },
        {
          text: "第1章 行列式",
          children: [{ ...card, text: "重复的卡片名称" }],
        },
      ]);
    }
    const json = JSON.stringify(tree);
    const raw =
      aiReply === "multiple"
        ? json + "\n" + json
        : aiReply === "fenced"
          ? "以下是生成结果：\n```json\n" + json + "\n```\n以上是知识结构。"
          : json.padEnd(4749, " ") + "以上是生成的思维导图。";
    report.modelRequests = (report.modelRequests || 0) + 1;
    response.writeHead(200, { "content-type": "text/event-stream" });
    const event = (delta, finish_reason = null) => ({
      id: "mindmap-format-review",
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: "mindmap-format-review",
      choices: [{ index: 0, delta, finish_reason }],
    });
    response.write(`data: ${JSON.stringify(event({ role: "assistant" }))}\n\n`);
    for (let offset = 0; offset < raw.length; offset += 256)
      response.write(
        `data: ${JSON.stringify(event({ content: raw.slice(offset, offset + 256) }))}\n\n`,
      );
    response.end(
      `data: ${JSON.stringify(event({}, "stop"))}\n\ndata: [DONE]\n\n`,
    );
  } catch (error) {
    report.errors.push(String(error));
    response.writeHead(500);
    response.end("Isolated model fixture failed");
  }
});
await new Promise((resolve) => model.listen(0, "127.0.0.1", resolve));
const modelPort = model.address().port;
const configured = new Database(databasePath);
configured
  .prepare("INSERT INTO settings (key,value,updated_at) VALUES (?,?,?)")
  .run(
    "ai_config",
    JSON.stringify({
      enabled: true,
      connectionMode: "api",
      baseUrl: `http://127.0.0.1:${modelPort}/v1`,
      apiKey: "isolated-fixture",
      model: "mindmap-format-review",
      editContextTokens: 16384,
      editMaxTokens: 4096,
    }),
    now,
  );
configured.close();
report.modelBoundary =
  "Real packaged provider and UI; model replies supplied by an isolated local fixture";
const base = `http://127.0.0.1:${port}`,
  password = "isolated-desktop-mindmap-review";
// Electron's product name is Chinese; Node's HTTP client requires an ASCII header.
const requestHeaders = {
  Origin: base,
  "User-Agent": "MyBlogDesktopVerification/1.0",
};
fs.writeFileSync(
  path.join(appData, "byqx-blog-desktop/config.json"),
  JSON.stringify({
    LOCAL_DB_PATH: databasePath,
    ADMIN_PASSWORD: password,
    AUTH_SECRET: crypto.randomBytes(32).toString("hex"),
    SYNC_DATABASE_URL: "postgres://unused:unused@127.0.0.1:1/isolated",
    PORT: String(port),
  }),
);
const bootstrap = path.join(output, "bootstrap.cjs"),
  packagedMain = path.join(payload, "desktop/main.cjs");
fs.writeFileSync(
  bootstrap,
  `const electron=require('electron');const {app}=electron;${hiddenReview ? "const OriginalWindow=electron.BrowserWindow;const hiddenElectron=Object.create(electron);Object.defineProperty(hiddenElectron,'BrowserWindow',{value:class extends OriginalWindow{constructor(options){super({...options,show:false,webPreferences:{...options.webPreferences,backgroundThrottling:false}});this.show=()=>{};this.focus=()=>{};}}});const Module=require('module'),load=Module._load;Module._load=function(request,parent,isMain){return request==='electron'?hiddenElectron:load.call(this,request,parent,isMain);};" : ""}app.setPath('appData',${JSON.stringify(appData)});app.setPath('userData',${JSON.stringify(profile)});process.argv=[process.argv[0]];const main=${JSON.stringify(packagedMain)};delete require.cache[require.resolve(main)];require(main);`,
);
const env = {
  ...process.env,
  APPDATA: appData,
  BYQX_START_PATH: "/",
  DATABASE_URL_FALLBACK: "",
  SYNC_DATABASE_URL_FALLBACK: "",
  BYQX_CONFIG_PATH: path.join(output, "ai.json"),
  BYQX_PI_AUTH_PATH: path.join(output, "pi.json"),
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.BYQX_SMOKE;
delete env.BYQX_CAPTURE;
const waitFor = async (predicate) => {
  for (let i = 0; i < 100; i++) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw Error("Timed out waiting for desktop state");
};
let app;
try {
  app = await _electron.launch({
    executablePath: executable,
    args: ["--toolchain-runner", bootstrap],
    env,
    cwd: output,
    timeout: 60000,
  });
  assert.deepEqual(
    await app.evaluate(({ app }) => ({
      packaged: app.isPackaged,
      appData: app.getPath("appData"),
    })),
    { packaged: true, appData },
  );
  report.version = await app.evaluate(({ app }) => app.getVersion());
  app.on("window", (page) => {
    page.on("pageerror", (error) => report.errors.push(error.message));
    page.on("dialog", (dialog) => dialog.accept().catch(() => {}));
  });
  const article = await app.firstWindow();
  article.on("dialog", (dialog) => dialog.accept().catch(() => {}));
  await article.waitForURL(`${base}/**`, { timeout: 60000 });
  const context = app.context();
  const login = await context.request.post(`${base}/api/admin-auth/login`, {
    data: { password },
    headers: requestHeaders,
  });
  assert.ok(login.ok(), "isolated login");
  await context.addCookies(
    (await context.cookies()).map((cookie) => ({ ...cookie, secure: false })),
  );
  await article.goto(`${base}/edit/desktop-map-review`);
  await article.locator("[data-map-open]").waitFor();
  await article.locator(".map-card-tools").first().waitFor();
  assert.equal(
    await article.locator("#doc-inline-edit + [data-map-open]").count(),
    1,
  );
  assert.equal(
    await article.evaluate(() => typeof window.desktop.focusWindow),
    "function",
  );
  record(
    "Real portable executable starts outside the source directory and loads the article entry",
  );

  const popup = app.waitForEvent("window");
  await article.locator("[data-map-open]").click();
  const editor = await popup;
  await editor.evaluate(() => {
    window.__mapReviewInteractions = [];
    for (const type of ["pointerdown", "keydown", "wheel", "drop"])
      window.addEventListener(type, (event) => {
        window.__mapReviewInteractions.push({ type, target: event.target?.tagName });
      }, true);
  });
  await editor.waitForURL("**/mindmaps?**");
  await editor.locator(".smm-node").first().waitFor();
  await editor.evaluate(() => {
    window.__desktopMapReuseMarker = "keep-this-window";
  });
  const windowCount = app.windows().length;
  await article.locator("[data-map-open]").click();
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(app.windows().length, windowCount);
  assert.equal(
    await editor.evaluate(() => window.__desktopMapReuseMarker),
    "keep-this-window",
  );
  record(
    "Repeated entry clicks reuse the same native mindmap window without reloading it",
  );

  await article
    .getByRole("button", { name: "＋导图", exact: true })
    .first()
    .click();
  await article
    .locator("#article-map-message")
    .filter({ hasText: "已加入导图" })
    .waitFor();
  await editor.locator("[data-source-jump]").first().waitFor();
  const ensured = await context.request.post(`${base}/api/mindmaps/ensure`, {
    data: { source: { domain: "article", targetId: "desktop-map-review" } },
    headers: requestHeaders,
  });
  assert.ok(ensured.ok());
  const mapId = (await ensured.json()).map.id;
  const fetchMap = async () =>
    (
      await (
        await context.request.get(`${base}/api/mindmaps/${mapId}`, {
          headers: requestHeaders,
        })
      ).json()
    ).map;
  const originalRef = (await fetchMap()).data.root.children.find(
    (node) => node.data.sourceRef,
  ).data.sourceRef;
  await editor.locator(".smm-node").filter({ hasText: "桌面引用卡片" }).click();
  await editor.keyboard.press("F2");
  await editor.locator(".smm-node-edit-wrap").waitFor();
  await editor.keyboard.press("Control+a");
  await editor.keyboard.type("桌面改名后仍关联");
  await editor.keyboard.press("Enter");
  await editor.keyboard.press("Control+s");
  await waitFor(async () =>
    JSON.stringify((await fetchMap()).data).includes("桌面改名后仍关联"),
  );
  const renamed = (await fetchMap()).data.root.children.find(
    (node) => node.data.text === "桌面改名后仍关联",
  );
  assert.deepEqual(renamed.data.sourceRef, originalRef);
  record(
    "Adding a complete card, F2 rename and Ctrl+S preserve its source reference",
  );

  await editor.locator(`[data-source-jump="${renamed.data.uid}"]`).click();
  await article.waitForURL(
    `**/blog/desktop-map-review#block-${originalRef.blockId}`,
  );
  await article.locator(".map-source-highlight").waitFor();
  assert.equal(app.windows().length, windowCount);
  await article.evaluate(() => window.desktop.focusWindow());
  if (!hiddenReview) {
    await waitFor(async () =>
      (
        await app.evaluate(
          ({ BrowserWindow }) =>
            BrowserWindow.getFocusedWindow()?.webContents.getURL() || "",
        )
      ).includes("/blog/desktop-map-review"),
    );
  } else {
    report.focusBoundary = "Native foreground focus is intentionally excluded from hidden verification";
  }
  record(
    hiddenReview
      ? "Node jump reuses the article window, expands the card and highlights it (background verification)"
      : "Node jump reuses and focuses the article window, expands the card and highlights it",
  );
  await article.waitForFunction(
    () => !document.querySelector(".map-source-highlight"),
  );
  await article.evaluate((blockId) => {
    const block = document.querySelector(`[data-source-block="${blockId}"]`);
    const details = block.closest("details");
    if (details) details.open = false;
    window.scrollTo(0, 0);
  }, originalRef.blockId);
  await editor.locator(`[data-source-jump="${renamed.data.uid}"]`).click();
  await article.locator(".map-source-highlight").waitFor({ timeout: 3500 });
  assert.equal(
    await article
      .locator(`[data-source-block="${originalRef.blockId}"]`)
      .evaluate((block) => block.closest("details")?.open),
    true,
  );
  record(
    "Clicking the same source link again reopens and highlights its card without a hash change",
  );
  // Start a real Chromium drag on the article handle and relay its native DragData to the second renderer.
  const sourceCDP = await context.newCDPSession(article);
  const targetCDP = await context.newCDPSession(editor);
  await sourceCDP.send("Input.setInterceptDrags", { enabled: true });
  const dragCard = async (plainOnly = false) => {
    const handle = article.locator(".map-card-tools button[draggable]").first();
    await article.bringToFront();
    await handle.scrollIntoViewIfNeeded();
    const box = await handle.boundingBox();
    let dragTimeout;
    const intercepted = new Promise((resolve, reject) => {
      sourceCDP.once("Input.dragIntercepted", (event) => {
        clearTimeout(dragTimeout);
        resolve(event);
      });
      dragTimeout = setTimeout(
        () => reject(Error("Chromium did not start a card drag")),
        7000,
      );
    });
    const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    // Raw CDP input avoids Playwright's own drag interceptor claiming the same event.
    await sourceCDP.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      ...start,
    });
    await sourceCDP.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      button: "left",
      buttons: 1,
      clickCount: 1,
      ...start,
    });
    await sourceCDP.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      button: "left",
      buttons: 1,
      x: start.x + 40,
      y: start.y + 10,
    });
    const { data } = await intercepted;
    assert.ok(await article.locator(".map-card-dragging").count());
    assert.ok(await article.locator(".map-card-drag-preview").count());
    if (plainOnly)
      data.items = data.items.filter((item) => item.mimeType === "text/plain");
    const parent = editor
      .locator(".smm-node")
      .filter({ hasText: "桌面改名后仍关联" })
      .first();
    const parentBox = await parent.boundingBox();
    const position = {
      x: parentBox.x + parentBox.width / 2,
      y: parentBox.y + parentBox.height / 2,
    };
    await targetCDP.send("Input.dispatchDragEvent", {
      type: "dragEnter",
      ...position,
      data,
    });
    await targetCDP.send("Input.dispatchDragEvent", {
      type: "dragOver",
      ...position,
      data,
    });
    await editor.locator(".map-drop-parent").waitFor();
    assert.ok(
      (await editor.locator(".map-drop-hint").innerText()).includes(
        "桌面改名后仍关联",
      ),
    );
    if (!hiddenReview) await editor.screenshot({
      path: path.join(
        output,
        `desktop-drag-${plainOnly ? "fallback" : "native"}.png`,
      ),
    });
    await targetCDP.send("Input.dispatchDragEvent", {
      type: "drop",
      ...position,
      data,
    });
    await sourceCDP.send("Input.dispatchDragEvent", {
      type: "dragCancel",
      x: box.x,
      y: box.y,
      data,
    });
    await sourceCDP.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      button: "left",
      clickCount: 1,
      ...start,
    });
    await waitFor(async () => {
      const savedParent = (await fetchMap()).data.root.children.find(
        (node) => node.data.uid === renamed.data.uid,
      );
      return savedParent.children?.length === (plainOnly ? 2 : 1);
    });
    const savedParent = (await fetchMap()).data.root.children.find(
      (node) => node.data.uid === renamed.data.uid,
    );
    assert.equal(
      savedParent.children.at(-1).data.sourceRef.blockId,
      originalRef.blockId,
    );
    assert.equal(await editor.locator(".map-drop-parent").count(), 0);
    record(
      plainOnly
        ? "Cross-window drag with only the OS text fallback still creates a linked child under the chosen node"
        : "Chromium card drag shows preview and parent highlight and creates a linked child under the chosen node",
    );
  };
  await dragCard();
  await dragCard(true);
  const parentNode = editor
    .locator(".smm-node")
    .filter({ hasText: "桌面改名后仍关联" });
  await parentNode.click({ button: "right" });
  const contextMenu = editor.getByRole("menu", { name: "节点展开与折叠菜单" });
  await contextMenu
    .getByRole("menuitem", { name: "折叠所有", exact: true })
    .click();
  await waitFor(
    async () =>
      (await fetchMap()).data.root.children.find(
        (node) => node.data.uid === renamed.data.uid,
      ).data.expand === false,
  );
  await parentNode.click({ button: "right" });
  await contextMenu
    .getByRole("menuitem", { name: "展开所有", exact: true })
    .click();
  await waitFor(
    async () =>
      (await fetchMap()).data.root.children.find(
        (node) => node.data.uid === renamed.data.uid,
      ).data.expand === true,
  );
  await parentNode.click({ button: "right" });
  await editor.keyboard.press("Escape");
  assert.equal(await contextMenu.count(), 0);
  record(
    "Native node right-click expands and collapses the complete selected branch; Escape dismisses the menu",
  );
  await sourceCDP.send("Input.setInterceptDrags", { enabled: false });
  await sourceCDP.detach();
  await targetCDP.detach();
  const sourceInfo = (
    await context.request
      .get(
        `${base}/api/mindmaps/source?domain=article&targetId=desktop-map-review`,
        { headers: requestHeaders },
      )
      .then((r) => r.json())
  ).source;
  const tabCard = sourceInfo.blocks.find(
    (block) => block.title === "标签引用卡片",
  );
  await article.evaluate((blockId) => {
    const block = document.querySelector(`[data-source-block="${blockId}"]`);
    block.closest(".md-tabs").querySelector(".md-tabs-tab").click();
  }, tabCard.blockId);
  const extra = await context.request.post(
    `${base}/api/mindmaps/${mapId}/refs`,
    {
      headers: requestHeaders,
      data: {
        version: (await fetchMap()).version,
        revision: (await fetchMap()).revision,
        source: { domain: "article", targetId: "desktop-map-review" },
        blockId: tabCard.blockId,
        fingerprint: tabCard.fingerprint,
        text: "隐藏标签跳转",
      },
    },
  );
  assert.ok(extra.ok());
  // Refresh this isolated editor to observe the API-added test node.
  await editor.reload();
  await editor
    .locator(".smm-node")
    .filter({ hasText: "隐藏标签跳转" })
    .waitFor();
  const tabNode = (await fetchMap()).data.root.children.find(
    (node) => node.data.text === "隐藏标签跳转",
  );
  for (let i = 0; i < 3; i++) {
    for (const [node, blockId] of [
      [tabNode, tabCard.blockId],
      [renamed, originalRef.blockId],
    ]) {
      await editor.locator(`[data-source-jump="${node.data.uid}"]`).click();
      await article.waitForURL(`**#block-${blockId}`);
      await article
        .locator(`[data-source-block="${blockId}"].map-source-highlight`)
        .waitFor();
      assert.equal(await article.locator(".map-source-highlight").count(), 1);
    }
  }
  record(
    "Alternating source links repeatedly activates hidden tabs and keeps exactly the current card highlighted",
  );
  if (!hiddenReview) await editor.screenshot({ path: path.join(output, "desktop-mindmap.png") });

  const aiDialog = editor.getByRole("dialog", { name: "AI 生成预览" });
  const aiStatus = aiDialog.getByRole("status");
  for (const variant of [
    "explanation",
    "fenced",
    "nullable",
    "repair-once",
    "omitted-card",
  ]) {
    aiReply = variant;
    repairCalls = 0;
    const expectedText =
      variant === "omitted-card" ? "桌面引用卡片" : "AI 修复卡片";
    const beforeAi = (await fetchMap()).data.root.children.map(
      (node) => node.data.text,
    );
    await editor.getByRole("button", { name: "AI 生成", exact: true }).click();
    await aiStatus.filter({ hasText: "生成完成" }).waitFor();
    if (variant === "omitted-card")
      assert.ok((await aiStatus.innerText()).includes("补齐"));
    assert.ok(
      await aiDialog
        .locator(".map-ai-preview")
        .innerText()
        .then((text) => text.includes(expectedText)),
    );
    assert.deepEqual(
      (await fetchMap()).data.root.children.map((node) => node.data.text),
      beforeAi,
    );
    if (!hiddenReview) await editor.screenshot({
      path: path.join(output, `desktop-ai-${variant}.png`),
    });
    await aiDialog
      .getByRole("button", { name: "作为新分支加入", exact: true })
      .click();
    await waitFor(async () =>
      (await fetchMap()).data.root.children.some(
        (node) => node.data.text === "AI 整理",
      ),
    );
    const generated = (await fetchMap()).data.root.children.find(
      (node) => node.data.text === "AI 整理",
    );
    const generatedRefs = [];
    const collectRefs = (node) => {
      if (node.data.sourceRef) generatedRefs.push(node.data.sourceRef.blockId);
      node.children?.forEach(collectRefs);
    };
    collectRefs(generated);
    assert.ok(generatedRefs.includes(originalRef.blockId));
    assert.ok(generatedRefs.includes(tabCard.blockId));
    await editor.locator(".map-canvas").click({ position: { x: 30, y: 30 } });
    await editor.keyboard.press("Control+z");
    await waitFor(
      async () =>
        !(await fetchMap()).data.root.children.some(
          (node) => node.data.text === "AI 整理",
        ),
    );
    record(
      `Packaged AI ${variant} response reaches preview, preserves references and applies as one undoable operation`,
    );
  }
  aiReply = "multiple";
  const beforeErrors = (await fetchMap()).data;
  await editor.getByRole("button", { name: "AI 生成", exact: true }).click();
  await aiStatus.filter({ hasText: "多个导图结果" }).waitFor();
  assert.equal(await aiDialog.locator(".map-ai-preview").count(), 0);
  aiReply = "invalid-source";
  await aiDialog.getByRole("button", { name: "重新生成", exact: true }).click();
  await aiStatus.filter({ hasText: "原文内容块已变化" }).waitFor();
  assert.equal(await aiDialog.locator(".map-ai-preview").count(), 0);
  assert.deepEqual((await fetchMap()).data, beforeErrors);
  record(
    "Ambiguous model JSON and invented source IDs show readable errors without modifying saved content",
  );
  aiReply = "invalid-schema";
  const callsBeforeInvalid = report.modelRequests;
  await aiDialog.getByRole("button", { name: "重新生成", exact: true }).click();
  await aiStatus.filter({ hasText: "节点格式不正确" }).waitFor();
  assert.equal(report.modelRequests - callsBeforeInvalid, 2);
  assert.equal(await aiDialog.locator(".map-ai-preview").count(), 0);
  assert.deepEqual((await fetchMap()).data, beforeErrors);
  record(
    "Persistent invalid node structure retries once, then preserves the saved map and displays the failure",
  );
  aiReply = "explanation";
  await aiDialog.getByRole("button", { name: "重新生成", exact: true }).click();
  await aiStatus.filter({ hasText: "生成完成" }).waitFor();
  await aiDialog.getByRole("button", { name: "取消", exact: true }).click();
  record("Retry after a model-format error returns a usable preview");

  const beforeReplace = (await fetchMap()).data.root;
  await editor.getByRole("button", { name: "AI 生成", exact: true }).click();
  await aiStatus.filter({ hasText: "生成完成" }).waitFor();
  // Download is exercised through the real Electron session; cancel the native save dialog.
  await app.evaluate(({ session }) => {
    session.defaultSession.once("will-download", (event, item) => {
      globalThis.__mapBackupName = item.getFilename();
      event.preventDefault();
    });
  });
  await aiDialog
    .getByRole("button", { name: "替换当前导图（备份）", exact: true })
    .click();
  await waitFor(
    async () =>
      (await fetchMap()).data.root.children[0]?.data.aiSection === true,
  );
  const backupName = await app.evaluate(() => globalThis.__mapBackupName);
  assert.ok(backupName?.endsWith("-AI替换前备份.json"));
  await editor.locator(".map-canvas").click({ position: { x: 20, y: 20 } });
  await editor.keyboard.press("Control+z");
  await waitFor(
    async () =>
      JSON.stringify(
        (await fetchMap()).data.root.children.map((node) => node.data.text),
      ) ===
      JSON.stringify(beforeReplace.children.map((node) => node.data.text)),
  );
  record(
    "Replacing an existing diagram requests a JSON backup and preserves all previous branches in one Undo operation",
  );

  await article.goto(`${base}/doc/desktop-map-bundle?article=desktop-map-doc`);
  await article
    .locator('[data-map-open][data-map-target="desktop-map-doc"]')
    .waitFor();
  await article.locator('#doc-inline-source').click();
  await article.locator('#doc-inline-source[aria-pressed="true"]').waitFor();
  const sourceEditor = article.locator('.doc-ie-view .cm-content').first();
  await sourceEditor.waitFor();
  await sourceEditor.click();
  await article.keyboard.press('Control+Home');
  await waitFor(async () => (await sourceEditor.textContent()).includes('# 第1章 行列式'));
  assert.ok((await sourceEditor.textContent()).includes('# 第1章 行列式'));
  assert.ok(await article.locator('.doc-ie-view .cm-lineNumbers').count());
  const materialFile = path.join(output, 'document-material.json');
  await app.evaluate(({ session }, file) => {
    globalThis.__docSourceDownload = null;
    session.defaultSession.once('will-download', (_event, item) => {
      item.setSavePath(file);
      item.once('done', (_event, state) => { globalThis.__docSourceDownload = state; });
    });
  }, materialFile);
  await article.getByRole('button', { name: '下载导图素材', exact: true }).click();
  await waitFor(() => app.evaluate(() => globalThis.__docSourceDownload));
  assert.equal(await app.evaluate(() => globalThis.__docSourceDownload), 'completed');
  const material = JSON.parse(fs.readFileSync(materialFile, 'utf8'));
  assert.equal(material.markdown, chapterContent);
  assert.equal(material.source.targetId, 'desktop-map-doc');
  assert.ok(material.blocks.filter(block => block.kind === 'callout').length === 8);
  await article.locator('#doc-inline-preview').click();
  await article.locator('#doc-inline-preview[aria-pressed="true"]').waitFor();
  record('Desktop source mode shows complete Markdown and downloads real source material through the native Electron session');
  const docPopup = app.waitForEvent("window");
  await article.locator("[data-map-open]").click();
  const docMap = await docPopup;
  await docMap.waitForURL("**/mindmaps?domain=doc&targetId=desktop-map-doc");
  await docMap
    .locator(".smm-node")
    .filter({ hasText: "桌面文档思维导图" })
    .waitFor();
  record(
    "Document articles open a separate map rooted in the current document title",
  );
  const docSource = (
    await context.request
      .get(`${base}/api/mindmaps/source?domain=doc&targetId=desktop-map-doc`, {
        headers: requestHeaders,
      })
      .then((response) => response.json())
  ).source;
  const docEnsured = (
    await context.request
      .post(`${base}/api/mindmaps/ensure`, {
        headers: requestHeaders,
        data: { source: { domain: "doc", targetId: "desktop-map-doc" } },
      })
      .then((response) => response.json())
  ).map;
  const fetchDocMap = async () =>
    (
      await context.request
        .get(`${base}/api/mindmaps/${docEnsured.id}`, {
          headers: requestHeaders,
        })
        .then((response) => response.json())
    ).map;
  aiReply = "repeated-chapter";
  const beforeChapterCalls = report.modelRequests;
  await docMap.getByRole("button", { name: "AI 生成", exact: true }).click();
  const docDialog = docMap.getByRole("dialog", { name: "AI 生成预览" });
  await docDialog.getByRole("status").filter({ hasText: "生成完成" }).waitFor();
  assert.ok(
    report.modelRequests - beforeChapterCalls > 1,
    "article spans multiple model chunks",
  );
  assert.equal(
    await docDialog.locator(".map-ai-preview li").evaluateAll(
      (items) =>
        items.filter(
          (item) =>
            [...item.childNodes]
              .filter((node) => node.nodeType === 3)
              .map((node) => node.textContent)
              .join("")
              .trim() === "第1章 行列式",
        ).length,
    ),
    1,
  );
  await docDialog
    .getByRole("button", { name: "作为新分支加入", exact: true })
    .click();
  await waitFor(
    async () => (await fetchDocMap()).data.root.children.length === 1,
  );
  const generatedChapter = (await fetchDocMap()).data.root.children[0];
  assert.equal(generatedChapter.data.text, "第1章 行列式");
  assert.equal(generatedChapter.children.length, 8);
  const sourceCounts = new Map();
  const collect = (node) => {
    if (node.data.sourceRef) {
      const id = node.data.sourceRef.blockId;
      sourceCounts.set(id, (sourceCounts.get(id) || 0) + 1);
    }
    node.children?.forEach(collect);
  };
  collect(generatedChapter);
  for (const block of docSource.blocks.filter((block) =>
    ["heading", "callout", "blockquote"].includes(block.kind),
  ))
    assert.equal(sourceCounts.get(block.blockId), 1);
  record(
    "Complete-article outline spans multiple AI requests and yields one chapter, eight original sections and one node per card",
  );

  const assertCanvas = async (page) => {
    const geometry = await page.evaluate(() => {
      const canvas = document.querySelector(".map-canvas"),
        rect = canvas.getBoundingClientRect();
      const boxes = [...canvas.querySelectorAll(".smm-node")]
        .map((node) => node.getBoundingClientRect())
        .filter((box) => box.width > 0);
      return {
        overflow: getComputedStyle(canvas).overflow,
        contained: boxes.every(
          (box) =>
            box.left >= rect.left - 1 &&
            box.right <= rect.right + 1 &&
            box.top >= rect.top - 1 &&
            box.bottom <= rect.bottom + 1,
        ),
      };
    });
    assert.equal(geometry.overflow, "hidden");
    assert.ok(
      geometry.contained,
      "all visible nodes fit the dedicated canvas after applying AI",
    );
  };
  await assertCanvas(docMap);
  if (!hiddenReview) await docMap.screenshot({
    path: path.join(output, "desktop-canonical-chapter.png"),
  });
  // Finish the UI save queue before simulating another writer's view update.
  await docMap.getByRole("button", { name: "保存", exact: true }).click();
  await docMap
    .locator('[role="status"]')
    .filter({ hasText: "已保存" })
    .waitFor();
  const docFull = await fetchDocMap();
  docFull.data.view = {
    state: { scale: 2, x: -1500, y: -2000, sx: 0, sy: 0 },
    transform: { scaleX: 2, scaleY: 2, translateX: -1500, translateY: -2000 },
  };
  const repositioned = await context.request.put(
    `${base}/api/mindmaps/${docFull.id}`,
    {
      headers: requestHeaders,
      data: {
        revision: docFull.revision,
        version: docFull.version,
        data: docFull.data,
        title: docFull.title,
      },
    },
  );
  assert.ok(repositioned.ok());
  await docMap.reload({ waitUntil: "domcontentloaded" });
  await docMap
    .locator(".smm-node")
    .filter({ hasText: "第1章 行列式" })
    .waitFor();
  await assertCanvas(docMap);
  const nodeBounds = await docMap
    .locator(".smm-node")
    .filter({ hasText: "第1章 行列式" })
    .boundingBox();
  await docMap.mouse.move(nodeBounds.x - 12, nodeBounds.y + 12);
  await docMap.mouse.down();
  await docMap.mouse.move(nodeBounds.x - 12, 15, { steps: 6 });
  await docMap.mouse.up();
  assert.ok(
    await docMap
      .getByRole("button", { name: "AI 生成", exact: true })
      .evaluate((button) => {
        const r = button.getBoundingClientRect();
        return button.contains(
          document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2),
        );
      }),
  );
  assert.ok(
    await docMap
      .getByRole("button", { name: "适应", exact: true })
      .evaluate((button) => {
        const r = button.getBoundingClientRect();
        return button.contains(
          document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2),
        );
      }),
  );
  record(
    "Oversized or displaced saved views fit the canvas on reopen; panning cannot paint over header or footer controls",
  );
  const launchLog = fs.readFileSync(
    path.join(appData, "byqx-blog-desktop/logs/launch.log"),
    "utf8",
  );
  assert.ok(launchLog.includes("[mindmap-ai]"));
  assert.ok(launchLog.includes('"stage":"repair"'));
  assert.ok(launchLog.includes("children.0.text"));
  assert.ok(launchLog.includes('"stage":"error"'));
  record(
    "AI validation failures and repair paths are persisted in the desktop launch log without article content",
  );
  assert.deepEqual(report.errors, []);
  await reviewMarkdown({
    context,
    page: editor,
    base,
    output: path.join(output, "markdown"),
    captureScreenshots: !hiddenReview,
    record,
    source: { domain: "article", targetId: "desktop-map-review" },
    sourcePage: article,
    saveExport: async ({ file, action }) => {
      // Electron uses its native DownloadItem rather than a browser-context Download.
      await app.evaluate(({ session }, file) => {
        globalThis.__mapMarkdownExport = null;
        session.defaultSession.once("will-download", (_event, item) => {
          item.setSavePath(file);
          item.once("done", (_event, state) => {
            globalThis.__mapMarkdownExport = { state, filename: item.getFilename() };
          });
        });
      }, file);
      await action();
      await waitFor(() => app.evaluate(() => globalThis.__mapMarkdownExport));
      const result = await app.evaluate(() => globalThis.__mapMarkdownExport);
      assert.equal(result.state, "completed");
      assert.ok(fs.existsSync(file));
    },
  });
  assert.deepEqual(report.errors, []);
  console.log("ARTICLE_MINDMAP_PORTABLE_OK", report.cases.length);
} catch (error) {
  for (const page of app?.windows() || []) {
    if (!page.url().includes("/mindmaps")) continue;
    const diagnostics = await page.evaluate(() => ({
      interactions: window.__mapReviewInteractions,
      drafts: Object.fromEntries(Object.keys(localStorage)
        .filter((key) => key.startsWith("mindmap-draft:"))
        .map((key) => [key, JSON.parse(localStorage.getItem(key))])),
    })).catch(() => null);
    fs.writeFileSync(path.join(output, "failure-drafts.json"), JSON.stringify(diagnostics, null, 2));
  }
  for (const [index, page] of (hiddenReview ? [] : app?.windows() || []).entries())
    await page
      .screenshot({
        path: path.join(output, `failure-${index}.png`),
        timeout: 5000,
      })
      .catch(() => {});
  report.errors.push(error.stack);
  throw error;
} finally {
  // Destroy only this isolated review's windows; avoid CDP's beforeunload teardown race.
  await app
    ?.evaluate(({ BrowserWindow, app }) => {
      for (const window of BrowserWindow.getAllWindows()) window.destroy();
      app.quit();
    })
    .catch(() => {});
  await app?.close().catch(() => {});
  await new Promise((resolve) => model.close(resolve));
  report.checkedAt = new Date().toISOString();
  fs.writeFileSync(
    path.join(output, "report.json"),
    JSON.stringify(report, null, 2),
  );
  fs.writeFileSync(
    path.join(root, "outputs/desktop-mindmap-build/latest-review.json"),
    JSON.stringify({ output, ...report }, null, 2),
  );
}
