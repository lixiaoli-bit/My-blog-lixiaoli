/** Isolated real Electron regression. ARTICLE_FIXTURE_DB is opened read-only; never copied into Git. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { _electron, chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
const root = path.resolve(import.meta.dirname, '..'), name = process.argv[2];
if (!name || !/^[\w-]+$/.test(name)) throw Error('Pass a portable directory inside release');
const baseline = process.argv.includes('--baseline');
const nativeTest = process.argv.includes('--native-drag');
const visibleScroll = process.argv.includes('--visible-scroll');
const nestedInput = process.argv.includes('--nested-input');
const portable = path.join(root, 'release', name), run = fs.mkdtempSync(path.join(os.tmpdir(), 'byqx-article-review-'));
const appData = path.join(run, 'appdata'), profile = path.join(run, 'profile'), dbFile = path.join(run, 'fixture.db');
fs.mkdirSync(path.join(appData, 'byqx-blog-desktop'), { recursive: true }); fs.mkdirSync(profile);
fs.copyFileSync(path.join(portable, 'resources/desktop-assets/template.db'), dbFile);
let study = { title: '高数长文隔离验收', content: Array.from({ length: 100 }, (_, i) => `## ${i + 1} 多元微分\n\n> [!note]+ 例题\n> 求偏导 $f_x$\n\n:::collapse\n- 解析\n\n  $$f(x,y)=x^2+y^2$$\n:::\n`).join('\n') };
if (process.env.ARTICLE_FIXTURE_DB) {
  const source = new Database(process.env.ARTICLE_FIXTURE_DB, { readonly: true, fileMustExist: true });
  study = process.env.ARTICLE_FIXTURE_ID
    ? source.prepare('SELECT title,content FROM doc_nodes WHERE id=?').get(process.env.ARTICLE_FIXTURE_ID)
    : source.prepare('SELECT title,content FROM doc_nodes WHERE title=?').get(process.env.ARTICLE_FIXTURE_TITLE || '没咋了-高数强化-第5章-多元微分学（5.1至5.5·合并）'); source.close();
  assert.ok(study, 'Requested study article must exist');
}
const db = new Database(dbFile), now = Date.now();
db.prepare('INSERT INTO doc_categories (id,name,sort,created_at,updated_at) VALUES (?,?,?,?,?)').run('fixture-category', '隔离验收', 0, now, now);
db.prepare('INSERT INTO doc_bundles (id,category_id,name,sort,created_at,updated_at) VALUES (?,?,?,?,?,?)').run('fixture-book', 'fixture-category', '隔离验收', 0, now, now);
db.prepare('INSERT INTO doc_nodes (id,bundle_id,kind,title,content,sort,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run('fixture-study', 'fixture-book', 'article', study.title, study.content, 0, now, now);
db.close();
const port = await new Promise(resolve => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); }); });
fs.writeFileSync(path.join(appData, 'byqx-blog-desktop/config.json'), JSON.stringify({ LOCAL_DB_PATH: dbFile, ADMIN_PASSWORD: 'article-fixture', AUTH_SECRET: 'isolated-article-fixture', SYNC_DATABASE_URL: 'postgresql://fixture:fixture@127.0.0.1:1/fixture', PORT: String(port) }));
const bootstrap = path.join(run, 'bootstrap.cjs');
fs.writeFileSync(bootstrap, `const {app}=require('electron');app.setPath('appData',${JSON.stringify(appData)});app.setPath('userData',${JSON.stringify(profile)});app.on('browser-window-created',(_,w)=>{w.__reviewHide=()=>w.hide();w.on('show',w.__reviewHide);});process.argv=[process.argv[0]];const main=${JSON.stringify(path.join(portable, 'resources/app/desktop/main.cjs'))};delete require.cache[require.resolve(main)];require(main);`);
const env = { ...process.env, BYQX_START_PATH: '/', BYQX_PI_AUTH_PATH: path.join(run, 'pi.json'), DATABASE_URL: `file:${dbFile}`, DATABASE_URL_FALLBACK: '', SYNC_DATABASE_URL: '', SYNC_DATABASE_URL_FALLBACK: '' }; delete env.ELECTRON_RUN_AS_NODE;
const report = { isolated: true, directory: name, baseline, studyChars: study.content.length, studySha256: crypto.createHash('sha256').update(study.content).digest('hex'), cases: [], errors: [] };
let app;
const pass = name => { report.cases.push(name); console.log('PASS ' + name); };
try {
  app = await _electron.launch({ executablePath: path.join(portable, '白衣卿相.exe'), args: ['--toolchain-runner', bootstrap], env, cwd: run, timeout: 60000 });
  const page = await app.firstWindow(); page.setDefaultTimeout(20000); page.on('pageerror', error => { report.errors.push(error.message); console.error('PAGEERROR', page.url(), error.stack); });
  await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.webContents.setBackgroundThrottling(false); });
  // Chromium skips native ViewTransition.ready in hidden windows; exercise Astro's
  // real navigation fallback so its rejected animation promise cannot mask failures.
  await page.addInitScript(() => { document.startViewTransition = undefined; });
  await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 60000 });
  const base = new URL(page.url()).origin;
  await page.evaluate(async () => { const r = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'article-fixture' }) }); if (!r.ok) throw Error('Owner login failed'); });
  await page.goto(base + '/doc/fixture-book?article=fixture-study');
  await page.waitForFunction(() => !!window.__docInlineEditor);
  await page.locator('#doc-inline-edit').click();
  await page.waitForFunction(() => document.getElementById('doc-3col')?.dataset.editing === 'true' || !!document.querySelector('.doc-ie-host [role="alert"]'), { timeout: 20000 });
  const alert = await page.locator('.doc-ie-host [role="alert"]').allTextContents();
  report.initialAlert = alert;
  if (baseline) {
    report.editing = await page.locator('#doc-3col').getAttribute('data-editing');
    console.log(JSON.stringify({ chars: report.studyChars, editing: report.editing, alert, errors: report.errors }));
  } else {
    assert.deepEqual(alert, []); assert.equal(await page.locator('#doc-3col').getAttribute('data-editing'), 'true');
    pass('Actual study article opens without read/initialization failure');
    if (nestedInput) {
      // Inspect CM's test-only DOM handle; no debug API is shipped in the app.
      let inputPoint;
      for (const top of [2500, 1800, 1000, 500, 0]) {
        await page.evaluate(top => { const root = document.querySelector('.doc-ie-view .cm-content').cmTile.root.view; root.scrollDOM.scrollTop = top; }, top);
        await page.waitForTimeout(350);
        inputPoint = await page.evaluate(() => {
        const root = document.querySelector('.doc-ie-view .cm-content').cmTile.root.view, viewport = root.scrollDOM.getBoundingClientRect();
        const line = [...root.dom.querySelectorAll('.callout-body .cm-line')].find(el => { const r = el.getBoundingClientRect(); return r.top > Math.max(0, viewport.top) + 30 && r.bottom < Math.min(innerHeight, viewport.bottom) - 70 && el.textContent.length > 10 && el.firstChild?.nodeType === 3 && !/^\s*[-*#>]/.test(el.textContent); });
        if (!line) return null;
        const child = root.constructor.findFromDOM(line); window.articleInputProbe = { root, child, node: child.dom };
        const r = line.getBoundingClientRect(); return { x: r.left + 80, y: r.top + r.height / 2 };
        });
        if (inputPoint) break;
      }
      assert.ok(inputPoint, 'No visible ordinary paragraph for the nested input regression');
      await page.mouse.click(inputPoint.x, inputPoint.y); await page.waitForTimeout(150);
      const before = await page.evaluate(() => {
        const { root, child } = window.articleInputProbe, source = root.state.doc.toString(), body = child.state.doc.toString(), head = child.state.selection.main.head;
        const line = child.state.doc.lineAt(head), at = source.indexOf(line.text);
        if (at < 0 || source.indexOf(line.text, at + 1) !== -1) throw Error('Nested regression needs a unique paragraph');
        const prefix = source.slice(root.state.doc.lineAt(at).from, at), insertion = at + head - line.from;
        return { source, body, head, top: root.scrollDOM.scrollTop, expected: source.slice(0, insertion) + '\n' + prefix + source.slice(insertion) };
      });
      assert.equal(before.source, study.content);
      await page.keyboard.press('Enter'); await page.waitForTimeout(400);
      const after = await page.evaluate(() => { const { root, child, node } = window.articleInputProbe; return { connected: node.isConnected, source: root.state.doc.toString(), body: child.state.doc.toString(), head: child.state.selection.main.head, top: root.scrollDOM.scrollTop }; });
      assert.equal(after.connected, true); assert.equal(after.head, before.head + 1);
      assert.equal(after.body, before.body.slice(0, before.head) + '\n' + before.body.slice(before.head));
      assert.equal(after.source, before.expected); assert.ok(Math.abs(after.top - before.top) <= 2, `Packaged Enter moved ${after.top - before.top}px`);
      report.nestedInput = { beforeTop: before.top, afterTop: after.top, beforeHead: before.head, afterHead: after.head, sourceChars: after.source.length };
      await page.waitForFunction(async expected => (await (await fetch('/api/doc/nodes/fixture-study')).json()).node.content === expected, before.expected);
      pass('Packaged nested Enter preserves caret, owning child, view position, quote prefixes and autosaves exact source');
      await page.keyboard.press('Control+z'); await page.waitForTimeout(150);
      assert.equal(await page.evaluate(() => window.articleInputProbe.root.state.doc.toString()), before.source);
      await page.keyboard.press('Control+y'); await page.waitForTimeout(150);
      assert.equal(await page.evaluate(() => window.articleInputProbe.root.state.doc.toString()), before.expected);
      await page.locator('#doc-inline-preview').click(); await page.waitForFunction(() => window.__docInlineEditor.getMode() === 'preview');
      await page.locator('#doc-inline-edit').click(); await page.waitForFunction(() => document.getElementById('doc-3col').dataset.editing === 'true' && document.querySelector('.doc-ie-view .cm-content'));
      assert.equal(await page.evaluate(() => document.querySelector('.doc-ie-view .cm-content').cmTile.root.view.state.doc.toString()), before.expected);
      study = { ...study, content: before.expected };
      pass('Packaged nested undo/redo and save-preview-reopen preserve the complete edited article');
    }
    const foldControls = page.locator('.doc-ie-view .cm-callout-widget .callout-title button');
    if (await foldControls.count()) {
      if (visibleScroll) await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.removeListener('show', window.__reviewHide); window.setTitle('隔离 408 编辑验收（临时数据库）'); window.showInactive(); });
      report.scrollGeometry = await page.locator('.doc-ie-view .cm-scroller').first().evaluate(scroller => ({ rect: scroller.getBoundingClientRect().toJSON(), height: scroller.scrollHeight, clientHeight: scroller.clientHeight, overflow: getComputedStyle(scroller).overflowY, windowY: scrollY, windowHeight: innerHeight, editorHeight: document.querySelector('.doc-ie-view').style.height }));
      const middle = await page.locator('.doc-ie-view .cm-scroller').first().evaluate(scroller => { scroller.scrollTop = 0; const r = scroller.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
      await page.mouse.move(middle.x, middle.y);
      let previous = 0;
      report.scrollPositions = [];
      for (let step = 0; step < 8; step++) {
        if (visibleScroll) await page.mouse.wheel(0, 450);
        else await page.locator('.doc-ie-view .cm-scroller').first().evaluate(scroller => scroller.scrollTop += 450);
        // CDP dispatch completion does not mean Chromium has scrolled yet.
        // Consume every wheel delta before measuring a later fold operation.
        try { await page.waitForFunction(expected => document.querySelector('.doc-ie-view .cm-scroller').scrollTop >= expected - 2, (step + 1) * 450); }
        catch (error) { report.stalledScroll = await page.locator('.doc-ie-view .cm-scroller').first().evaluate(scroller => ({ top: scroller.scrollTop, windowY: scrollY, rect: scroller.getBoundingClientRect().toJSON(), height: scroller.scrollHeight, clientHeight: scroller.clientHeight })); throw error; }
        await page.waitForTimeout(200);
        const top = await page.locator('.doc-ie-view .cm-scroller').first().evaluate(scroller => scroller.scrollTop);
        report.scrollPositions.push(top);
        assert.ok(top >= previous, 'Packaged downward scrolling must not jump backwards'); previous = top;
      }
      const point = await page.evaluate(() => {
        const scroller = document.querySelector('.doc-ie-view .cm-scroller'), viewport = scroller.getBoundingClientRect();
        const button = [...document.querySelectorAll('.doc-ie-view .cm-callout-widget .callout-title button')].find(el => { const r = el.getBoundingClientRect(); return r.top > viewport.top + 8 && r.bottom < viewport.bottom - 8; });
        if (!button) throw Error('Expected a visible fold control in the actual study article');
        const r = button.getBoundingClientRect(); return { x: r.left + 5, y: r.top + 5 };
      });
      report.foldPositions = [];
      for (let toggle = 0; toggle < 4; toggle++) {
        const before = await page.locator('.doc-ie-view .cm-scroller').first().evaluate(scroller => scroller.scrollTop);
        await page.mouse.click(point.x, point.y); await page.waitForTimeout(300);
        const after = await page.locator('.doc-ie-view .cm-scroller').first().evaluate(scroller => scroller.scrollTop);
        report.foldPositions.push({ before, after });
        assert.ok(Math.abs(after - before) < 8, `Packaged folding moved the viewport ${after - before}px`);
      }
      if (visibleScroll) await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.hide(); window.on('show', window.__reviewHide); });
      pass(`Packaged actual study article ${visibleScroll ? 'mouse-wheel' : 'programmatic'} scrolling and repeated folding do not jump`);
    }
    await page.locator('#doc-inline-source').click(); await page.waitForFunction(() => window.__docInlineEditor.getMode() === 'source');
    await page.locator('.doc-ie-view .cm-content').first().click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText('\n\n隔离保存验收');
    await page.waitForFunction(async () => (await (await fetch('/api/doc/nodes/fixture-study')).json()).node.content.endsWith('隔离保存验收'));
    assert.equal(await page.evaluate(() => window.__docInlineEditor.getMode()), 'source'); pass('Source-mode autosave persists input without exiting source');
    await page.keyboard.insertText('手动保存'); await page.keyboard.press('Control+s');
    await page.waitForFunction(async () => (await (await fetch('/api/doc/nodes/fixture-study')).json()).node.content.endsWith('隔离保存验收手动保存'));
    assert.equal(await page.evaluate(() => window.__docInlineEditor.getMode()), 'source'); pass('Source-mode Ctrl+S persists the complete latest text and stays in source');
    await page.keyboard.insertText('按钮保存'); await page.getByRole('button', { name: '保存源码', exact: true }).click();
    await page.waitForFunction(async () => (await (await fetch('/api/doc/nodes/fixture-study')).json()).node.content.endsWith('手动保存按钮保存'));
    assert.equal(await page.evaluate(() => window.__docInlineEditor.getMode()), 'source'); pass('Explicit source-save button persists edits without changing the view');
    await page.locator('#doc-inline-preview').click(); await page.waitForFunction(() => window.__docInlineEditor.getMode() === 'preview');
    const saved = await page.evaluate(async () => (await (await fetch('/api/doc/nodes/fixture-study')).json()).node.content);
    assert.ok(saved.startsWith(study.content), 'Original source must remain byte-for-byte intact'); assert.ok(saved.endsWith('隔离保存验收手动保存按钮保存')); pass('Full study source saves without truncation and returns to preview');
    await page.locator('#doc-inline-edit').click(); await page.waitForFunction(() => window.__docInlineEditor.getMode() === 'visual' && !!document.querySelector('.cm-editor'));
    await page.locator('.doc-ie-view .cm-content').first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: /^切换视图/ }).hover(); await page.getByRole('menuitem', { name: '预览模式', exact: true }).click();
    await page.waitForFunction(() => window.__docInlineEditor.getMode() === 'preview'); pass('Visual editor context submenu switches to preview');
    await page.route('**/api/doc/nodes/fixture-study', route => route.fulfill({ status: 500, json: { error: '隔离读取失败' } }));
    await page.locator('#doc-inline-edit').click(); await page.getByRole('alert').filter({ hasText: '隔离读取失败' }).waitFor();
    assert.equal(await page.locator('main article.prose').isVisible(), true);
    await page.locator('#doc-inline-preview').click(); await page.waitForFunction(() => window.__docInlineEditor.getMode() === 'preview');
    assert.equal(await page.locator('.doc-ie-host [role="alert"]').count(), 0); pass('Failed reads preserve preview and preview control exits the error state');
    await page.unroute('**/api/doc/nodes/fixture-study');
    await page.locator('[data-markdown-export-drag="fixture-study"]').hover();
    const prepared = await page.evaluate(() => window.desktop.prepareMarkdownExport('fixture-study'));
    assert.equal(prepared.ok, true); assert.ok(prepared.filename.endsWith('.md')); assert.equal('file' in prepared, false); pass('Real preload/main bridge prepares a restricted Chinese Markdown export');
    // Read the isolated native temporary file from the trusted test process, never the renderer.
    const expectedExport = await page.evaluate(async () => (await fetch('/api/export/doc/fixture-study')).text());
    const exports = fs.readdirSync(os.tmpdir()).filter(name => name.startsWith('byqx-markdown-')).map(name => path.join(os.tmpdir(), name, prepared.token, prepared.filename)).filter(fs.existsSync);
    assert.equal(exports.length, 1); assert.equal(fs.readFileSync(exports[0], 'utf8'), expectedExport); pass('Native temporary Markdown matches the existing UTF-8 export endpoint exactly');
    await app.evaluate(({ BrowserWindow }, nativeTest) => {
      const web = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('/doc/fixture-book')).webContents;
      const original = web.startDrag.bind(web); web.startDrag = item => { globalThis.nativeDragReview = { iconEmpty: item.icon.isEmpty(), file: item.file, completed: !nativeTest }; if (nativeTest) try { return original(item); } finally { globalThis.nativeDragReview.completed = true; } };
    }, nativeTest);
    const nativeProcessId = await app.evaluate(() => process.pid);
    const cancellation = nativeTest ? setInterval(() => {
      const helper = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'scripts/cancel-native-test-drag.ps1'), '-TargetProcessId', String(nativeProcessId), '-ExpectedExecutable', path.join(portable, '白衣卿相.exe')], { windowsHide: true, stdio: 'ignore' });
      helper.on('error', error => report.errors.push('Native drag cancellation helper: ' + error.message));
    }, 1500) : undefined;
    await page.evaluate(token => window.desktop.startMarkdownDrag(token), prepared.token);
    await page.waitForTimeout(250);
    let nativeDrag;
    try {
      for (let attempt = 0; attempt < 20; attempt++) {
        nativeDrag = await app.evaluate(() => globalThis.nativeDragReview);
        if (nativeDrag?.completed) break;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      assert.equal(nativeDrag?.completed, true, 'Native drag cancellation must return to the app');
    } finally { clearInterval(cancellation); }
    assert.equal(nativeDrag.iconEmpty, false); assert.equal(nativeDrag.file, exports[0]); pass(nativeTest ? 'Real Electron native drag invokes the OS loop and cancels successfully' : 'Real preload IPC supplies webContents.startDrag with the prepared file and a valid icon');
    await page.goto(base + '/doc/fixture-book?article=fixture-study'); await page.waitForFunction(() => !!window.__docInlineEditor);
    await page.locator('main article.prose').click({ button: 'right', position: { x: 30, y: 20 } });
    await page.getByRole('menuitem', { name: '切换视图 ›', exact: true }).hover();
    await page.getByRole('menuitemradio', { name: '源码模式', exact: true }).click();
    await page.waitForFunction(() => window.__docInlineEditor.getMode() === 'source' && !!document.querySelector('.cm-editor'));
    pass('Reading context menu opens source mode');
    await page.route('**/api/doc/nodes/fixture-study', route => route.request().method() === 'PATCH' ? route.fulfill({ status: 409, json: { error: '正文已变化' } }) : route.continue());
    await page.locator('.doc-ie-view .cm-content').first().click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText('\n冲突草稿保留');
    await page.locator('#doc-inline-preview').click(); await page.getByRole('alert').filter({ hasText: '当前改动已暂存' }).waitFor();
    assert.equal(await page.evaluate(() => window.__docInlineEditor.getMode()), 'source');
    assert.ok(await page.evaluate(() => Object.keys(localStorage).some(key => key.startsWith('byqx:pending-article:') && localStorage.getItem(key).includes('冲突草稿保留'))));
    await page.unroute('**/api/doc/nodes/fixture-study'); await page.locator('#doc-inline-preview').click(); await page.waitForFunction(() => window.__docInlineEditor.getMode() === 'preview');
    pass('Conflict rejects overwrite, retains source and local draft, and retry can save');
    await page.route('**/cm-wysiwyg.*.js', route => route.abort());
    await page.reload(); await page.waitForFunction(() => !!window.__docInlineEditor);
    await page.locator('#doc-inline-source').click(); await page.waitForFunction(() => window.__docInlineEditor.getMode() === 'source' && document.getElementById('doc-3col').dataset.editing === 'true');
    await page.locator('#doc-inline-edit').click(); await page.getByRole('alert').filter({ hasText: '可视编辑器加载失败' }).waitFor();
    assert.equal(await page.evaluate(() => window.__docInlineEditor.getMode()), 'source');
    await page.locator('#doc-inline-preview').click(); await page.waitForFunction(() => window.__docInlineEditor.getMode() === 'preview');
    await page.unroute('**/cm-wysiwyg.*.js'); pass('Source editing and preview work when the visual module cannot load');
    const ids = [];
    for (let i = 0; i < 3; i++) {
      ids.push(await page.evaluate(async i => {
        const { id } = await (await fetch('/api/articles', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json();
        for (const [url, body] of [
          [`/api/articles/${id}`, { content: '正文' }],
          [`/api/articles/${id}/title`, { title: '混排验收' + i }],
          [`/api/articles/${id}/metadata`, { summary: '横向列表混排摘要', cover: i === 0 ? '/images/neobrutalism/cat-peek.webp' : i === 2 ? '/missing-cover.png' : '', type: 'tech', tags: [] }],
        ]) { const response = await fetch(url, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); if (!response.ok) throw Error('Fixture update failed: ' + response.status); }
        return id;
      }, i));
    }
    await page.goto(base + '/');
    await page.locator(`[data-home-article-id="${ids[2]}"]`).scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelectorAll('.post-row--no-cover').length >= 2);
    for (const width of [1440, 941, 390, 360]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      const without = page.locator(`[data-home-article-id="${ids[1]}"]`); assert.equal(await without.locator('img').count(), 0);
      const columns = await without.evaluate(row => getComputedStyle(row).gridTemplateColumns.split(' ').length); assert.equal(columns, width > 600 ? 2 : 1);
    }
    pass('Mixed real/absent/broken covers keep responsive text-first rows without horizontal overflow');
    const visual = await chromium.launch({ channel: 'msedge', headless: true });
    try {
      const screenshot = await visual.newPage(); await screenshot.emulateMedia({ reducedMotion: 'reduce' }); fs.mkdirSync(path.join(root, 'outputs/article-workspace'), { recursive: true });
      for (const width of [1440, 390]) {
        await screenshot.setViewportSize({ width, height: 1000 }); await screenshot.goto(base + '/'); await screenshot.evaluate(() => document.fonts.ready);
        await screenshot.locator('[data-home-article-id]').last().scrollIntoViewIfNeeded(); await screenshot.waitForFunction(() => document.querySelectorAll('.post-row--no-cover').length >= 2); await screenshot.waitForTimeout(150);
        await screenshot.screenshot({ path: path.join(root, 'outputs/article-workspace', `home-${width}.png`), fullPage: true });
      }
    } finally { await visual.close(); }
    await page.setViewportSize({ width: 1440, height: 900 });
    const first = page.locator(`[data-home-article-id="${ids[0]}"]`);
    const firstReadHref = await first.locator('.neo-post-link').getAttribute('href');
    await first.scrollIntoViewIfNeeded(); await page.waitForTimeout(150);
    await first.click({ button: 'right' }); await page.getByRole('menuitem', { name: '编辑文章', exact: true }).click();
    await page.waitForURL(base + '/edit/' + ids[0] + '**'); await page.waitForFunction(() => window.__docInlineEditor?.getMode() === 'visual');
    assert.equal(await page.locator('[data-article-cover-block]').isVisible(), true); pass('Homepage right-click editing opens editing directly and shows the same cover');
    await page.goto(base + firstReadHref); assert.equal(await page.locator('[data-article-cover-block]').isVisible(), true); pass('Public article detail shows its real cover');
    await page.goto(base + '/');
    await page.locator(`[data-home-article-id="${ids[1]}"]`).scrollIntoViewIfNeeded(); await page.waitForTimeout(150);
    await page.locator(`[data-home-article-id="${ids[1]}"]`).click({ button: 'right' }); await page.getByRole('menuitem', { name: '删除文章', exact: true }).click();
    await page.locator('[data-confirm-cancel]').click(); assert.equal(await page.locator(`[data-home-article-id="${ids[1]}"]`).count(), 1);
    await page.locator(`[data-home-article-id="${ids[1]}"]`).click({ button: 'right' }); await page.getByRole('menuitem', { name: '删除文章', exact: true }).click();
    await page.locator('[data-confirm-ok]').click(); await page.waitForFunction(id => !document.querySelector(`[data-home-article-id="${id}"]`), ids[1]);
    await page.waitForTimeout(300); assert.ok(await page.locator('.neo-page-summary').textContent().then(text => text.includes('共 2 篇'))); pass('Homepage delete cancel preserves the article; confirmed deletion refreshes counts');
    await page.locator('#manage-entry-btn').click(); await page.locator('#manage-top').waitFor({ state: 'visible' });
    await page.getByRole('link', { name: '进入授权管理页' }).click(); await page.waitForURL(base + '/admin/auth');
    assert.equal(await page.locator('#manage-dialog').evaluate(dialog => dialog.open), false);
    await page.goBack(); assert.equal(await page.locator('#manage-dialog').evaluate(dialog => dialog.open), false); pass('Management navigation and return close the persisted authorization dialog');
    await page.route('**/api/admin-auth/me', async route => { await new Promise(resolve => setTimeout(resolve, 500)); await route.fulfill({ json: { identity: 'top' } }).catch(() => {}); });
    await page.locator('#manage-entry-btn').click(); await page.locator('#manage-close').click(); await page.waitForTimeout(650);
    assert.equal(await page.locator('#manage-dialog').evaluate(dialog => dialog.open), false); await page.unroute('**/api/admin-auth/me'); pass('Late identity replies cannot reopen a closed management dialog');
    await page.evaluate(async () => { await fetch('/api/logout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); });
    await page.goto(base + '/'); await page.locator('.post-row').first().click({ button: 'right' }); assert.equal(await page.getByRole('menu', { name: '文章操作', exact: true }).count(), 0);
    const denied = await page.evaluate(async id => (await fetch('/api/articles/' + id, { method: 'DELETE' })).status, ids[0]); assert.equal(denied, 401); pass('Visitors have no management menu and server rejects unauthorized deletion');
    assert.deepEqual(report.errors, []);
  }
} catch (error) { report.errors.push(error.message); throw error; }
finally { await app?.close().catch(() => {}); fs.mkdirSync(path.join(root, 'outputs/article-workspace'), { recursive: true }); fs.writeFileSync(path.join(root, 'outputs/article-workspace', baseline ? 'baseline.json' : 'latest.json'), JSON.stringify(report, null, 2)); }
