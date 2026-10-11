/** Regression checks against real rendered Markdown, without business data. */
import assert from 'node:assert/strict';
import path from 'node:path';

export const collapseCode = Array.from({length:18}, (_, i) => `const value${i} = ${i}; // 第 ${i + 1} 行`).join('\n');
export const collapseMarkdown = `# 折叠验收\n\n\`\`\`js\n${collapseCode}\n\`\`\`\n\n> [!NOTE]+ 引用中的代码\n> \`\`\`js\n${collapseCode.split('\n').map(line => '> ' + line).join('\n')}\n> \`\`\`\n`;

export async function reviewCollapse({context, page, base, output, sourceUrls, record, captureScreenshots = true}) {
  for (const url of sourceUrls) {
    await page.goto(base + url);
    const blocks = page.locator('main article.prose pre.code-block:has([data-code-toggle])');
    await blocks.first().waitFor();
    assert.equal(await blocks.count(), 2, 'both fenced and callout code are rendered');
    for (const width of [1440, 390]) {
      await page.setViewportSize({width, height:1000});
      for (const dark of [false, true]) {
        await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), dark);
        for (let index = 0; index < 2; index++) {
          const block = blocks.nth(index), body = block.locator(':scope > code');
          await block.locator('[data-code-toggle]').click();
          assert.equal(await body.isVisible(), false, 'no code lines remain visible');
          assert.ok(await block.evaluate(el => el.offsetHeight <= 60), 'collapsed toolbar has compact height');
          assert.equal(await block.locator('[data-code-toggle]').getAttribute('aria-expanded'), 'false');
          const copied = await block.evaluate(async el => {
            let copied;
            Object.defineProperty(navigator, 'clipboard', {configurable:true, value:{writeText:async text => { copied = text; }}});
            el.querySelector('[data-copy]').click();
            await Promise.resolve(); return copied;
          });
          assert.equal(copied.trim(), collapseCode);
          await page.emulateMedia({media:'print'});
          assert.equal(await body.isVisible(), true, 'print restores full code');
          assert.equal(await block.locator('[data-code-toggle]').isVisible(), false);
          await page.emulateMedia({media:'screen'});
          assert.equal(await body.isVisible(), false, 'screen retains collapsed state');
          await block.locator('[data-code-toggle]').click();
          assert.equal(await body.isVisible(), true);
          assert.equal((await body.textContent()).trim(), collapseCode);
        }
      }
    }
    record(`Full collapse, copy, expand and print in ${url}: desktop/mobile, light/dark, fenced/callout code`);
  }
  await page.setViewportSize({width:1440,height:1000});
  const tree = {root:{data:{uid:'collapse-root',text:'交互验收'},children:[
    {data:{uid:'code',text:'**代码**\n\n```js\n' + collapseCode + '\n```',customTextWidth:820},children:[{data:{uid:'child',text:'下级主题'}}]},
    {data:{uid:'md',text:'**Markdown 名称** $a^2$'}},
    {data:{uid:'plain',text:'普通名称'}}
  ]},layout:'logicalStructure'};
  const created = await context.request.post(base + '/api/mindmaps',{headers:{Origin:base,'User-Agent':'CollapseReview'},data:{title:'折叠与节点交互隔离验收',data:tree}});
  assert.ok(created.ok(), await created.text()); const {map} = await created.json();
  await page.goto(`${base}/mindmaps?id=${map.id}`);
  const code = page.locator('.smm-node [data-map-node="code"]');
  const md = page.locator('.smm-node [data-map-node="md"]');
  const plain = page.locator('.smm-node').filter({hasText:'普通名称'});
  await code.locator('pre > code').waitFor(); await md.waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole('button',{name:'适应',exact:true}).click();
  const initial = await code.evaluate(el => Number(el.closest('foreignObject').getAttribute('height')));
  for (let i = 0; i < 3; i++) {
    await code.locator('[data-code-toggle]').click();
    await page.waitForFunction(() => {
      const root = document.querySelector('.smm-node [data-map-node="code"]');
      return Number(root.closest('foreignObject').getAttribute('height')) < 150;
    });
    assert.equal(await code.locator('pre > code').isVisible(), false);
    if (i === 0 && captureScreenshots) await page.screenshot({path:path.join(output,'mindmap-code-collapsed.png')});
    await code.locator('[data-code-toggle]').click();
    await page.waitForFunction(height => Number(document.querySelector('.smm-node [data-map-node="code"]').closest('foreignObject').getAttribute('height')) >= height - 1, initial);
    assert.equal(await code.locator('pre > code').isVisible(), true);
  }
  record('Mindmap code hides completely and node height restores over three collapse/expand cycles');

  // No unrelated Markdown roots should be replaced during another node's resize.
  await md.evaluate(el => { el.dataset.stabilityMarker = 'keep'; });
  await code.locator('[data-code-toggle]').click();
  await page.waitForTimeout(350);
  assert.equal(await md.getAttribute('data-stability-marker'), 'keep');
  const group = code.locator('xpath=../..');
  const toggle = group.locator('.smm-expand-btn'); await toggle.waitFor();
  await toggle.hover();
  await page.evaluate(() => {
    window.__collapseChurn = 0;
    window.__collapseObserver = new MutationObserver(list => {
      for (const mutation of list) for (const removed of mutation.removedNodes)
        if (removed.nodeType === 1 && (removed.matches?.('.map-node-markdown,.smm-expand-btn') || removed.querySelector?.('.map-node-markdown,.smm-expand-btn'))) window.__collapseChurn++;
    });
    window.__collapseObserver.observe(document.querySelector('.map-canvas > svg'),{subtree:true,childList:true});
  });
  await page.waitForTimeout(2000);
  assert.equal(await page.evaluate(() => window.__collapseChurn), 0, 'idle hover must not redraw nodes or flicker controls');
  await page.evaluate(() => window.__collapseObserver.disconnect());
  record('Unrelated cards remain mounted; expansion controls remain stable while hovered');

  await plain.click(); await page.keyboard.press('Space');
  const inline = page.locator('.smm-node-edit-wrap'); await inline.waitFor({state:'visible'});
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('Space');
  assert.match(await inline.textContent(), /\s$/, 'Space inside editing remains text input');
  await page.keyboard.press('Backspace'); await page.keyboard.press('Enter');
  await inline.waitFor({state:'hidden'});
  await page.keyboard.press('F2'); await inline.waitFor({state:'visible'});
  // A second rapid click is intentionally a double-click and reopens editing.
  await page.waitForTimeout(600);
  await plain.click({position:{x:5,y:5}});
  await inline.waitFor({state:'hidden'});
  await page.keyboard.press('Delete'); await plain.waitFor({state:'detached'});
  await page.waitForTimeout(150); // Engine batches history entries for 100 ms.
  await page.keyboard.press('Control+z'); await plain.waitFor();
  record('Space edits plain names; clicking an already active node exits editing, Delete and undo work');

  await md.click({position:{x:5,y:5}}); await page.keyboard.press('Space');
  const dialog = page.getByRole('dialog',{name:'编辑节点名称'}), textarea = page.getByRole('textbox',{name:'节点名称源码'});
  await dialog.waitFor(); assert.equal(await textarea.inputValue(), '**Markdown 名称** $a^2$');
  await textarea.fill('**修改后的名称** $a^2$');
  await page.keyboard.press('Control+Enter'); await dialog.waitFor({state:'detached'});
  await md.locator('strong').filter({hasText:'修改后的名称'}).waitFor();
  await code.click({button:'right',position:{x:5,y:5}});
  await page.getByRole('menuitem',{name:'编辑节点',exact:true}).click();
  await dialog.waitFor(); assert.ok((await textarea.inputValue()).includes(collapseCode));
  await textarea.focus(); await page.keyboard.press('Space'); await page.keyboard.press('Delete');
  assert.equal(await code.count(), 1, 'editing keys must not delete the node');
  await page.getByRole('button',{name:'取消',exact:true}).click();
  await dialog.waitFor({state:'detached'});
  await md.click({position:{x:5,y:5}}); await md.dblclick({position:{x:5,y:5}});
  await dialog.waitFor(); await page.getByRole('button',{name:'取消',exact:true}).click();
  await md.click({position:{x:5,y:5}}); await page.keyboard.press('Delete'); await md.waitFor({state:'detached'});
  await page.waitForTimeout(150);
  await page.keyboard.press('Control+z'); await md.waitFor();
  record('Space, double-click and context menu edit Markdown; editing protects nodes; Delete and undo restore them');
  await page.getByRole('button',{name:'保存',exact:true}).click();
  await page.getByRole('status').filter({hasText:'已保存'}).waitFor();
  await page.reload(); await page.locator('.smm-node [data-map-node="md"] strong').filter({hasText:'修改后的名称'}).waitFor();
  record('Edited Markdown survives save and reload');
}
