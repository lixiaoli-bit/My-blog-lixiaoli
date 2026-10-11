/** Checks the real SQLite compatibility path against an isolated legacy fixture. */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
const output = path.resolve(import.meta.dirname, "../outputs/article-mindmap");
fs.mkdirSync(output, { recursive: true });
const filename = path.join(output, `legacy-upgrade-${Date.now()}.db`);
const data = JSON.stringify({
  root: {
    data: { text: "旧导图" },
    children: [
      { data: { text: "旧引用", anchorId: "para-2", snippet: "演示原文" } },
    ],
  },
  layout: "logicalStructure",
});
const legacy = new Database(filename);
legacy.exec(
  "CREATE TABLE mindmaps (id text PRIMARY KEY, title text NOT NULL, article_id text, data text NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL)",
);
legacy
  .prepare("INSERT INTO mindmaps VALUES (?, ?, ?, ?, ?, ?)")
  .run("legacy", "旧导图", null, data, 1234, 5678);
legacy.close();
process.env.DESKTOP_MODE = "1";
process.env.DATABASE_URL = `file:${filename}`;
process.env.DATABASE_URL_FALLBACK = "";
const { getPrimaryDb } = await import("../db/index.ts");
getPrimaryDb();
const upgraded = new Database(filename, { readonly: true });
assert.deepEqual(upgraded.prepare("SELECT * FROM mindmaps").get(), {
  id: "legacy",
  title: "旧导图",
  article_id: null,
  data,
  revision: 0,
  created_at: 1234,
  updated_at: 5678,
});
for (const table of [
  "mindmap_bindings",
  "source_block_indexes",
  "mindmap_backups",
]) {
  assert.ok(
    upgraded
      .prepare("SELECT name FROM sqlite_master WHERE type = ? AND name = ?")
      .get("table", table),
  );
  assert.equal(
    upgraded.prepare(`SELECT count(*) count FROM ${table}`).get().count,
    0,
  );
}
upgraded.close();
fs.writeFileSync(
  path.join(output, "sqlite-upgrade-results.json"),
  JSON.stringify(
    {
      database: filename,
      revisionAdded: true,
      tablesCreated: 3,
      legacyDataPreserved: true,
    },
    null,
    2,
  ),
);
console.log(
  "SQLITE_UPGRADE_PASS revision=0, three tables created, legacy data and timestamps preserved",
);
