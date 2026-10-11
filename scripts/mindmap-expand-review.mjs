import assert from 'node:assert/strict';

/** Real mouse events: editing used to destroy the pressed expand button. */
export async function reviewExpand({context,page,base,record}) {
  const tree={layout:'catalogOrganization',root:{data:{uid:'expand-root',text:'展开按钮回归'},children:[
    ...['F2','Space','DoubleClick'].map(key=>({data:{uid:`parent-${key}`,text:`名称编辑 ${key}`,expand:false},children:[{data:{text:`下级 ${key}`}}]})),
    {data:{uid:'expand-code',text:'**代码卡片**\n\n```js\nconst x = 1;\nconst y = 2;\n```',expand:false},children:[{data:{text:'代码子主题'}}]}
  ]}};
  const response=await context.request.post(`${base}/api/mindmaps`,{headers:{Origin:base,'User-Agent':'ExpandReview'},data:{title:'按钮事件隔离验收',data:tree}});
  assert.ok(response.ok(),await response.text());const {map}=await response.json();
  await page.goto(`${base}/mindmaps?id=${map.id}`);
  await page.locator('.smm-node [data-map-node="expand-code"] pre').waitFor();
  await page.getByRole('button',{name:'适应',exact:true}).click();
  const inline=page.locator('.smm-node-edit-wrap');
  for(const key of ['F2','Space','DoubleClick']) {
    const group=page.locator('.smm-node').filter({hasText:`名称编辑 ${key}`}).first(), button=group.locator('.smm-expand-btn');
    const child=page.locator('.smm-node').filter({hasText:`下级 ${key}`});
    for(let cycle=0;cycle<2;cycle++) {
      await group.click({position:{x:10,y:10}});
      if(key==='DoubleClick')await group.dblclick({position:{x:10,y:10}});
      else await page.keyboard.press(key);
      await inline.waitFor({state:'visible'});
      await button.click({delay:150});
      await child.waitFor();
      await inline.waitFor({state:'hidden'});
      assert.equal((await button.textContent()).trim(),'','first click expands during editing');
      await button.click({delay:150});await child.waitFor({state:'detached'});
      assert.equal((await group.textContent()).includes(`名称编辑 ${key}`),true,'name is preserved');
    }
  }
  record('Circular controls expand on the first click after F2, Space and double-click editing; collapse works over six cycles');
  const code=page.locator('.smm-node [data-map-node="expand-code"]');
  const group=code.locator('xpath=../..'),button=group.locator('.smm-expand-btn');
  for(let cycle=0;cycle<3;cycle++) {
    await code.click({position:{x:10,y:10}});
    await button.click({delay:150});await page.locator('.smm-node').filter({hasText:'代码子主题'}).waitFor();
    await code.locator('[data-code-toggle]').click();
    assert.equal(await code.locator('pre > code').isVisible(),false);
    await code.locator('[data-code-toggle]').click();
    assert.equal(await code.locator('pre > code').isVisible(),true);
    await button.click({delay:150});await page.locator('.smm-node').filter({hasText:'代码子主题'}).waitFor({state:'detached'});
  }
  record('Selected Markdown card controls remain clickable across three branch and code collapse cycles');
  await page.getByRole('button',{name:'保存',exact:true}).click();
  await page.getByRole('status').filter({hasText:'已保存'}).waitFor();
  await page.reload();await page.locator('.smm-node [data-map-node="expand-code"]').waitFor();
  assert.equal(await page.locator('.smm-node').filter({hasText:'下级 F2'}).count(),0);
  record('Collapsed branches and unchanged names survive save and reload');
}
