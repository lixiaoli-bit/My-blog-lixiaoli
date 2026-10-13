import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { _electron } from 'playwright-core';
const root = path.resolve(import.meta.dirname, '..');
const name = process.argv[2] || 'portable-deploy-20261013';
assert.match(name, /^[a-zA-Z0-9-]+$/);
const portable = path.join(root, 'release', name);
const output = path.join(root, 'outputs/deployment-fixes-review'); fs.mkdirSync(output, { recursive: true });
const run = fs.mkdtempSync(path.join(os.tmpdir(), 'byqx-deploy-review-'));
const appData = path.join(run, 'appdata'), profile = path.join(run, 'profile'); fs.mkdirSync(profile, { recursive: true });
const port = await new Promise(resolve => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); }); });
const desktop = path.join(portable, 'resources/app/desktop');
const bootstrap = path.join(run, 'bootstrap.cjs');
fs.writeFileSync(bootstrap, `const {app,dialog}=require('electron');app.setPath('appData',${JSON.stringify(appData)});app.setPath('userData',${JSON.stringify(profile)});app.on('browser-window-created',(_,w)=>w.on('show',()=>w.hide()));global.__setupChoices=[];dialog.showMessageBox=async(_w,options)=>{global.__setupChoices.push(options.buttons);return {response:0}};const config=require(${JSON.stringify(path.join(desktop, 'config.cjs'))});const original=config.loadDesktopConfig;config.loadDesktopConfig=file=>{const result=original(file);result.config.PORT=${JSON.stringify(String(port))};require('fs').writeFileSync(file,JSON.stringify(result.config));return result};process.argv=[process.argv[0]];const main=${JSON.stringify(path.join(desktop, 'main.cjs'))};delete require.cache[require.resolve(main)];require(main);`);
const env = { ...process.env, BYQX_START_PATH: '/', BYQX_PI_AUTH_PATH: path.join(run, 'pi.json'), DATABASE_URL_FALLBACK: '', SYNC_DATABASE_URL: '', SYNC_DATABASE_URL_FALLBACK: '' }; delete env.ELECTRON_RUN_AS_NODE;
const report = { isolated: true, directory: name, cases: [], errors: [] };
const pass = name => { report.cases.push(name); console.log('PASS ' + name); };
let app;
try {
  app = await _electron.launch({ executablePath: path.join(portable, '白衣卿相.exe'), args: ['--toolchain-runner', bootstrap], env, cwd: run, timeout: 60000 });
  assert.equal(await app.evaluate(({ app }) => app.getVersion()), JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version);
  const page = await app.firstWindow(); page.setDefaultTimeout(20000); page.on('pageerror', error => { report.errors.push(error.message); console.error('PAGEERROR ' + error.message); });
  await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.webContents.setBackgroundThrottling(false); });
  await page.addInitScript(() => { document.startViewTransition = undefined; });
  await page.waitForURL(`http://127.0.0.1:${port}/**`, { timeout: 60000 });
  const base = new URL(page.url()).origin;
  assert.equal(fs.existsSync(path.join(appData, 'byqx-blog-desktop/blog-local.db')), true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(appData, 'byqx-blog-desktop/config.json'))).SYNC_DATABASE_URL, '');
  assert.deepEqual(await app.evaluate(() => global.__setupChoices[0]), ['本地使用', '查看云端部署教程']);
  const source = '## Parent\n\n' + Array.from({ length: 8 }, (_, i) => `### Group ${i}\n\n#### ${i === 3 || i === 4 ? 'Same title' : `Heading ${i}`}\n\n${('paragraph line ' + i + '\n\n').repeat(12)}`).join('\n');
  const id = await page.evaluate(async source => {
    const created = await fetch('/api/articles', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    if (!created.ok) throw Error('Fresh-install owner session cannot create an article');
    const { id } = await created.json();
    const saved = await fetch(`/api/articles/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: source }) });
    if (!saved.ok) throw Error('Source fixture save failed'); return id;
  }, source);
  pass('Fresh installation creates SQLite, offers local/cloud choices, and auto-authenticates the local owner without cloud credentials');
  await page.goto(`${base}/deploy/`); await page.locator('#desktop-cloud').waitFor();
  assert.equal(await page.locator('h1').innerText(), '把博客安放好。');
  pass('Tutorial and its local assets are bundled in the shipped desktop package');
  await page.goto(`${base}/edit/${id}`); await page.waitForFunction(() => !!window.__docInlineEditor);
  await page.locator('#doc-inline-edit').click(); await page.waitForFunction(() => document.getElementById('doc-3col')?.dataset.editing === 'true');
  if (!await page.locator('#doc-toc-list a.toc-l4').nth(2).isVisible()) {
    if (await page.locator('#doc-toc-fab').isVisible()) await page.locator('#doc-toc-fab').click();
    else await page.locator('#doc-toc-toggle').click();
  }
  for (const [level, nth] of [[4, 2], [4, 3], [4, 4], [3, 6], [4, 7]]) {
    const target = page.locator(`#doc-toc-list a.toc-l${level}`).nth(nth);
    if (!await target.isVisible()) {
      if (await page.locator('#doc-toc-fab').isVisible()) await page.locator('#doc-toc-fab').click();
      else await page.locator('#doc-toc-toggle').click();
    }
    await target.click();
    await page.waitForFunction(({ level, nth }) => document.querySelectorAll(`#doc-toc-list a.toc-l${level}`)[nth]?.classList.contains('toc-active'), { level, nth });
    await page.waitForTimeout(350); assert.equal(await target.evaluate(el => el.classList.contains('toc-active')), true);
  }
  pass('TOC clicks keep the target h3/h4 highlighted, including adjacent same-title headings and the final heading');
  const scroller = page.locator('.doc-ie-view .cm-scroller').first();
  await scroller.hover(); await page.mouse.wheel(0, -700);
  await page.waitForFunction(() => !document.querySelectorAll('#doc-toc-list a.toc-l4')[7].classList.contains('toc-active'));
  pass('Manual editor scrolling resumes viewport-driven TOC highlighting');
  await page.locator('#doc-inline-preview').click();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jT1cAAAAASUVORK5CYII=', 'base64');
  await page.route('**/api/images', route => route.fulfill({ json: { ok: true, url: '/api/images/cover-fixture' } }));
  await page.route('**/api/images/cover-fixture**', route => route.fulfill({ contentType: 'image/png', body: png }));
  await page.getByLabel('选择封面图片').setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: png });
  await page.waitForFunction(() => document.querySelector('[data-article-cover-block]')?.hidden === false);
  let stored = await page.evaluate(async id => (await (await fetch(`/api/articles/${id}`)).json()).article, id);
  assert.equal(stored.cover, '/api/images/cover-fixture'); assert.equal(stored.content, source);
  pass('Manual cover upload reaches the image endpoint and persists only the cover field (storage response is a fixture)');
  await page.locator('[data-article-cover-block] img').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '删除图片' }).click(); await page.locator('[data-confirm-ok]').click();
  await page.waitForFunction(() => document.querySelector('[data-article-cover-block]')?.hidden === true);
  stored = await page.evaluate(async id => (await (await fetch(`/api/articles/${id}`)).json()).article, id);
  assert.equal(stored.cover, null); assert.equal(stored.content, source);
  pass('Cover context deletion clears the reference and retains the complete article body');

  await page.goto(`${base}/admin/settings/appearance`);
  await page.locator('#font-ui').selectOption('system:mono'); await page.locator('#font-article').selectOption('inherit:'); await page.locator('#font-save').click();
  await page.waitForFunction(() => getComputedStyle(document.body).fontFamily.startsWith('ui-monospace'));
  await page.goto(`${base}/edit/${id}`); assert.match(await page.locator('article.prose').evaluate(el => getComputedStyle(el).fontFamily), /ui-monospace/);
  await page.goto(`${base}/admin/settings/appearance`); await page.locator('#font-article').selectOption('system:serif'); await page.locator('#font-save').click();
  await page.waitForFunction(() => document.getElementById('font-saved-hint').textContent === '已保存并应用');
  await page.goto(`${base}/edit/${id}`); assert.match(await page.locator('article.prose').evaluate(el => getComputedStyle(el).fontFamily), /Georgia/);
  assert.match(await page.locator('.neo-site-header').evaluate(el => getComputedStyle(el).fontFamily), /ui-monospace/);
  pass('Font inheritance and article override persist across pages while the global UI font remains selected');
  await page.goto(`${base}/admin/settings/appearance`); await page.locator('#font-follow-theme').click(); await page.locator('[data-confirm-ok]').click();
  await page.waitForFunction(() => !document.getElementById('site-font-overrides'));
  assert.doesNotMatch(await page.locator('body').evaluate(el => getComputedStyle(el).fontFamily), /ui-monospace/);
  pass('Restore defaults removes font overrides immediately');

  let mode = 'idle', blockGet = false, oldGetResolve, postResolve, oldGetStartedResolve;
  let oldGetStarted = new Promise(resolve => oldGetStartedResolve = resolve);
  await page.route('**/api/desktop/sync', async route => {
    if (route.request().method() === 'POST') {
      await new Promise(resolve => postResolve = resolve); mode = 'running'; return route.fulfill({ status: 202, json: { started: true, running: true } });
    }
    if (blockGet) { blockGet = false; oldGetStartedResolve(); await new Promise(resolve => oldGetResolve = resolve); return route.fulfill({ json: { cloudConfigured: true, running: false, lastReport: null, lastError: null } }); }
    const report = mode === 'done' ? { ok: true, perTable: [{ table: 'articles', pushed: 0, pulled: 0, deletedLocal: 0, deletedRemote: 0, conflicts: 0 }], warnings: [] } : null;
    return route.fulfill({ json: { cloudConfigured: true, running: mode === 'running', startedAt: Date.now() - 2000, progress: mode === 'running' ? { phase: 'read', table: 'articles', index: 0, total: 35 } : null, lastReport: report, lastError: mode === 'failed' ? 'fixture connection failed' : null } });
  });
  await page.goto(`${base}/edit/${id}`); await page.locator('[data-open-settings]').first().click();
  await page.locator('#settings-modal-nav [data-section="sync"]').click(); await page.waitForFunction(() => !document.getElementById('sync-now').disabled);
  blockGet = true; await page.evaluate(() => document.dispatchEvent(new CustomEvent('byqx:settings-section-change', { detail: { section: 'sync' } }))); await oldGetStarted;
  await page.locator('#sync-now').click();
  await page.waitForFunction(() => document.getElementById('sync-status').textContent.includes('已等待'), null, { timeout: 8000 });
  assert.match(await page.locator('#sync-status').innerText(), /正在启动同步.*已等待/);
  oldGetResolve(); await page.waitForTimeout(150); assert.match(await page.locator('#sync-status').innerText(), /正在启动/);
  assert.equal(await page.locator('#sync-now').isDisabled(), true);
  pass('Delayed sync POST gives immediate visible elapsed feedback; an older GET cannot overwrite it');
  postResolve(); await page.waitForFunction(() => document.getElementById('sync-status').textContent.includes('读取：articles'));
  mode = 'done'; await page.waitForFunction(() => document.getElementById('sync-status').textContent === '同步已完成');
  assert.equal(await page.locator('#sync-report').isVisible(), true); assert.equal(await page.locator('#sync-now').isEnabled(), true);
  mode = 'failed'; await page.locator('#settings-modal-nav [data-section="site-name"]').click(); await page.locator('#settings-modal-nav [data-section="sync"]').click();
  await page.waitForFunction(() => document.getElementById('sync-status').textContent.includes('fixture connection failed'));
  pass('Running, completed report and failure states remain visible in the settings dialog, including reopening');
  await page.keyboard.press('Escape');
  const doc = await page.evaluate(async source => {
    const post = async (url, body) => { const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); if (!response.ok) throw Error(`Document fixture failed: ${url}`); return response.json(); };
    const { category } = await post('/api/doc/categories', { name: 'Deployment review' });
    const { bundle } = await post('/api/doc/bundles', { categoryId: category.id, name: 'Synthetic book' });
    const { node } = await post('/api/doc/nodes', { bundleId: bundle.id, kind: 'article', title: 'TOC review', content: source });
    return { bundleId: bundle.id, id: node.id };
  }, source);
  await page.goto(`${base}/doc/${doc.bundleId}?article=${doc.id}`); await page.waitForFunction(() => !!window.__docInlineEditor);
  await page.locator('#doc-inline-edit').click(); await page.waitForFunction(() => document.getElementById('doc-3col')?.dataset.editing === 'true');
  if (!await page.locator('#doc-toc-list a.toc-l4').nth(3).isVisible()) {
    if (await page.locator('#doc-toc-fab').isVisible()) await page.locator('#doc-toc-fab').click();
    else await page.locator('#doc-toc-toggle').click();
  }
  for (const nth of [3, 4, 7]) {
    const target = page.locator('#doc-toc-list a.toc-l4').nth(nth);
    if (!await target.isVisible()) {
      if (await page.locator('#doc-toc-fab').isVisible()) await page.locator('#doc-toc-fab').click();
      else await page.locator('#doc-toc-toggle').click();
    }
    await target.click();
    await page.waitForFunction(nth => document.querySelectorAll('#doc-toc-list a.toc-l4')[nth]?.classList.contains('toc-active'), nth);
    await page.waitForTimeout(350); assert.equal(await target.evaluate(el => el.classList.contains('toc-active')), true);
  }
  pass('Document-book editing uses the same correct TOC highlight for duplicate h4 titles and the final heading');
  assert.deepEqual(report.errors, []); pass('No packaged browser errors');
} catch (error) { report.failure = error.stack; throw error; }
finally {
  fs.writeFileSync(path.join(output, 'latest.json'), JSON.stringify(report, null, 2));
  if (app) { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await app.close().catch(() => {}); }
}
console.log('DEPLOYMENT_FIXES_PORTABLE_OK ' + report.cases.length);
