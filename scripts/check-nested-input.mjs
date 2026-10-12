/** Isolated browser regression; optional NESTED_INPUT_FIXTURE is never written. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build, preview } from 'vite';
import { chromium } from 'playwright-core';

const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(fs.realpathSync(fileURLToPath(import.meta.resolve('@tailwindcss/vite'))));
const { compile } = require('@tailwindcss/node'), { Scanner } = require('@tailwindcss/oxide');
const stylesheet = path.join(root, 'src/styles/global.css');
const compiler = await compile(fs.readFileSync(stylesheet, 'utf8'), { base: path.dirname(stylesheet), from: stylesheet, shouldRewriteUrls: true, onDependency() {} });
const css = compiler.build(new Scanner({ sources: [{ base: root, pattern: 'src/**/*', negated: false }, { base: root, pattern: 'tests/fixtures/editor-*.tsx', negated: false }] }).scan());
const config = { configFile: false, root, plugins: [{ name: 'nested-input-css', enforce: 'pre', load(id) { if (id.replaceAll('\\', '/').endsWith('/src/styles/global.css')) return css; } }],
  build: { outDir: path.join(root, '.diag/nested-input/build'), emptyOutDir: true, rollupOptions: { input: path.join(root, 'tests/fixtures/editor-kernel.html') } },
  preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' };
await build(config);
const server = await preview(config);
const executablePath = process.env.CHROME_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-proxy-server'] });
const results = [], errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text()); });
  await page.route('**/api/editor-shortcuts', r => r.fulfill({ json: { bindings: {} } }));
  await page.route('**/api/images/**', r => r.fulfill({ status: 404, body: '' }));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/editor-kernel.html`);
  await page.waitForFunction(() => window.kernel?.ready);
  const samples = [
    { name: 'unequal adjacent callouts', source: Array.from({ length: 35 }, (_, i) => `## Section ${i}\n\n> [!note] ${i % 2 ? 'Repeated title' : 'Block ' + i}\n>\n${Array.from({ length: [2, 9, 3, 7][i % 4] }, (_, n) => '> Ordinary paragraph ' + n + ' abcdefghijklmnopqrstuvwxyz').join('\n')}\n>\n\nEnd ${i}`).join('\n\n'), top: 2500 },
  ];
  // Unique paragraph text lets the test derive an expected root source independently
  // of the product's projection helpers, even inside multiple owning widgets.
  const body = i => Array.from({ length: [2, 9, 3, 7][i % 4] }, (_, n) => `Ordinary paragraph block ${i} line ${n} abcdefghijklmnopqrstuvwxyz`).join('\n');
  samples[0].source = Array.from({ length: 35 }, (_, i) => `## Section ${i}\n\n> [!note] Repeated title\n>\n${body(i).split('\n').map(l => '> ' + l).join('\n')}\n>\n\nEnd ${i}`).join('\n\n');
  for (const kind of ['collapse', 'tabs', 'columns', 'nested']) {
    const block = i => kind === 'collapse' ? `:::collapse expand\n- Repeated title\n\n${body(i).split('\n').map(l => '  ' + l).join('\n')}\n\n:::`
      : kind === 'tabs' ? `:::tabs\n@tab Repeated title\n\n${body(i)}\n\n@tab Other\n\nOther body ${i}\n\n:::`
      : `:::columns\n::column\n${kind === 'nested' ? `> [!note] Repeated title\n>\n${body(i).split('\n').map(l => '> ' + l).join('\n')}\n>` : body(i)}\n::column\nOther body ${i}\n:::`;
    samples.push({ name: kind + ' input isolation', source: Array.from({ length: 35 }, (_, i) => `## Section ${i}\n\n${block(i)}\n\nEnd ${i}`).join('\n\n'), top: 2500 });
  }
  samples.push({ name: 'large callout bottom caret following', source: '> [!note] Large\n' + Array.from({ length: 300 }, (_, i) => '> Ordinary paragraph line ' + i + ' abcdefghijklmnopqrstuvwxyz').join('\n') + '\n\nTail', top: 6500 });
  samples.push({ name: 'collapse preserves tab indentation', source: Array.from({ length: 25 }, (_, i) => `:::collapse expand\n- Same\n\n${body(i).split('\n').map(l => '\t' + l).join('\n')}\n\n:::`).join('\n\n'), top: 2500 });
  samples.push({ name: 'columns-collapse-callout three-layer input', source: Array.from({ length: 25 }, (_, i) => `::::columns\n::column\n:::collapse expand\n- Same\n\n  > [!note] Same\n  >\n${body(i).split('\n').map(l => '  > ' + l).join('\n')}\n  >\n\n:::\n::column\nOther body ${i}\n::::`).join('\n\n'), top: 2500 });
  samples.push({ name: 'callout-collapse-callout three-layer input', source: Array.from({ length: 25 }, (_, i) => `> [!note] Outer ${i}\n> :::collapse expand\n> - Same\n>\n>   > [!note] Inner ${i}\n${body(i).split('\n').map(l => '>   > ' + l).join('\n')}\n>\n> :::`).join('\n\n'), top: 2500 });
  samples.push({ name: 'oversized column fences stay unchanged', source: Array.from({ length: 25 }, (_, i) => `:::::columns\n::column\n${body(i)}\n::column\nOther body ${i}\n:::::`).join('\n\n'), top: 2500 });
  if (process.env.NESTED_INPUT_FIXTURE) samples.push({ name: 'private article regression', source: fs.readFileSync(process.env.NESTED_INPUT_FIXTURE, 'utf8'), top: 2500 });
  for (const sample of samples) {
    try {
      await page.evaluate(s => window.kernel.load(s), sample.source); await page.waitForFunction(() => window.kernel.ready); await page.waitForTimeout(100);
      await page.evaluate(t => window.kernel.view().scrollDOM.scrollTop = t, sample.top); await page.waitForTimeout(250);
      const point = await page.evaluate(() => {
        const root = window.kernel.view();
        const line = [...root.dom.querySelectorAll('.callout-body .cm-line,.cm-visual-body .cm-line,.cm-column-host .cm-line')].find(el => { const b = el.getBoundingClientRect(); return b.top > 100 && b.bottom < 620 && el.textContent.length > 10 && el.firstChild?.nodeType === 3 && !/^\s*[-*#>]/.test(el.textContent); });
        if (!line) throw Error('Missing visible ordinary callout paragraph');
        const child = root.constructor.findFromDOM(line), card = line.closest('.cm-callout-widget');
        window.nestedProbe = { root, child, node: child.dom, card };
        const b = line.getBoundingClientRect(); return { x: b.left + 80, y: b.top + b.height / 2 };
      });
      await page.mouse.click(point.x, point.y); await page.waitForTimeout(120);
      const before = await page.evaluate(() => {
        const { root, child } = window.nestedProbe;
        const source = root.state.doc.toString(), body = child.state.doc.toString(), head = child.state.selection.main.head;
        const line = child.state.doc.lineAt(head), at = source.indexOf(line.text);
        if (at < 0 || source.indexOf(line.text, at + 1) !== -1) throw Error('Test paragraph must have a unique source location');
        const prefix = source.slice(root.state.doc.lineAt(at).from, at), insertion = at + head - line.from;
        return { top: root.scrollDOM.scrollTop, body, head, source, expected: source.slice(0, insertion) + '\n' + prefix + source.slice(insertion) };
      });
      await page.keyboard.press('Enter'); await page.waitForTimeout(400);
      const after = await page.evaluate(() => { const { root, child, node } = window.nestedProbe; return { top: root.scrollDOM.scrollTop, head: child.state.selection.main.head, body: child.state.doc.toString(), source: root.state.doc.toString(), connected: node.isConnected }; });
      assert.equal(after.connected, true, 'Active child was destroyed');
      assert.equal(after.body, before.body.slice(0, before.head) + '\n' + before.body.slice(before.head), 'Active child received another block or lost content');
      assert.equal(after.head, before.head + 1, 'Enter reset the caret');
      assert.equal(after.source, before.expected, 'Enter changed unrelated Markdown or quote prefixes');
      assert.ok(Math.abs(after.top - before.top) <= 2, `Enter scrolled ${after.top - before.top}px`);
      const identity = await page.evaluate(() => window.nestedProbe.node.closest('.cm-block-widget').dataset.editorBlockId);
      await page.keyboard.insertText('连续输入'); await page.keyboard.press('Backspace');
      await page.waitForTimeout(200);
      assert.equal(await page.evaluate(() => window.nestedProbe.child.state.doc.toString()), after.body.slice(0, after.head) + '连续输' + after.body.slice(after.head));
      await page.evaluate(() => { const data = new DataTransfer(); data.setData('text/plain', '粘贴'); document.activeElement.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data })); });
      await page.waitForTimeout(200);
      assert.ok(await page.evaluate(() => window.nestedProbe.child.state.doc.toString().includes('连续输粘贴')));
      assert.equal(await page.evaluate(() => window.nestedProbe.node.closest('.cm-block-widget').dataset.editorBlockId), identity, 'Input replaced the active widget identity');
      const edited = await page.evaluate(() => window.kernel.snapshot().source);
      const historyTop = await page.evaluate(() => window.kernel.view().scrollDOM.scrollTop);
      await page.keyboard.press('Control+z'); await page.waitForTimeout(100);
      assert.notEqual(await page.evaluate(() => window.kernel.snapshot().source), edited, 'Nested undo did not change the source');
      await page.keyboard.press('Control+y'); await page.waitForTimeout(150);
      assert.equal(await page.evaluate(() => window.kernel.snapshot().source), edited, 'Undo/redo lost nested source');
      assert.ok(await page.evaluate(top => Math.abs(window.kernel.view().scrollDOM.scrollTop - top) <= 2, historyTop), 'Undo/redo scrolled a visible nested caret');
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.imeSetComposition', { text: '中文', selectionStart: 2, selectionEnd: 2 }); await page.waitForTimeout(350);
      assert.equal(await page.evaluate(() => window.nestedProbe.node.isConnected), true, 'IME rebuilt the child editor');
      await cdp.send('Input.insertText', { text: '中文' }); await page.waitForTimeout(200); await cdp.detach();
      assert.ok(await page.evaluate(() => window.kernel.snapshot().source.includes('中文')), 'IME commit was lost');
      // A final empty line is authored content, even next to a directive's framing.
      await page.evaluate(() => { const v = window.nestedProbe.child; v.dispatch({ selection: { anchor: v.state.doc.length }, scrollIntoView: true }); v.focus(); });
      await page.waitForTimeout(200);
      const endBody = await page.evaluate(() => window.nestedProbe.child.state.doc.toString());
      const endTop = await page.evaluate(() => window.nestedProbe.root.scrollDOM.scrollTop);
      await page.keyboard.press('Enter'); await page.waitForTimeout(200);
      assert.equal(await page.evaluate(() => window.nestedProbe.child.state.doc.toString()), endBody + '\n', 'Enter at body end lost the new empty line');
      const geometry = await page.evaluate(() => { const { root, child } = window.nestedProbe; const caret = child.coordsAtPos(child.state.selection.main.head), viewport = root.scrollDOM.getBoundingClientRect(); return { top: root.scrollDOM.scrollTop, caretTop: caret.top, caretBottom: caret.bottom, viewportTop: viewport.top, viewportBottom: viewport.bottom }; });
      assert.ok(geometry.caretTop >= geometry.viewportTop - 2 && geometry.caretBottom <= geometry.viewportBottom + 2, 'New caret left the editing viewport');
      assert.ok(Math.abs(geometry.top - endTop) <= 60, 'Final Enter scrolled beyond the newly added line');
      await page.keyboard.insertText('末行'); await page.waitForTimeout(200);
      assert.equal(await page.evaluate(() => window.nestedProbe.child.state.doc.toString()), endBody + '\n末行', 'Typing after the final Enter changed a different block');
      results.push({ name: sample.name, passed: true, beforeTop: before.top, afterTop: after.top, head: after.head });
      console.log('PASS ' + sample.name);
    } catch (e) { results.push({ name: sample.name, passed: false, error: e.message }); console.error('FAIL ' + sample.name + ': ' + e.message.slice(0, 400)); }
  }
  try {
    await page.evaluate(s => window.kernel.load(s), samples[0].source.replace(/^## Section 0\n\n/, '')); await page.waitForFunction(() => window.kernel.ready); await page.waitForTimeout(100);
    await page.evaluate(() => { const v = window.kernel.view(); v.dispatch({ selection: { anchor: 0 } }); v.focus(); v.scrollDOM.scrollTop = 0; });
    let previous = 0;
    for (let step = 0; step < 8; step++) {
      await page.evaluate(() => window.kernel.view().scrollDOM.scrollTop += 450); await page.waitForTimeout(200);
      const top = await page.evaluate(() => window.kernel.view().scrollDOM.scrollTop);
      assert.ok(top >= previous, 'Remount focused the offscreen first callout and scrolled backward'); previous = top;
    }
    results.push({ name: 'virtual remount does not focus offscreen callout', passed: true }); console.log('PASS virtual remount does not focus offscreen callout');
  } catch (e) { results.push({ name: 'virtual remount does not focus offscreen callout', passed: false, error: e.message }); console.error('FAIL virtual remount: ' + e.message); }
  for (const [name, source, selector] of [
    ['empty callout', '> [!note] Empty', '.callout-body .cm-content'],
    ['empty collapse', ':::collapse expand\n- Empty\n\n:::', '.cm-visual-body .cm-content'],
    ['empty tabs', ':::tabs\n@tab Empty\n@tab Other\n\nOther text\n\n:::', '.cm-visual-body .cm-content'],
    ['empty columns', ':::columns\n::column\n::column\nOther text\n:::', '.cm-column-host .cm-content'],
  ]) {
    try {
      await page.evaluate(s => window.kernel.load(s), source); await page.waitForFunction(() => window.kernel.ready);
      await page.locator(selector).first().click(); await page.keyboard.insertText('新正文'); await page.keyboard.press('Enter'); await page.keyboard.insertText('末行'); await page.waitForTimeout(200);
      assert.equal(await page.locator(selector).first().evaluate(el => { const root = window.kernel.view(); return root.constructor.findFromDOM(el).state.doc.toString(); }), '新正文\n末行');
      await page.evaluate(() => window.kernel.mode(true)); await page.waitForTimeout(100); await page.evaluate(() => window.kernel.mode(false)); await page.waitForTimeout(200);
      assert.ok(await page.locator(selector).count(), 'Typing invalidated the empty container syntax');
      assert.equal(await page.locator(selector).first().evaluate(el => { const root = window.kernel.view(); return root.constructor.findFromDOM(el).state.doc.toString(); }), '新正文\n末行');
      results.push({ name, passed: true }); console.log('PASS ' + name);
    } catch (e) { results.push({ name, passed: false, error: e.message }); console.error('FAIL ' + name + ': ' + e.message.slice(0, 300)); }
  }
  assert.deepEqual(errors, [], 'Browser errors');
  assert.ok(results.every(r => r.passed), 'Nested input regression failed');
} finally {
  fs.mkdirSync(path.join(root, 'outputs/nested-input'), { recursive: true });
  fs.writeFileSync(path.join(root, 'outputs/nested-input/results.json'), JSON.stringify({ results, errors }, null, 2));
  await browser.close(); await new Promise(r => server.httpServer.close(r));
}
