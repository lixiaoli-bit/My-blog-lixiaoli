import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

export async function reviewMarkdown({
  context,
  page,
  base,
  output,
  record,
  source,
  sourcePage,
  saveExport,
  captureScreenshots = true,
}) {
  fs.mkdirSync(output, { recursive: true });
  const headers = { Origin: base, "User-Agent": "Mindmap-Markdown-Review" };
  const names = {
    math: "**行列式** $\\frac{a^2}{b}+\\sqrt{x}$\n\n==关键公式=={.error}",
    callout:
      "> [!NOTE]- 卡片名称 $a^2$\n> **这段是手动写入名称的内容**\n> 第二行内容",
    tabs: ":::tabs\n@tab 第一项\n第一项内容\n@tab 第二项\n第二项内容更长\n\n- 要点一\n- 要点二\n:::",
    table:
      "| 名称 | 公式 |\n|---|---|\n| 系数 | $a^2$ |\n\n```js\nconst value = 2;\n```",
    highlight: "==重点=={.tip}",
  };
  const created = await context.request.post(`${base}/api/mindmaps`, {
    headers,
    data: {
      title: "Markdown 名称验收",
      data: {
        layout: "logicalStructure",
        root: {
          data: { uid: "md-root", text: "Markdown 节点" },
          children: Object.entries(names).map(([uid, text]) => ({
            data: { uid, text },
          })),
        },
      },
    },
  });
  assert.ok(created.ok(), await created.text());
  const { map } = await created.json();
  const saved = async () =>
    (
      await (
        await context.request.get(`${base}/api/mindmaps/${map.id}`, { headers })
      ).json()
    ).map;
  await page.goto(`${base}/mindmaps?id=${map.id}`);
  await page
    .locator('.smm-node [data-map-node="math"] .katex')
    .first()
    .waitFor();
  await page
    .locator('.smm-node [data-map-node="highlight"] .mark-tip')
    .waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(200);
  assert.equal(
    await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }),
    false,
    "automatic Markdown sizing must not mark a clean map as an unsaved draft",
  );
  await page.getByRole("button", { name: "适应", exact: true }).click();
  await page.evaluate(() => document.fonts.ready);
  assert.equal(
    await page.locator('.smm-node [data-map-node="math"] strong').textContent(),
    "行列式",
  );
  assert.equal(
    await page.locator('.smm-node [data-map-node="table"] table').count(),
    1,
  );
  assert.equal(
    await page
      .locator('.smm-node [data-map-node="table"] pre code')
      .textContent(),
    "const value = 2;\n",
  );
  record(
    "Node names render the article Markdown pipeline, KaTeX, callouts, tabs, tables, code and semantic highlights",
  );

  const beforeHeight = await page
    .locator('.smm-node [data-map-node="callout"]')
    .evaluate((el) => el.closest("foreignObject").getAttribute("height"));
  await page.locator('.smm-node [data-map-node="callout"] summary').click();
  await page.waitForFunction(
    (height) =>
      Number(
        document
          .querySelector('.smm-node [data-map-node="callout"]')
          ?.closest("foreignObject")
          ?.getAttribute("height"),
      ) > Number(height),
    beforeHeight,
  );
  const tabs = page.locator('.smm-node [data-map-node="tabs"]');
  await tabs.getByRole("tab", { name: "第二项" }).click();
  await tabs
    .getByRole("tabpanel")
    .filter({ hasText: "第二项内容更长" })
    .waitFor();
  await page.waitForTimeout(200);
  assert.equal(
    await tabs
      .getByRole("tab", { name: "第二项" })
      .getAttribute("aria-selected"),
    "true",
  );
  await tabs.getByRole("tab", { name: "第二项" }).focus();
  await page.keyboard.press("ArrowLeft");
  assert.equal(
    await tabs
      .getByRole("tab", { name: "第一项" })
      .getAttribute("aria-selected"),
    "true",
  );
  record(
    "Markdown controls keep working after node resizing and support keyboard tab navigation",
  );

  await page.locator('.smm-node [data-map-node="math"]').click();
  await page.keyboard.press("F2");
  const input = page.getByRole("textbox", { name: "节点名称源码" });
  await input.waitFor();
  assert.equal(await input.inputValue(), names.math);
  const updated = "**改名后的公式** $x^3$\n\n==新重点==";
  await input.fill(updated);
  await page.keyboard.press("Control+Enter");
  await page
    .locator('.smm-node [data-map-node="math"] strong')
    .filter({ hasText: "改名后的公式" })
    .waitFor();
  await page.keyboard.press("Control+z");
  await page
    .locator('.smm-node [data-map-node="math"] strong')
    .filter({ hasText: "行列式" })
    .waitFor();
  await page.keyboard.press("Control+Shift+z");
  await page
    .locator('.smm-node [data-map-node="math"] strong')
    .filter({ hasText: "改名后的公式" })
    .waitFor();
  await page.locator('.smm-node [data-map-node="math"]').dblclick();
  await input.waitFor();
  await input.fill("**取消的名称**");
  await page.keyboard.press("Escape");
  assert.equal(
    await page.locator('.smm-node [data-map-node="math"] strong').textContent(),
    "改名后的公式",
  );
  await page.keyboard.press("Control+s");
  for (let attempt = 0; attempt < 80; attempt++) {
    if ((await saved()).data.root.children[0].data.text === updated) break;
    await page.waitForTimeout(100);
  }
  assert.equal((await saved()).data.root.children[0].data.text, updated);
  assert.ok(!JSON.stringify((await saved()).data).includes("<strong>"));
  record(
    "F2 and double-click edit Markdown source; save, undo, redo and cancel preserve raw node names",
  );

  await page.reload();
  await page
    .locator('.smm-node [data-map-node="math"] strong')
    .filter({ hasText: "改名后的公式" })
    .waitFor();
  await page.getByRole("button", { name: "适应", exact: true }).click();
  if (captureScreenshots) await page.screenshot({ path: path.join(output, "markdown-light.png") });
  for (const type of ["svg", "png"]) {
    const menu = page
      .locator("details")
      .filter({ has: page.locator("summary").filter({ hasText: "导出" }) })
      .first();
    if (!(await menu.evaluate((element) => element.open)))
      await menu.locator("summary").click();
    const file = path.join(output, `markdown.${type}`);
    const action = () => page
      .getByRole("button", { name: type.toUpperCase(), exact: true })
      .click();
    if (saveExport) await saveExport({ file, action });
    else {
      const downloading = page.waitForEvent("download");
      await action();
      await (await downloading).saveAs(file);
    }
    if (type === "svg") {
      const svg = fs.readFileSync(file, "utf8");
      assert.ok(svg.includes("foreignObject"));
      assert.ok(svg.includes("改名后的公式"));
      assert.ok(svg.includes("font-family"));
      assert.ok(
        svg.includes("data:font/woff2") ||
          svg.includes("data:application/font-woff2") ||
          svg.includes("data:application/octet-stream"),
      );
    } else {
      const metadata = await sharp(file).metadata();
      assert.ok(metadata.width > 100 && metadata.height > 100);
      const { data } = await sharp(file)
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      let ink = 0;
      for (let i = 0; i < data.length; i += 3)
        if (data[i] < 100 && data[i + 1] < 100 && data[i + 2] < 100) ink++;
      assert.ok(ink > 200, "export contains visible content");
    }
  }
  record(
    "Reload restores Markdown names; SVG embeds formula fonts and PNG exports visible content",
  );

  await page.locator("summary").filter({ hasText: "导出" }).first().click();
  await page.getByRole("button", { name: "明暗", exact: true }).click();
  await page.locator('.smm-node [data-map-node="math"] strong').waitFor();
  if (captureScreenshots) await page.screenshot({ path: path.join(output, "markdown-dark.png") });
  await page.setViewportSize({ width: 390, height: 900 });
  await page.getByRole("button", { name: "适应", exact: true }).click();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  if (captureScreenshots) await page.screenshot({ path: path.join(output, "markdown-mobile.png") });
  record(
    "Markdown cards keep the existing light/dark style and fit a 390px canvas without page overflow",
  );
  if (source && sourcePage) {
    const ensured = await context.request.post(`${base}/api/mindmaps/ensure`, {
      headers,
      data: { source },
    });
    assert.ok(ensured.ok());
    const linked = (await ensured.json()).map;
    const block = linked.source.blocks.find(
      (block) => block.kind === "callout",
    );
    const added = await context.request.post(
      `${base}/api/mindmaps/${linked.id}/refs`,
      {
        headers,
        data: {
          source,
          blockId: block.blockId,
          revision: linked.revision,
          version: linked.version,
          text: "**Markdown 引用名称** $a^2$",
        },
      },
    );
    assert.ok(added.ok(), await added.text());
    const refNode = (await added.json()).map.data.root.children.at(-1);
    await sourcePage.goto(`${base}${linked.source.url}`);
    await sourcePage
      .locator(`[data-source-block="${block.blockId}"]`)
      .waitFor({ state: "attached" });
    await page.setViewportSize({ width: 1440, height: 950 });
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.locator(".map-save-status").filter({ hasText: "已保存" }).waitFor();
    await page.goto(`${base}/mindmaps?id=${linked.id}`);
    await page
      .locator(`.smm-node [data-map-node="${refNode.data.uid}"] .katex`)
      .first()
      .waitFor();
    await page.getByRole("button", { name: "适应", exact: true }).click();
    await page
      .locator(`.smm-node [data-map-node="${refNode.data.uid}"]`)
      .click();
    await page.keyboard.press("F2");
    await page
      .getByRole("textbox", { name: "节点名称源码" })
      .fill("**引用改名后** $b^3$");
    await page.keyboard.press("Control+Enter");
    await page
      .locator(`.smm-node [data-map-node="${refNode.data.uid}"] strong`)
      .filter({ hasText: "引用改名后" })
      .waitFor();
    await page.locator(`[data-source-jump="${refNode.data.uid}"]`).click();
    await sourcePage.waitForURL(`**#block-${block.blockId}`);
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page
      .locator('[role="status"]')
      .filter({ hasText: "已保存" })
      .waitFor();
    const final = (
      await (
        await context.request.get(`${base}/api/mindmaps/${linked.id}`, {
          headers,
        })
      ).json()
    ).map;
    assert.deepEqual(
      final.data.root.children.find(
        (node) => node.data.uid === refNode.data.uid,
      ).data.sourceRef,
      refNode.data.sourceRef,
    );
    record(
      "Markdown reference names remain linked after source editing and jump to their original article card",
    );
  }
}
