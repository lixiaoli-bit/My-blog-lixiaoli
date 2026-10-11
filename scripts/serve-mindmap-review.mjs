/** Isolated local acceptance server. Never opens the user's business database. */
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import Database from "better-sqlite3";
import { createServer } from "node:http";
const root = path.resolve(import.meta.dirname, ".."),
  output = path.join(root, "outputs", "article-mindmap");
fs.mkdirSync(output, { recursive: true });
const prototype = createServer((_request, response) => {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(
    fs.readFileSync(path.join(root, "docs/prototypes/article-mindmap.html")),
  );
});
await new Promise((resolve, reject) => {
  prototype.once("error", reject);
  prototype.listen(43228, "127.0.0.1", resolve);
});
const databasePath = path.join(output, `test-${Date.now()}.db`),
  config = path.join(output, "schema.config.ts");
fs.writeFileSync(
  config,
  `export default { dialect: 'sqlite', schema: './db/schema.sqlite.ts', dbCredentials: { url: ${JSON.stringify(databasePath.replaceAll("\\", "/"))} } };`,
);
const result = spawnSync(
  process.execPath,
  [
    path.join(root, "node_modules/drizzle-kit/bin.cjs"),
    "push",
    `--config=${config}`,
    "--force",
  ],
  {
    cwd: root,
    env: {
      ...process.env,
      DATABASE_URL: `file:${databasePath}`,
      DATABASE_URL_FALLBACK: "",
    },
    encoding: "utf8",
  },
);
if (result.status !== 0) throw new Error(result.stderr || result.stdout);
const db = new Database(databasePath),
  now = Date.now();
const content =
  "# 基础概念\n\n这是需要复用的段落。\n\n> [!NOTE]- 引用卡片\n> 卡片中保存的重要内容。\n>\n> 第二段完整内容。\n\n## 实践\n\n:::tabs\n@tab 第一页\n普通内容\n@tab 第二页\n> [!TIP]+ 标签页卡片\n> 标签内重点内容。\n:::\n";
for (const [id, title, encrypted] of [
  ["map-review", "线性表与链表", 0],
  ["locked-review", "加密文章", 1],
]) {
  db.prepare(
    "INSERT INTO articles (id, slug, title, type, content, summary, encrypted, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    id,
    id,
    title,
    "note",
    content,
    "思维导图验收示例",
    encrypted,
    now,
    now,
  );
}
db.prepare(
  "INSERT INTO doc_categories (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
).run("map-category", "导图验收", now, now);
db.prepare(
  "INSERT INTO doc_bundles (id, category_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
).run("map-bundle", "map-category", "知识文档", now, now);
for (const [id, title] of [
  ["map-doc", "文档引用与复用"],
  ["map-doc-two", "另一篇文档"],
])
  db.prepare(
    "INSERT INTO doc_nodes (id, bundle_id, kind, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(id, "map-bundle", "article", title, content, now, now);
db.close();
const port = 43227,
  log = fs.openSync(path.join(output, "server.log"), "a");
const child = spawn(
  process.execPath,
  [path.join(root, "dist/server/entry.mjs")],
  {
    cwd: root,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      DATABASE_URL: `file:${databasePath}`,
      DATABASE_URL_FALLBACK: "",
      SYNC_DATABASE_URL: "",
      SYNC_DATABASE_URL_FALLBACK: "",
      ADMIN_PASSWORD: "mindmap-review-local",
      TOP_ADMIN_PASSWORD: "mindmap-review-local",
      AUTH_SECRET: randomBytes(32).toString("hex"),
      DESKTOP_MODE: "1",
      SITE_URL: `http://127.0.0.1:${port}`,
    },
    stdio: ["ignore", log, log],
  },
);
fs.writeFileSync(
  path.join(output, "server.json"),
  JSON.stringify({ pid: child.pid, port, databasePath }, null, 2),
);
child.on("exit", (code) => {
  prototype.close();
  fs.closeSync(log);
  process.exit(code || 0);
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill());
for (let i = 0; i < 50; i++) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/ui-style`, {
      signal: AbortSignal.timeout(1000),
    });
    if (response.ok) {
      console.log(`MINDMAP_REVIEW_READY http://127.0.0.1:${port}`);
      break;
    }
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (i === 49) {
    child.kill();
    throw new Error("验收服务启动失败");
  }
}
