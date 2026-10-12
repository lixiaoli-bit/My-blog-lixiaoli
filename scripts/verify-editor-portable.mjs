/** Verify a newly built portable package using synthetic data and a separate Electron profile. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import crypto from 'node:crypto';
import { _electron } from 'playwright-core';

const root = path.resolve(import.meta.dirname, '..');
const directory = process.argv[2];
if (!directory || !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,63}$/.test(directory)) throw Error('Pass a portable directory name inside release');
const portable = path.join(root, 'release', directory);
const payload = path.join(portable, 'resources/app');
const output = path.join(root, 'outputs/portable-editor-review');
fs.mkdirSync(output, { recursive: true });
const run = fs.mkdtempSync(path.join(os.tmpdir(), 'byqx-editor-review-'));
const appData = path.join(run, 'appdata'), profile = path.join(run, 'profile');
fs.mkdirSync(path.join(appData, 'byqx-blog-desktop'), { recursive: true });
fs.mkdirSync(profile, { recursive: true });
const port = await new Promise(resolve => {
  const server = net.createServer();
  server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); });
});
const db = path.join(run, 'fixture.db');
fs.copyFileSync(path.join(portable, 'resources/desktop-assets/template.db'), db);
fs.writeFileSync(path.join(appData, 'byqx-blog-desktop/config.json'), JSON.stringify({
  LOCAL_DB_PATH: db, ADMIN_PASSWORD: 'editor-fixture', AUTH_SECRET: 'isolated-editor-fixture',
  SYNC_DATABASE_URL: 'postgresql://fixture:fixture@127.0.0.1:1/fixture', PORT: String(port),
}));
const bootstrap = path.join(run, 'bootstrap.cjs');
fs.writeFileSync(bootstrap, `const {app}=require('electron');app.setPath('appData',${JSON.stringify(appData)});app.setPath('userData',${JSON.stringify(profile)});app.on('browser-window-created',(_,w)=>w.on('show',()=>w.hide()));process.argv=[process.argv[0]];const main=${JSON.stringify(path.join(payload, 'desktop/main.cjs'))};delete require.cache[require.resolve(main)];require(main);`);
const env = { ...process.env, BYQX_START_PATH: '/', BYQX_PI_AUTH_PATH: path.join(run, 'pi.json'), DATABASE_URL: `file:${db}`, DATABASE_URL_FALLBACK: '', SYNC_DATABASE_URL: '', SYNC_DATABASE_URL_FALLBACK: '' };
delete env.ELECTRON_RUN_AS_NODE;
const report = { directory, isolated: true, builtAt: new Date().toISOString(), cases: [], errors: [], matchedClientFiles: 0 };
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const record = name => { report.cases.push(name); console.log(`PASS ${name}`); };
const compareTree = (source, destination) => {
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.isDirectory()) compareTree(path.join(source, entry.name), path.join(destination, entry.name));
    else { assert.equal(hash(path.join(source, entry.name)), hash(path.join(destination, entry.name)), entry.name); report.matchedClientFiles++; }
  }
};
let app;
try {
  compareTree(path.join(root, 'dist/client'), path.join(payload, 'dist/client'));
  for (const file of ['main.cjs', 'preload.cjs']) assert.equal(hash(path.join(root, 'desktop', file)), hash(path.join(payload, 'desktop', file)));
  assert.ok(fs.readFileSync(path.join(payload, 'dist/server/entry.mjs'), 'utf8').includes('runtimeAppRoot'));
  record('Packaged client and desktop shell match the current build; server paths use the package root');
  app = await _electron.launch({ executablePath: path.join(portable, '白衣卿相.exe'), args: ['--toolchain-runner', bootstrap], env, cwd: run, timeout: 60000 });
  assert.equal(await app.evaluate(({ app }) => app.isPackaged), true);
  const page = await app.firstWindow();
  page.on('pageerror', error => report.errors.push(error.message));
  await page.waitForURL(`http://127.0.0.1:${port}/**`, { timeout: 60000 });
  await page.evaluate(async () => {
    const response = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'editor-fixture' }) });
    if (!response.ok) throw Error('Isolated owner login failed');
  });
  record('Real portable EXE starts from an external working directory with isolated owner login');
  const source = '> [!note] 第一块\n> 第一块正文\n\n> [!note] 第二块\n> 第二块正文\n\n**粗体内的 *斜体* 内容**\n\n\\*不是斜体\\*\n\n``a ` **b**``\n\n| A | B |\n| --- | --- |\n| x | y |\n\n尾部正文';
  const id = await page.evaluate(async source => {
    const created = await fetch('/api/articles', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    if (!created.ok) throw Error('Fixture create failed');
    const { id } = await created.json();
    const updated = await fetch(`/api/articles/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: source }) });
    if (!updated.ok) throw Error('Fixture source update failed');
    return id;
  }, source);
  await page.goto(`http://127.0.0.1:${port}/edit/${id}`);
  await page.waitForFunction(() => typeof window.__docInlineEditor?.open === 'function');
  await page.locator('#doc-inline-edit').click();
  await page.locator('.cm-callout-widget').nth(1).waitFor();
  assert.equal(await page.locator('.cm-block-widget > .cm-callout-widget').count(), 2);
  record('Packaged article editor loads the new measured block containers');
  const point = await page.locator('.doc-ie-view .cm-content').first().evaluate(content => {
    const line = [...content.children].find(el => el.classList.contains('cm-line') && el.textContent === '');
    const rect = line.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await page.mouse.click(point.x, point.y);
  await page.keyboard.insertText('包内定位');
  await page.evaluate(async () => { const result = await window.__docInlineEditor.saveAndClose(); if (result === false) throw Error('Fixture save failed'); });
  const stored = await page.evaluate(async id => (await (await fetch(`/api/articles/${id}`)).json()).article.content, id);
  assert.equal(stored, source.slice(0, source.indexOf('\n\n') + 1) + '包内定位' + source.slice(source.indexOf('\n\n') + 1));
  record('Real mouse input between packaged callouts persists to the isolated SQLite database at the correct position');
  await page.locator('#doc-inline-edit').click();
  await page.locator('.cm-callout-widget').nth(1).waitFor();
  const lines = await page.locator('.doc-ie-view .cm-content').first().locator(':scope > .cm-line').allTextContents();
  assert.ok(lines.includes('粗体内的 斜体 内容'), JSON.stringify(lines));
  assert.ok(lines.includes('*不是斜体*'), JSON.stringify(lines));
  assert.ok(lines.includes('a ` **b**'), JSON.stringify(lines));
  record('Packaged nested emphasis, escaped asterisks and multi-backtick code display correctly');
  const cell = page.locator('.md-table-widget tbody td').first();
  await cell.click();
  await page.keyboard.press('End');
  await page.evaluate(() => window.compositionCell = document.activeElement);
  await page.evaluate(() => {
    window.compositionEvents = [];
    for (const type of ['compositionstart', 'compositionupdate', 'compositionend', 'beforeinput', 'input', 'blur']) window.compositionCell.addEventListener(type, event => window.compositionEvents.push({ type, data: event.data, inputType: event.inputType, composing: event.isComposing, text: window.compositionCell.textContent }));
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.imeSetComposition', { text: '中文', selectionStart: 2, selectionEnd: 2 });
  await page.waitForTimeout(450);
  assert.equal(await page.evaluate(() => document.activeElement === window.compositionCell), true);
  await cdp.send('Input.insertText', { text: '中文' });
  await page.waitForTimeout(400);
  report.compositionEvents = await page.evaluate(() => window.compositionEvents);
  await page.evaluate(async () => { const result = await window.__docInlineEditor.saveAndClose(); if (result === false) throw Error('Composition save failed'); });
  const final = await page.evaluate(async id => (await (await fetch(`/api/articles/${id}`)).json()).article.content, id);
  assert.ok(final.includes('| x中文 | y |'), final);
  assert.equal(final.includes('中文中文'), false);
  record('Synthetic Chinese IME pause/commit in packaged table produces one committed phrase');
  await cdp.detach();
  assert.deepEqual(report.errors, []);
  report.executableSha256 = hash(path.join(portable, '白衣卿相.exe'));
  report.serverEntrySha256 = hash(path.join(payload, 'dist/server/entry.mjs'));
  console.log('PORTABLE_EDITOR_REVIEW_OK');
} catch (error) {
  report.errors.push(error.stack);
  throw error;
} finally {
  await app?.close().catch(() => {});
  fs.writeFileSync(path.join(output, 'latest.json'), JSON.stringify(report, null, 2));
}
