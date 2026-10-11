/** Source mode and skill JSON acceptance against the isolated review server. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const base = 'http://127.0.0.1:43227', output = path.resolve('outputs/doc-source');
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, extraHTTPHeaders: { Origin: base } });
const page = await context.newPage(), cases = [], errors = [];
context.on('page', (page) => page.on('pageerror', error => errors.push(error.stack)));
page.on('pageerror', error => errors.push(error.stack));
const record = label => { cases.push(label); console.log('PASS', label); };
const wait = async predicate => { for (let i = 0; i < 120; i++) { if (await predicate()) return; await page.waitForTimeout(100); } throw Error('State timeout'); };
try {
  assert.ok((await context.request.post(`${base}/api/admin-auth/login`, { data: { password: 'mindmap-review-local' } })).ok());
  await context.addCookies((await context.cookies()).map(cookie => ({ ...cookie, secure: false })));
  await page.goto(`${base}/doc/map-bundle?article=map-doc`);
  await page.locator('#doc-inline-source').click();
  await page.locator('#doc-inline-source[aria-pressed="true"]').waitFor();
  const editor = page.locator('.doc-ie-view .cm-content').first();
  await editor.waitFor();
  await page.locator('#doc-inline-source[aria-pressed="true"]').waitFor();
  assert.ok((await editor.textContent()).includes('[!NOTE]'));
  assert.ok((await editor.textContent()).includes(':::tabs'));
  assert.ok(await page.locator('.doc-ie-view .cm-lineNumbers').count());
  await page.screenshot({ path: path.join(output, 'source-light.png') });
  record('Source mode shows complete Markdown markers and line numbers instead of preview widgets');

  await editor.click();
  await page.keyboard.press('Control+End');
  const addition = '\n\n## 源码模式验证\n\n> [!TIP]+ 定义 T-01｜**可逆条件** $|A|\\ne0$\n> 完整条件与解释保留在文章中。\n';
  await page.keyboard.insertText(addition);
  await page.locator('#doc-inline-edit').click();
  await page.locator('#doc-inline-edit[aria-pressed="true"]').waitFor();
  assert.equal(await page.locator('.doc-ie-view .cm-lineNumbers').count(), 0);
  await page.locator('#doc-inline-source').click();
  assert.ok((await editor.textContent()).includes('源码模式验证'));
  await editor.click();
  await page.keyboard.press('Control+z');
  await wait(async () => !(await editor.textContent()).includes('源码模式验证'));
  await page.keyboard.press('Control+y');
  await wait(async () => (await editor.textContent()).includes('源码模式验证'));
  await page.locator('#doc-inline-preview').click();
  await page.locator('#doc-inline-preview[aria-pressed="true"]').waitFor();
  await wait(async () => (await (await context.request.get(`${base}/api/doc/nodes/map-doc`)).json()).node.content.includes('源码模式验证'));
  await page.locator('main article.prose h2').filter({ hasText: '源码模式验证' }).waitFor();
  record('Visual/source switching preserves edits and undo history; preview waits for saved content');

  await page.locator('#doc-inline-source').click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载导图素材', exact: true }).click();
  const download = await pending, materialFile = path.join(output, 'source-material.json');
  await download.saveAs(materialFile);
  const material = JSON.parse(fs.readFileSync(materialFile, 'utf8'));
  assert.equal(material.format, 'byqx-mindmap-source');
  assert.equal(material.source.domain, 'doc');
  assert.equal(material.source.targetId, 'map-doc');
  const savedNode = (await (await context.request.get(`${base}/api/doc/nodes/map-doc`)).json()).node;
  assert.equal(material.markdown, savedNode.content);
  assert.ok(material.blocks.some(block => block.kind === 'callout' && block.title.includes('可逆条件')));
  const source = (await (await context.request.get(`${base}/api/mindmaps/source?domain=doc&targetId=map-doc`)).json()).source;
  assert.equal(material.source.contentHash, source.contentHash);
  assert.deepEqual(material.blocks, source.blocks);
  record('Downloaded material contains the saved Markdown and real current article block IDs/fingerprints');

  const map = { layout: 'logicalStructure', root: { data: { uid: 'skill-root', text: material.source.title, expand: true }, children: [] } };
  const stack = [{ level: 0, node: map.root }];
  for (const block of material.blocks) {
    if (!['heading', 'callout', 'blockquote'].includes(block.kind)) continue;
    const ref = { domain: material.source.domain, targetId: material.source.targetId, blockId: block.blockId, fingerprint: block.fingerprint, quote: block.text.slice(0, 500) };
    const node = { data: { uid: `skill-${block.blockId}`, text: block.title, sourceRef: ref, expand: true }, children: [] };
    if (block.kind === 'heading') {
      while (stack.length > 1 && stack.at(-1).level >= block.level) stack.pop();
      stack.at(-1).node.children.push(node);
      stack.push({ level: block.level, node });
    } else {
      if (block.title.includes('可逆条件')) node.data.text = '**T-01**｜可逆条件 $|A|\\ne0$';
      stack.at(-1).node.children.push(node);
    }
  }
  const mapFile = path.join(output, 'skill-example.json');
  fs.writeFileSync(mapFile, JSON.stringify(map, null, 2));
  const validator = 'C:/Users/a3129/.codex/skills/my-blog-mindmap-json/scripts/validate_json.mjs';
  const valid = spawnSync(process.execPath, [validator, mapFile, materialFile], { encoding: 'utf8' });
  assert.equal(valid.status, 0, valid.stderr);
  fs.writeFileSync(path.join(output, 'skill-validation.log'), valid.stdout + valid.stderr);
  for (const corrupt of ['wrapper', 'uid', 'source', 'children']) {
    const invalid = structuredClone(map);
    if (corrupt === 'uid') invalid.root.children[0].data.uid = invalid.root.data.uid;
    if (corrupt === 'source') invalid.root.children[0].data.sourceRef.blockId = 'invented-id';
    if (corrupt === 'children') invalid.root.children = null;
    const badFile = path.join(output, `invalid-${corrupt}.json`);
    fs.writeFileSync(badFile, JSON.stringify(corrupt === 'wrapper' ? { map: invalid } : invalid));
    assert.equal(spawnSync(process.execPath, [validator, badFile, materialFile]).status, 1);
  }
  record('Skill validator accepts importable linked JSON and rejects API wrappers, duplicate UIDs, invented sources and null children');

  await page.locator('#doc-inline-preview').click();
  await page.locator('#doc-inline-preview[aria-pressed="true"]').waitFor();
  const ensured = (await (await context.request.post(`${base}/api/mindmaps/ensure`, { data: { source: { domain: 'doc', targetId: 'map-doc' } } })).json()).map;
  const canvas = await context.newPage();
  await canvas.goto(`${base}/mindmaps?id=${ensured.id}`);
  await canvas.locator('.smm-node').first().waitFor();
  await canvas.locator('.map-header summary').filter({ hasText: '导出' }).click();
  const backup = canvas.waitForEvent('download');
  await canvas.locator('input[type=file]').setInputFiles(mapFile);
  assert.ok((await backup).suggestedFilename().endsWith('-导入前备份.json'));
  await canvas.locator('.smm-node .map-node-markdown .katex').first().waitFor();
  await wait(async () => (await (await context.request.get(`${base}/api/mindmaps/${ensured.id}`)).json()).map.data.root.data.uid === 'skill-root');
  await canvas.locator('.map-header summary').filter({ hasText: '导出' }).click();
  await canvas.getByRole('button', { name: '适应', exact: true }).click();
  await canvas.getByRole('status').filter({ hasText: '已保存' }).waitFor();
  await canvas.screenshot({ path: path.join(output, 'skill-imported.png') });
  const target = material.blocks.find(block => block.title.includes('可逆条件'));
  await canvas.locator(`[data-source-jump="skill-${target.blockId}"]`).click();
  await page.waitForURL(`**#block-${target.blockId}`);
  await page.locator(`[data-source-block="${target.blockId}"]`).waitFor();
  record('Generated JSON imports through the real UI with a backup, renders formula names and jumps to its original document card');

  await page.locator('#doc-inline-source').click();
  await page.locator('#doc-inline-source[aria-pressed="true"]').waitFor();
  await page.setViewportSize({ width: 390, height: 900 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: path.join(output, 'source-mobile.png') });
  await page.locator('#doc-inline-preview').click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/doc/map-bundle?article=map-doc-two`);
  await page.locator('#doc-inline-source').click();
  await page.locator('.doc-ie-view .cm-content').first().waitFor();
  assert.ok(!(await page.locator('.doc-ie-view .cm-content').first().textContent()).includes('源码模式验证'));
  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  await guestPage.goto(`${base}/doc/map-bundle?article=map-doc`);
  assert.equal(await guestPage.locator('#doc-inline-source,#doc-inline-preview,#doc-inline-edit').count(), 0);
  await guest.close();
  record('Source mode fits mobile, binds the current document after switching and stays behind editing permissions');
  assert.deepEqual(errors, []);
} catch (cause) { errors.push(cause.stack); await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {}); throw cause; }
finally { fs.writeFileSync(path.join(output, 'browser.json'), JSON.stringify({ cases, errors }, null, 2)); await browser.close(); }
