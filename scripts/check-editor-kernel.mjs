/** Real mouse hit testing and synthetic IME regression: pnpm exec node scripts/check-editor-kernel.mjs */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { build, preview } from 'vite';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executablePath = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);
if (!executablePath) throw new Error('Set CHROME_PATH to a Chromium executable');
// Compile the actual stylesheet with the installed Tailwind runtime. Scan only product source,
// rather than letting the Vite plugin inventory unrelated extracted applications in the workspace.
const tailwindRequire = createRequire(realpathSync(fileURLToPath(import.meta.resolve('@tailwindcss/vite'))));
const { compile } = tailwindRequire('@tailwindcss/node');
const { Scanner } = tailwindRequire('@tailwindcss/oxide');
const stylesheet = path.join(root, 'src/styles/global.css');
const compiler = await compile(readFileSync(stylesheet, 'utf8'), { base: path.dirname(stylesheet), from: stylesheet, shouldRewriteUrls: true, onDependency() {} });
const scanner = new Scanner({ sources: [{ base: root, pattern: 'src/**/*', negated: false }, { base: root, pattern: 'tests/fixtures/editor-*.tsx', negated: false }] });
const css = compiler.build(scanner.scan());
const config = { configFile: false, root, plugins: [
  { name: 'kernel-style-sources', enforce: 'pre', load(id) {
    if (id.replaceAll('\\', '/').endsWith('/src/styles/global.css')) return css;
  } }],
  resolve: { alias: { '@': path.join(root, 'src') } },
  build: { outDir: path.join(root, '.diag/editor-kernel/build'), emptyOutDir: true,
    rollupOptions: { input: [path.join(root, 'tests/fixtures/editor-kernel.html'), path.join(root, 'tests/fixtures/editor-host.html')] } },
  preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' };
console.log('Building kernel fixture');
await build(config);
const server = await preview(config);
let browser;
const results = [];
const check = async (name, run) => {
  console.log(`CHECK ${name}`);
  try { await run(); results.push({ name, passed: true }); }
  catch (error) { results.push({ name, passed: false, error: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
};
try {
  console.log('Starting kernel browser');
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-proxy-server'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
  page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
  page.on('requestfailed', request => console.error(`Request failed: ${request.url()} ${request.failure()?.errorText}`));
  const pendingRequests = new Set();
  page.on('request', request => pendingRequests.add(request.url()));
  page.on('requestfinished', request => pendingRequests.delete(request.url()));
  await page.route('**/api/editor-shortcuts', route => route.fulfill({ json: { bindings: {} } }));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/editor-kernel.html`, { waitUntil: 'commit' });
  console.log('Kernel page requested');
  const progress = setInterval(() => console.log(JSON.stringify({ loading: [...pendingRequests].slice(-12) })), 10000);
  try { await page.waitForFunction(() => window.kernel?.ready, null, { timeout: 60000 }); }
  catch (error) { console.error(JSON.stringify({ pendingRequests: [...pendingRequests], errors })); throw error; }
  finally { clearInterval(progress); }
  const load = async source => {
    await page.evaluate(s => window.kernel.load(s), source);
    await page.waitForFunction(() => window.kernel.ready);
    await page.evaluate(() => { const v = window.kernel.view(); v.dispatch({ selection: { anchor: v.state.doc.length } }); v.requestMeasure(); });
    await page.waitForTimeout(100);
  };
  const blocks = {
    quote: '> 第一块\n> 正文',
    nested: '> > 第一块\n> > 正文',
    callout: '> [!note] 第一块\n> 正文',
    folded: '> [!note]- 第一块\n> 正文',
    columns: ':::columns\n::column\n左侧\n::column\n右侧\n:::',
    collapse: ':::collapse\n- :+ 问题\n\n  答案\n:::',
    tabs: ':::tabs\n\n@tab 第一页\n\n第一页内容\n\n@tab 第二页\n\n第二页内容\n\n:::',
  };
  for (const [name, block] of Object.entries(blocks)) {
    for (const fraction of [0.02, 0.5, 0.98]) {
      await check(`${name} gap click ${fraction}`, async () => {
        const source = `${block}\n\n${block}\n\n尾部`;
        await load(source);
        const expected = block.length + 1;
        const point = await page.evaluate(({ expected, fraction }) => {
          const v = window.kernel.view();
          // Use the actual empty DOM line, not posAtCoords or a synthetic selection.
          const line = [...v.contentDOM.children].find(el => el.classList.contains('cm-line') && v.posAtDOM(el, 0) === expected);
          if (!line) throw new Error('Missing empty line');
          const rect = line.getBoundingClientRect();
          return { x: rect.left + rect.width * fraction, y: rect.top + rect.height / 2 };
        }, { expected, fraction });
        await page.mouse.click(point.x, point.y);
        assert.equal(await page.evaluate(() => window.kernel.snapshot().head), expected);
        await page.keyboard.insertText('定位');
        assert.equal(await page.evaluate(() => window.kernel.snapshot().source), source.slice(0, expected) + '定位' + source.slice(expected));
      });
    }
  }
  for (const [source, expected] of [
    ['**粗体内的 *斜体* 内容**', '粗体内的 斜体 内容'],
    [String.raw`\*不是斜体\*`, '*不是斜体*'],
    ['``a ` **b**``', 'a ` **b**'],
  ]) await check(`inline ${source}`, async () => {
    await load(`${source}\n\n尾部`);
    assert.equal(await page.locator('#root > main > div .cm-content').first().locator(':scope > .cm-line').first().innerText(), expected);
  });
  await check('table composition pauses longer than debounce', async () => {
    const source = '| A | B |\n| --- | --- |\n| x | y |\n\n尾部';
    await load(source);
    const cell = page.locator('.md-table-widget tbody td').first();
    await cell.click();
    await page.keyboard.press('End');
    await page.evaluate(() => window.originalCell = document.activeElement);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.imeSetComposition', { text: '中文', selectionStart: 2, selectionEnd: 2 });
    await page.waitForTimeout(450);
    await page.evaluate(() => {
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));
      window.kernel.flush();
    });
    assert.equal(await page.evaluate(() => window.originalCell === document.activeElement), true, 'Composition cell must not be rebuilt');
    assert.equal(await page.evaluate(() => window.kernel.snapshot().source), source, 'Do not persist provisional IME text');
    await cdp.send('Input.insertText', { text: '中文' });
    await page.waitForFunction(() => window.kernel.snapshot().source.includes('x中文'));
    await page.waitForTimeout(350);
    const snapshot = await page.evaluate(() => window.kernel.snapshot());
    assert.ok(snapshot.source.includes('| x中文 | y |'), snapshot.source);
    assert.equal(snapshot.undoDepth, 1);
    await page.evaluate(() => window.kernel.undo());
    assert.equal(await page.evaluate(() => window.kernel.snapshot().source), source);
    await cdp.detach();
  });
  const clickGap = async () => {
    const before = await page.evaluate(() => window.kernel.snapshot().source);
    const point = await page.evaluate(() => {
      const v = window.kernel.view();
      const line = [...v.contentDOM.children].find(el => el.classList.contains('cm-line') && el.textContent === '');
      const rect = line.getBoundingClientRect();
      const expected = v.posAtDOM(line, 0), x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
      return { expected, x, y, model: v.coordsAtPos(expected), hit: v.posAtCoords({ x, y }) };
    });
    console.log(JSON.stringify({ dynamicGap: point }));
    await page.mouse.click(point.x, point.y);
    assert.equal(await page.evaluate(() => window.kernel.snapshot().head), point.expected);
    await page.keyboard.insertText('变高后');
    assert.equal(await page.evaluate(() => window.kernel.snapshot().source), before.slice(0, point.expected) + '变高后' + before.slice(point.expected));
  };
  await check('cancelled table composition leaves source and history unchanged', async () => {
    const source = '| A | B |\n| --- | --- |\n| x | y |\n\n尾部';
    await load(source);
    await page.locator('.md-table-widget tbody td').first().click();
    await page.keyboard.press('End');
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.imeSetComposition', { text: '候选', selectionStart: 2, selectionEnd: 2 });
    await page.waitForTimeout(450);
    await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 });
    await page.waitForTimeout(400);
    assert.deepEqual(await page.evaluate(() => ({ source: window.kernel.snapshot().source, undoDepth: window.kernel.snapshot().undoDepth })), { source, undoDepth: 0 });
    await cdp.detach();
  });
  await check('table Tab and Enter retain cell navigation and row insertion', async () => {
    await load('| A | B |\n| --- | --- |\n| x | y |\n\n尾部');
    await page.locator('.md-table-widget tbody td').first().click();
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.textContent), 'y');
    await page.keyboard.press('Tab');
    await page.waitForFunction(() => document.querySelectorAll('.md-table-widget tbody tr').length === 2);
    await page.keyboard.insertText('新行');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelectorAll('.md-table-widget tbody tr').length === 3);
    assert.ok((await page.evaluate(() => window.kernel.snapshot().source)).includes('新行'));
  });
  await check('visual/source switch keeps editor identity, content and undo', async () => {
    await load('**开头**\n\n尾部');
    await page.evaluate(() => { window.originalView = window.kernel.view(); window.originalView.focus(); });
    await page.keyboard.insertText('历史');
    const snapshot = await page.evaluate(() => window.kernel.snapshot());
    await page.evaluate(() => window.kernel.mode(true));
    await page.waitForFunction(() => !document.querySelector('.cm-lp-strong'));
    assert.equal(await page.evaluate(() => window.originalView === window.kernel.view()), true);
    await page.evaluate(() => window.kernel.mode(false));
    await page.waitForFunction(() => !!document.querySelector('.cm-lp-strong'));
    assert.deepEqual(await page.evaluate(() => window.kernel.snapshot()), snapshot);
    await page.evaluate(() => window.kernel.undo());
    assert.equal(await page.evaluate(() => window.kernel.snapshot().source), '**开头**\n\n尾部');
  });
  await check('callout fold height remeasurement', async () => {
    await load(`${blocks.callout}\n\n${blocks.callout}\n\n尾部`);
    await page.getByRole('button', { name: '收起', exact: true }).first().click();
    await page.waitForTimeout(100);
    await clickGap();
    await page.getByRole('button', { name: '展开', exact: true }).first().click();
    await page.waitForTimeout(100);
    assert.equal(await page.locator('.cm-callout-widget .callout-body').first().isVisible(), true);
  });
  await check('columns add/edit/remove and gap placement', async () => {
    await load(`${blocks.columns}\n\n${blocks.columns}\n\n尾部`);
    await page.getByRole('button', { name: '添加一栏', exact: true }).first().click();
    const panes = page.locator('.cm-columns-widget').first().locator('.cm-column-host .cm-content');
    assert.equal(await panes.count(), 3);
    await panes.nth(2).click();
    await page.keyboard.insertText('第三栏保留');
    await page.waitForFunction(() => window.kernel.snapshot().source.includes('第三栏保留'));
    await page.getByRole('button', { name: '合并移除', exact: true }).nth(2).click();
    assert.equal(await panes.count(), 2);
    assert.ok((await page.evaluate(() => window.kernel.snapshot().source)).includes('第三栏保留'));
    await page.waitForTimeout(100);
    await clickGap();
  });
  await check('tabs and collapse child editing remain available', async () => {
    await load(`${blocks.tabs}\n\n尾部`);
    await page.getByRole('tab', { name: '第二页', exact: true }).click();
    await page.locator('.cm-visual-body .cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText('追加');
    await page.waitForFunction(() => window.kernel.snapshot().source.includes('第二页内容追加'));
    await load(`${blocks.collapse}\n\n尾部`);
    await page.locator('.cm-visual-body .cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText('补充解析');
    await page.waitForFunction(() => window.kernel.snapshot().source.includes('答案补充解析'));
    await page.locator('.md-collapse-panel-title').click();
    await page.waitForTimeout(100);
    assert.equal(await page.locator('details.md-collapse-panel').evaluate(el => el.open), false);
    await page.locator('.md-collapse-panel-title').click();
    assert.equal(await page.locator('details.md-collapse-panel').evaluate(el => el.open), true);
  });
  await check('project inline extensions and manual interactive HTML', async () => {
    const source = '<u>下划线</u> :spoiler[秘密] :note[提示] ==primary:高亮== $x^2$ [^a]\n\n[^a]: 脚注\n\n- [ ] 任务\n\n```html-interactive title=演示\n<!doctype html><html><body>演示</body></html>\n```\n\n尾部';
    await load(source);
    for (const selector of ['.cm-wy-underline', '.cm-wy-spoiler', '.cm-wy-inline-note', '.cm-lp-hl', '.cm-wy-math-inline', '.cm-wy-checkbox', '.cm-interactive-html']) {
      assert.ok(await page.locator(selector).count(), selector);
    }
    assert.equal(await page.locator('iframe').count(), 0, 'Interactive code must remain manual');
    assert.equal(await page.evaluate(() => window.kernel.snapshot().source), source);
    await page.locator('.cm-wy-checkbox').click();
    await page.waitForFunction(() => window.kernel.snapshot().source.includes('- [x] 任务'));
  });
  const stableFold = async (source, selector) => {
    await load(source);
    await page.evaluate(() => { const v = window.kernel.view(); v.dispatch({ selection: { anchor: 0 } }); v.focus(); v.scrollDOM.scrollTop = 0; });
    await page.mouse.move(600, 420);
    let previous = 0;
    for (let step = 0; step < 8; step++) {
      await page.mouse.wheel(0, 450); await page.waitForTimeout(200);
      const top = await page.evaluate(() => window.kernel.view().scrollDOM.scrollTop);
      assert.ok(top >= previous, 'Ordinary downward scrolling must not jump backwards'); previous = top;
    }
    const point = await page.evaluate(selector => {
      const viewport = window.kernel.view().scrollDOM.getBoundingClientRect();
      const control = [...document.querySelectorAll(selector)].find(el => { const r = el.getBoundingClientRect(); return r.top > viewport.top + 8 && r.bottom < viewport.bottom - 8; });
      if (!control) throw Error('No fold control in the middle of the long document: ' + JSON.stringify({ top: window.kernel.view().scrollDOM.scrollTop, height: window.kernel.view().scrollDOM.scrollHeight, controls: [...document.querySelectorAll(selector)].map(el => el.getBoundingClientRect().top) }));
      const rect = control.getBoundingClientRect(); return { x: rect.left + 5, y: rect.top + 5 };
    }, selector);
    for (let toggle = 0; toggle < 4; toggle++) {
      const before = await page.evaluate(() => ({ top: window.kernel.view().scrollDOM.scrollTop, y: window.scrollY }));
      await page.mouse.click(point.x, point.y); await page.waitForTimeout(300);
      const after = await page.evaluate(() => ({ top: window.kernel.view().scrollDOM.scrollTop, y: window.scrollY }));
      assert.ok(Math.abs(after.top - before.top) < 8, `Folding below the viewport anchor moved ${after.top - before.top}px`);
      assert.ok(Math.abs(after.y - before.y) < 2, 'Folding must not scroll the page');
      assert.equal(await page.evaluate(() => window.kernel.snapshot().source), source, 'View-only folding must not modify Markdown');
    }
  };
  const longBody = Array.from({ length: 8 }, (_, i) => `正文 ${i}：保持视口位置`).join('\n');
  await check('long callout scrolling and repeated fold/unfold keep viewport', async () => {
    const source = Array.from({ length: 35 }, (_, i) => `## 小节 ${i}\n\n> [!note]+ 块 ${i}\n${longBody.split('\n').map(line => '> ' + line).join('\n')}\n\n结束 ${i}`).join('\n\n');
    await stableFold(source, '.cm-callout-widget .callout-title button');
  });
  await check('long collapse scrolling and repeated fold/unfold keep viewport', async () => {
    const source = Array.from({ length: 35 }, (_, i) => `## 小节 ${i}\n\n:::collapse\n- :+ 问题 ${i}\n\n${longBody.split('\n').map(line => '  ' + line).join('\n')}\n:::\n\n结束 ${i}`).join('\n\n');
    await stableFold(source, '.cm-visual-collapse summary');
  });
  await check('nested callout resizing preserves the outer columns viewport', async () => {
    const source = Array.from({ length: 35 }, (_, i) => `## 小节 ${i}\n\n:::columns\n::column\n> [!note]+ 块 ${i}\n${longBody.split('\n').map(line => '> ' + line).join('\n')}\n::column\n右侧 ${i}\n:::\n\n结束 ${i}`).join('\n\n');
    await stableFold(source, '.cm-callout-widget .callout-title button');
  });
  if (process.env.EDITOR_SCROLL_FIXTURE) await check('read-only actual 408 sample scroll/fold stability', async () => {
    await stableFold(readFileSync(process.env.EDITOR_SCROLL_FIXTURE, 'utf8'), '.cm-callout-widget .callout-title button');
  });

  const hostSource = '> [!note] 第一块\n> 第一块正文\n\n> [!note] 第二块\n> 第二块正文\n\n尾部正文';
  await page.route('**/api/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    const note = { id: 'study', title: '回归记录', content: hostSource, tags: [], syncRevision: 'test-revision' };
    if (pathname === '/api/editor-shortcuts') return route.fulfill({ json: { bindings: {} } });
    if (pathname.startsWith('/api/quick-notes/')) return route.fulfill({ json: { note } });
    if (pathname === '/api/diary') return route.fulfill({ json: { diary: { date: '2026-10-12', title: '回归日记', content: hostSource, contentHtml: '<p>测试</p>' } } });
    if (pathname.startsWith('/api/articles/') || pathname.startsWith('/api/doc/nodes/')) return route.fulfill({ json: { article: note, node: note, contentHash: 'test-hash' } });
    return route.fulfill({ json: { html: '<p>测试</p>', toc: [], blocks: [] } });
  });
  for (const kind of ['home', 'doc', 'calendar', 'quick']) await check(`actual ${kind} host callout gap`, async () => {
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/editor-host.html?kind=${kind}`);
    await page.waitForFunction(() => window.hostKernel);
    if (kind === 'home' || kind === 'doc') {
      await page.waitForFunction(() => typeof window.__docInlineEditor?.open === 'function');
      await page.locator('#doc-inline-edit').click();
    }
    if (kind === 'calendar') {
      await page.evaluate(() => { window.__diaryPending = { date: '2026-10-12' }; window.dispatchEvent(new CustomEvent('diary:open', { detail: window.__diaryPending })); });
      await page.getByRole('button', { name: '编辑', exact: true }).click();
    }
    if (kind === 'quick') await page.evaluate(() => {
      window.__quickNotePending = { id: 'study' };
      window.dispatchEvent(new CustomEvent('quick-notes:open', { detail: { id: 'study' } }));
    });
    await page.locator('.cm-callout-widget').nth(1).waitFor();
    const expected = hostSource.indexOf('\n\n') + 1;
    await page.evaluate(() => { const v = window.hostKernel.view(); v.dispatch({ selection: { anchor: v.state.doc.length } }); v.requestMeasure(); });
    await page.waitForTimeout(100);
    const point = await page.evaluate(expected => {
      const v = window.hostKernel.view();
      const line = [...v.contentDOM.children].find(el => el.classList.contains('cm-line') && v.posAtDOM(el, 0) === expected);
      const rect = line.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }, expected);
    await page.mouse.click(point.x, point.y);
    assert.equal(await page.evaluate(() => window.hostKernel.view().state.selection.main.head), expected);
    await page.keyboard.insertText('入口定位');
    assert.equal(await page.evaluate(() => window.hostKernel.view().state.doc.toString()), hostSource.slice(0, expected) + '入口定位' + hostSource.slice(expected));
  });
  for (const kind of ['home', 'doc']) await check(`actual ${kind} host reconciles an already-saved draft before new input`, async () => {
    let persisted = '已经保存的正文', rejected = 0;
    const url = kind === 'doc' ? '/api/doc/nodes/study' : '/api/articles/study';
    const version = value => createHash('sha256').update(value).digest('hex');
    const handler = async route => {
      if (route.request().method() === 'PATCH') {
        const body = route.request().postDataJSON();
        if (body.expectedContentHash !== version(persisted) && body.content !== persisted) { rejected++; return route.fulfill({ status: 409, json: { error: '正文已变化' } }); }
        persisted = body.content;
      }
      return route.fulfill({ json: { article: { content: persisted }, node: { content: persisted }, contentHash: version(persisted) } });
    };
    await page.route('**' + url, handler);
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/editor-host.html?kind=${kind}`);
    await page.waitForFunction(() => typeof window.__docInlineEditor?.open === 'function');
    await page.evaluate(({ url, content, oldHash }) => localStorage.setItem('byqx:pending-article:' + url + ':content', JSON.stringify({ url, body: { content, expectedContentHash: oldHash } })), { url, content: persisted, oldHash: version('旧版本') });
    await page.locator('#doc-inline-edit').click(); await page.waitForFunction(() => document.getElementById('doc-3col').dataset.editing === 'true');
    await page.locator('.doc-ie-view .cm-content').fill('单窗口的新修改');
    await page.waitForFunction(() => !Object.keys(localStorage).some(key => key.endsWith('/study:content')));
    assert.equal(persisted, '单窗口的新修改'); assert.equal(rejected, 0);
    assert.equal(await page.locator('.doc-ie-host [role="alert"]').count(), 0);
    await page.unroute('**' + url, handler);
  });
  for (const kind of ['home', 'doc']) await check(`actual ${kind} host reloads text when its own save finishes during opening`, async () => {
    let persisted = '保存前正文';
    const url = kind === 'doc' ? '/api/doc/nodes/study' : '/api/articles/study';
    const version = value => createHash('sha256').update(value).digest('hex');
    const handler = async route => {
      if (route.request().method() === 'PATCH') {
        const body = route.request().postDataJSON();
        if (body.expectedContentHash !== version(persisted)) return route.fulfill({ status: 409, json: { error: '正文已变化' } });
        persisted = body.content;
      }
      return route.fulfill({ json: { article: { content: persisted }, node: { content: persisted }, contentHash: version(persisted) } });
    };
    await page.route('**' + url, handler);
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/editor-host.html?kind=${kind}`);
    await page.waitForFunction(() => typeof window.__docInlineEditor?.open === 'function');
    await page.evaluate(({ url, hash }) => {
      window.hostKernel.version(url, hash);
      const digest = crypto.subtle.digest.bind(crypto.subtle);
      let intercepted = false;
      crypto.subtle.digest = async (...args) => {
        const result = await digest(...args);
        if (!intercepted && new TextDecoder().decode(args[1]) === '保存前正文') {
          intercepted = true;
          await window.hostKernel.save(url, { content: '打开期间完成保存的正文' });
        }
        return result;
      };
    }, { url, hash: version(persisted) });
    await page.locator('#doc-inline-edit').click(); await page.waitForFunction(() => document.getElementById('doc-3col').dataset.editing === 'true');
    assert.equal(await page.evaluate(() => window.hostKernel.view().state.doc.toString()), '打开期间完成保存的正文');
    await page.locator('.doc-ie-view .cm-content').fill('打开期间完成保存的正文，加上新修改');
    await page.waitForFunction(() => !Object.keys(localStorage).some(key => key.endsWith('/study:content')));
    assert.equal(persisted, '打开期间完成保存的正文，加上新修改');
    assert.equal(await page.locator('.doc-ie-host [role="alert"]').count(), 0);
    await page.unroute('**' + url, handler);
  });
  await check('browser exceptions', async () => assert.deepEqual(errors, []));
  const output = path.join(root, 'outputs/editor-kernel');
  mkdirSync(output, { recursive: true });
  writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ passed: results.filter(r => r.passed).length, failed: results.filter(r => !r.passed) }, null, 2));
  assert.equal(results.filter(r => !r.passed).length, 0, 'Editor kernel regressions failed');
} finally {
  await browser?.close();
  await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
}
