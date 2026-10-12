import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import { chromium } from 'playwright-core';

// Real pages, APIs, image transforms, storage client and SQLite; only upstream services are local fixtures.
const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'outputs/ai-random-cover');
fs.mkdirSync(out, { recursive: true });
const dbPath = path.join(out, `browser-${Date.now()}.db`);
const source = new Database(path.join(root, 'data/blog.db'), { readonly: true });
const db = new Database(dbPath);
for (const { sql } of source.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) db.exec(sql);
source.close();
const now = Date.now();
for (const id of ['random-cover-auto', 'random-cover-conflict']) db.prepare('INSERT INTO articles (id,title,slug,content,summary,type,tags,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id, '随机封面验收 PRIVATE_TITLE_SENTINEL', id, 'PRIVATE_CONTENT_SENTINEL', 'PRIVATE_SUMMARY_SENTINEL', 'note', '[]', now, now);
const original = db.prepare('SELECT title,content,summary FROM articles WHERE id=?').get('random-cover-auto');
const bitmap = await sharp({ create: { width: 1536, height: 1024, channels: 3, background: '#b3cdd3' } }).png().toBuffer();
const scene = 'An original traveler watches the hills from a small wooden balcony above a quiet lake. Soft evening light highlights a linen backpack, with layered mountains and subtle cloud reflections in teal, cream and warm gold.';
const textRequests = [], imageRequests = [], objects = new Map();
let holdImage, imageStarted;
const mock = http.createServer(async (req, res) => {
  try {
    const chunks = []; for await (const part of req) chunks.push(part);
    const body = Buffer.concat(chunks);
    const url = new URL(req.url, 'http://local');
    if (req.method === 'PUT' && url.pathname.startsWith('/s3/cover-test/')) {
      objects.set(url.pathname.replace('/s3/cover-test/', ''), body); res.writeHead(200); res.end(); return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/assets/')) {
      const stored = objects.get(url.pathname.replace('/assets/', '')); res.writeHead(stored ? 200 : 404, { 'content-type': 'image/webp' }); res.end(stored); return;
    }
    const data = JSON.parse(body.toString());
    if (url.pathname === '/v1/chat/completions') {
      textRequests.push(data);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ id: 'mock-text', choices: [{ index: 0, delta: { role: 'assistant', content: scene }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: 'mock-text', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`); return;
    }
    if (url.pathname === '/v1/images/generations') {
      imageRequests.push(data); imageStarted?.(); if (holdImage) await holdImage;
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: [{ b64_json: bitmap.toString('base64') }] })); return;
    }
    res.writeHead(404); res.end();
  } catch (error) { res.writeHead(500); res.end(String(error)); }
});
await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
const mockBase = `http://127.0.0.1:${mock.address().port}`;
db.prepare('INSERT INTO settings (key,value,updated_at) VALUES (?,?,?)').run('ai_config', JSON.stringify({ enabled: true, connectionMode: 'api', baseUrl: `${mockBase}/v1`, apiKey: 'local-fixture', model: 'mock-text', imageProvider: 'openai', imageModel: 'mock-image' }), now);
const portProbe = http.createServer(); await new Promise(resolve => portProbe.listen(0, '127.0.0.1', resolve));
const port = portProbe.address().port; await new Promise(resolve => portProbe.close(resolve));
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, ASTRO_DEV_BACKGROUND: '1', DESKTOP: '1', DESKTOP_MODE: '1', HOST: '127.0.0.1', PORT: String(port), DATABASE_URL: `file:${dbPath}`, DATABASE_URL_FALLBACK: '', AUTH_SECRET: 'random-cover-isolated-browser-test', TOP_ADMIN_PASSWORD: 'random-cover-test', BYQX_PI_AUTH_PATH: path.join(out, 'browser-pi-auth.json'), R2_ACCOUNT_ID: 'local', R2_ACCESS_KEY_ID: 'local', R2_SECRET_ACCESS_KEY: 'local', R2_BUCKET: 'cover-test', R2_S3_ENDPOINT: `${mockBase}/s3`, R2_PUBLIC_BASE_URL: `${mockBase}/assets` };
const logs = [];
const launch = args => {
  const child = spawn(process.execPath, args, { cwd: root, windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', part => { logs.push(String(part)); fs.writeFileSync(path.join(out, 'browser-server.log'), logs.join('')); });
  child.stderr.on('data', part => { logs.push(String(part)); fs.writeFileSync(path.join(out, 'browser-server.log'), logs.join('')); });
  return child;
};
const dist = path.join(out, 'dist');
let app = launch([path.join(root, 'node_modules/astro/bin/astro.mjs'), 'build', '--outDir', dist]);
let browser;
const checks = [], errors = [];
try {
  console.log('COVER_BROWSER_BUILD_STARTED');
  const [code] = await once(app, 'exit');
  assert.equal(code, 0, logs.slice(-3).join(''));
  app = launch([path.join(dist, 'server/entry.mjs')]);
  const started = Date.now();
  while (true) {
    if (app.exitCode !== null) throw Error(`Preview exited: ${app.exitCode}`);
    try { const response = await fetch(`${base}/api/ai/cover`, { method: 'POST', body: '{}', signal: AbortSignal.timeout(2000) }); if ([401, 403].includes(response.status)) break; } catch { /* Wait for startup. */ }
    if (Date.now() - started > 60_000) throw Error('Preview startup timeout');
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  checks.push('guest denied cover API');
  console.log('COVER_BROWSER_SERVER_READY');
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  assert((await context.request.post(`${base}/api/admin-auth/login`, { data: { password: 'random-cover-test' } })).ok());
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/edit/random-cover-auto`);
  const button = page.getByRole('button', { name: 'AI 生成封面', exact: true });
  await button.click();
  await page.getByText('封面已生成并应用，可在文章设置或首页查看。', { exact: true }).waitFor();
  const firstCover = db.prepare('SELECT cover FROM articles WHERE id=?').get('random-cover-auto').cover;
  assert.match(firstCover, /^\/api\/images\//);
  assert.equal(await page.evaluate(() => sessionStorage.getItem('ai-cover:random-cover-auto')), null);
  assert.deepEqual(db.prepare('SELECT title,content,summary FROM articles WHERE id=?').get('random-cover-auto'), original);
  checks.push('UI generates, uploads, signs and automatically applies only cover');
  await page.getByRole('dialog', { name: '文章封面' }).screenshot({ path: path.join(out, 'browser-auto.png') });
  await page.keyboard.press('Escape');
  assert(await button.evaluate(element => document.activeElement === element));
  await page.locator('#home-article-settings').click();
  assert.equal(await page.getByLabel('封面地址', { exact: true }).inputValue(), firstCover);
  checks.push('cover-changed event updates article settings; Escape restores focus');
  await page.keyboard.press('Escape');

  await page.goto(`${base}/edit/random-cover-conflict`);
  let release;
  holdImage = new Promise(resolve => { release = resolve; });
  const generationStarted = new Promise(resolve => { imageStarted = resolve; });
  await page.getByRole('button', { name: 'AI 生成封面', exact: true }).click();
  await generationStarted;
  db.prepare('UPDATE articles SET content=? WHERE id=?').run('CONCURRENT_CHANGE_SENTINEL', 'random-cover-conflict');
  release(); holdImage = undefined; imageStarted = undefined;
  await page.getByText('生成期间文章或封面已变化。新封面已保留，请确认后再应用。', { exact: true }).waitFor();
  assert.equal(db.prepare('SELECT cover FROM articles WHERE id=?').get('random-cover-conflict').cover, null);
  const candidate = JSON.parse(await page.evaluate(() => sessionStorage.getItem('ai-cover:random-cover-conflict')));
  assert.match(candidate.url, /^\/api\/images\//);
  await page.getByRole('img', { name: 'AI 生成的文章封面预览' }).evaluate(image => image.decode());
  checks.push('concurrent edits retain a viewable candidate without overwriting cover');
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.getByRole('dialog', { name: '文章封面' }).screenshot({ path: path.join(out, 'browser-conflict-mobile.png') });
  checks.push('390px dialog has no horizontal overflow');
  await page.getByRole('button', { name: '确认应用此封面', exact: true }).click();
  await page.getByText('封面已生成并应用，可在文章设置或首页查看。', { exact: true }).waitFor();
  assert.equal(db.prepare('SELECT cover FROM articles WHERE id=?').get('random-cover-conflict').cover, candidate.url);
  assert.equal(db.prepare('SELECT content FROM articles WHERE id=?').get('random-cover-conflict').content, 'CONCURRENT_CHANGE_SENTINEL');
  checks.push('confirmed candidate applies cover and preserves concurrent content');

  assert.equal(textRequests.length, 2); assert.equal(imageRequests.length, 2); assert.equal(objects.size, 4);
  for (const request of [...textRequests, ...imageRequests]) for (const secret of ['PRIVATE_TITLE_SENTINEL', 'PRIVATE_CONTENT_SENTINEL', 'PRIVATE_SUMMARY_SENTINEL', 'CONCURRENT_CHANGE_SENTINEL']) assert(!JSON.stringify(request).includes(secret));
  for (const request of textRequests) assert.match(JSON.stringify(request), /范围：(动漫|风景|人物|插画)/);
  for (const request of imageRequests) { assert.equal(request.size, '1536x1024'); assert(request.prompt.includes(scene)); }
  for (const bytes of objects.values()) assert.equal((await sharp(bytes).metadata()).format, 'webp');
  assert.equal(errors.length, 0, errors.join('\n'));
  checks.push('article data absent from both upstreams; real WebP full/thumbnail stored');
  fs.writeFileSync(path.join(out, 'browser-report.json'), JSON.stringify({ checks, errors, upstreams: 'local fixtures', realDatabase: 'isolated SQLite', realUploads: 'local S3-compatible fixture' }, null, 2));
  console.log(`AI_RANDOM_COVER_BROWSER_PASS ${checks.length} checks`);
} finally {
  await browser?.close();
  const stopped = app.exitCode === null ? once(app, 'exit') : Promise.resolve();
  app.kill(); await stopped;
  await new Promise(resolve => mock.close(resolve)); db.close();
  fs.writeFileSync(path.join(out, 'browser-server.log'), logs.join(''));
}
