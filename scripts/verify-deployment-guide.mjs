import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
const output = path.resolve(import.meta.dirname, '../outputs/deployment-guide-review');
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--no-proxy-server'] });
const results = [];
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const response = await page.goto('http://127.0.0.1:4390/deploy/'); assert.equal(response.status(), 200);
  await page.waitForFunction(() => document.getElementById('check-count').textContent === '完成检查 0 / 6');
  const missing = await page.evaluate(() => Array.from(document.querySelectorAll('a[href^="#"]')).filter(a => !document.getElementById(a.hash.slice(1))).map(a => a.hash));
  assert.deepEqual(missing, []); results.push('All tutorial anchors resolve');
  await page.locator('[data-check="local"]').check(); await page.reload();
  assert.equal(await page.locator('[data-check="local"]').isChecked(), true); results.push('Checklist persists across reloads');
  await page.locator('#reset-checks').click(); assert.equal(await page.locator('[data-check="local"]').isChecked(), false);
  await page.locator('details').first().locator('summary').click(); await page.locator('details').first().locator('.copy').click();
  await page.waitForFunction(() => document.getElementById('guide-feedback').textContent === '已复制命令'); results.push('Command copy provides visible feedback');
  for (const [width, height] of [[1280, 900], [390, 844]]) {
    await page.setViewportSize({ width, height }); await page.goto('http://127.0.0.1:4390/deploy/');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `No overflow at ${width}`);
    await page.screenshot({ path: path.join(output, `guide-${width}.png`) }); results.push(`${width}px viewport has no horizontal overflow`);
    await page.locator('.hero-actions a').nth(1).click(); await page.waitForFunction(() => location.hash === '#web');
    await page.waitForFunction(() => { const top = document.getElementById('web').getBoundingClientRect().top; return top >= 70 && top < 160; });
    const top = await page.locator('#web').evaluate(el => el.getBoundingClientRect().top);
    assert.ok(top >= 70 && top < height, `Heading is below sticky header: ${top}`);
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior), 'auto'); results.push('Reduced motion disables smooth scrolling');
  assert.deepEqual(errors, []); results.push('No browser script errors');
  fs.writeFileSync(path.join(output, 'latest.json'), JSON.stringify({ results, errors }, null, 2));
  console.log('DEPLOYMENT_GUIDE_OK ' + results.length);
} finally { await browser.close(); }
