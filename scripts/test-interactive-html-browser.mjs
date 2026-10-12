/** Real built routes, isolated SQLite, Edge or real sandboxed Electron. No business DB. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import Database from 'better-sqlite3';
import {chromium, _electron} from 'playwright-core';
const root=path.resolve(import.meta.dirname,'..'), require=createRequire(import.meta.url);
const desktop=process.argv.includes('--desktop'), bundle=process.env.BYQX_DESKTOP_BUNDLE_DIR;
const payload=desktop&&bundle?path.join(root,'release',bundle,'resources/app'):root;
const output=path.join(root,'outputs/interactive-html',`${desktop?'desktop':'browser'}-${Date.now()}`);
fs.mkdirSync(output,{recursive:true});
const dbFile=path.join(output,'isolated.db');
fs.copyFileSync(path.join(root,'desktop/assets/template.db'),dbFile);
const samples=Object.fromEntries(['counter','sorting','formula'].map(name=>[name,fs.readFileSync(path.join(root,`skills/my-blog-interactive-html/assets/${name}.html`),'utf8')]));
const fence=(source,id)=>'```html-interactive id="'+id+'" title="'+id+'" height="360"\n'+source+'\n```';
const content='# 交互验收\n\n'+fence(samples.counter,'counter')+'\n\n## 排序\n\n'+fence(samples.sorting,'sorting')+'\n\n## 公式\n\n'+fence(samples.formula,'formula')+'\n\n:::tabs\n@tab 普通页\n没有演示\n@tab 演示页\n'+fence(samples.counter,'hidden')+'\n:::\n\n> [!NOTE]- 折叠中的演示\n'+fence(samples.counter,'folded').split('\n').map(line=>'> '+line).join('\n');
const db=new Database(dbFile), now=Date.now();
db.prepare('INSERT INTO articles (id,slug,title,type,content,summary,encrypted,created_at,updated_at) VALUES (?,?,?,?,?,?,0,?,?)').run('interactive-review','interactive-review','交互验收','note',content,'隔离示例',now,now);
db.prepare('INSERT INTO doc_categories (id,name,created_at,updated_at) VALUES (?,?,?,?)').run('interactive-category','验收',now,now);
db.prepare('INSERT INTO doc_bundles (id,category_id,name,created_at,updated_at) VALUES (?,?,?,?,?)').run('interactive-bundle','interactive-category','交互文档',now,now);
for(const id of ['interactive-doc','interactive-doc-two'])db.prepare('INSERT INTO doc_nodes (id,bundle_id,kind,title,content,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(id,'interactive-bundle','article',id,id.endsWith('two')?'# 新文章\n\n切换后不保留旧实例':content,now,now);
db.close();
const listener=net.createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
const base=`http://127.0.0.1:${port}`,password='isolated-interactive-review';
const env={...process.env,HOST:'127.0.0.1',PORT:String(port),DATABASE_URL:`file:${dbFile}`,DATABASE_URL_FALLBACK:'',SYNC_DATABASE_URL:'',SYNC_DATABASE_URL_FALLBACK:'',PUBLIC_SITE_URL:base,AUTH_SECRET:'isolated-interactive-auth',ADMIN_PASSWORD:password,TOP_ADMIN_PASSWORD:password,DESKTOP_MODE:'1',BYQX_CONFIG_PATH:path.join(output,'ai.json'),BYQX_PI_AUTH_PATH:path.join(output,'pi.json')};
delete env.ELECTRON_RUN_AS_NODE;delete env.BYQX_SMOKE;delete env.BYQX_CAPTURE;
const report={desktop,bundle,isolated:true,cases:[],errors:[]};const record=label=>{report.cases.push(label);console.log('PASS',label);};
let server,browser,app,context,page;
try{
 if(desktop){
  const appData=path.join(output,'appdata'),profile=path.join(output,'profile');fs.mkdirSync(path.join(appData,'byqx-blog-desktop'),{recursive:true});fs.mkdirSync(profile,{recursive:true});
  fs.writeFileSync(path.join(appData,'byqx-blog-desktop/config.json'),JSON.stringify({LOCAL_DB_PATH:dbFile,ADMIN_PASSWORD:password,TOP_ADMIN_PASSWORD:password,AUTH_SECRET:env.AUTH_SECRET,SYNC_DATABASE_URL:'postgres://unused:unused@127.0.0.1:1/isolated',PORT:String(port)}));
  const bootstrap=path.join(output,'bootstrap.cjs');
  fs.writeFileSync(bootstrap,`const electron=require('electron'),{app}=electron;const OriginalWindow=electron.BrowserWindow,hidden=Object.create(electron);Object.defineProperty(hidden,'BrowserWindow',{value:class extends OriginalWindow{constructor(options){super({...options,show:true,focusable:false,skipTaskbar:true,x:-10000,y:-10000,webPreferences:{...options.webPreferences,backgroundThrottling:false}});this.show=()=>{};this.focus=()=>{};}}});const Module=require('module'),load=Module._load;Module._load=function(request,parent,isMain){return request==='electron'?hidden:load.call(this,request,parent,isMain);};app.setPath('appData',${JSON.stringify(appData)});app.setPath('userData',${JSON.stringify(profile)});process.argv=[process.argv[0]];const main=${JSON.stringify(path.join(payload,'desktop/main.cjs'))};delete require.cache[require.resolve(main)];require(main);`);
  app=await _electron.launch({executablePath:bundle?path.join(root,'release',bundle,'白衣卿相.exe'):require('electron'),args:bundle?['--toolchain-runner',bootstrap]:[bootstrap],env,cwd:output,timeout:60000});
  page=await app.firstWindow();context=app.context();await page.waitForURL(`${base}/**`,{timeout:60000});
  const sandbox=await app.evaluate(({app,webContents},base)=>({noSandbox:app.commandLine.hasSwitch('no-sandbox'),gpuOff:app.commandLine.hasSwitch('disable-gpu-sandbox'),sandbox:webContents.getAllWebContents().find(contents=>contents.getURL().startsWith(base)).getLastWebPreferences().sandbox}),base);
  assert.deepEqual(sandbox,{noSandbox:false,gpuOff:false,sandbox:true});record('Real Electron starts with sandbox enabled and no disabling flags');
 }else{
  const log=fs.openSync(path.join(output,'server.log'),'a');server=spawn(process.execPath,[path.join(root,'dist/server/entry.mjs')],{cwd:root,env,stdio:['ignore',log,log],windowsHide:true});
  for(let i=0;i<100;i++){try{if((await fetch(base)).ok)break;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
  browser=await chromium.launch({channel:'msedge',headless:true});context=await browser.newContext({viewport:{width:1440,height:960}});page=await context.newPage();
 }
 page.on('pageerror',error=>report.errors.push(error.message));page.on('dialog',dialog=>dialog.accept().catch(error=>{if(!error.message.includes('No dialog is showing')&&!error.message.includes('closed'))report.errors.push(error.message);}));
 const headers={Origin:base,'User-Agent':'InteractiveAcceptance/1.0'};
 const login=await context.request.post(`${base}/api/admin-auth/login`,{data:{password},headers});assert.ok(login.ok());await context.addCookies((await context.cookies()).map(cookie=>({...cookie,secure:false})));
 await page.goto(`${base}/edit/interactive-review`);
 const card=id=>page.locator(`[data-interactive-card][data-interactive-id="${id}"]`);
 const run=async id=>{await card(id).scrollIntoViewIfNeeded();await card(id).locator('[data-interactive-status]').filter({hasText:'运行中'}).waitFor({timeout:15000});return card(id).frameLocator('iframe');};
 const counter=await run('counter');await counter.locator('#add').click();await counter.locator('#add').click();assert.equal(await counter.locator('#value').textContent(),'2');
 assert.equal(await card('counter').locator('iframe').getAttribute('sandbox'),'allow-scripts');
 const isolation=await counter.locator('body').evaluate(()=>{const blocked=fn=>{try{fn();return false;}catch{return true;}};return{cookie:blocked(()=>parent.document.cookie),storage:blocked(()=>localStorage.getItem('x')),desktop:typeof window.desktop,node:typeof window.require};});assert.deepEqual(isolation,{cookie:true,storage:true,desktop:'undefined',node:'undefined'});
 if(desktop)assert.equal(await page.evaluate(()=>typeof window.desktop.focusWindow),'function');
 record('Article auto-runs; scripts cannot access parent, storage, native bridge or Node');
 await card('counter').locator('[data-interactive-action=expand]').click();await counter.locator('#add').click();await counter.locator('#value').filter({hasText:'3'}).waitFor();await counter.locator('#add').press('Escape');await page.waitForFunction(()=>!document.querySelector('[data-interactive-id=counter]').dataset.expanded);assert.equal(await counter.locator('#value').textContent(),'3');
 await card('counter').locator('[data-interactive-action=run]').click();await counter.locator('#value').filter({hasText:'0'}).waitFor();record('Enlarge/Esc preserve one iframe; rerun resets its state');
 await card('counter').locator('[data-interactive-action=source]').click();assert.ok((await card('counter').locator('[data-interactive-source-view]').textContent()).includes('onclick'));
 await page.evaluate(()=>document.documentElement.dataset.mode='dark');await counter.locator('html').filter({has:counter.locator('body')}).waitFor();await page.waitForFunction(()=>true);assert.equal(await counter.locator('html').getAttribute('data-theme'),'dark');
 await page.evaluate(()=>document.documentElement.dataset.mode='light');
 const iframe=card('counter').locator('iframe');
 await page.evaluate(()=>{const frame=document.querySelector('[data-interactive-id=counter] iframe');postMessage({channel:'byqx-interactive',token:frame.name,type:'height',value:777},'*');});
 await page.waitForTimeout(150);assert.notEqual(await iframe.evaluate(element=>element.style.height),'777px');
 await counter.locator('body').evaluate(()=>parent.postMessage({channel:'byqx-interactive',token:window.name,type:'height',value:100000},'*'));await page.waitForFunction(()=>document.querySelector('[data-interactive-id=counter] iframe').style.height==='960px');
 await counter.locator('body').evaluate(()=>parent.postMessage({channel:'byqx-interactive',token:window.name,type:'height',value:-20},'*'));await page.waitForFunction(()=>document.querySelector('[data-interactive-id=counter] iframe').style.height==='200px');
 const network=await counter.locator('body').evaluate(async()=>{try{await fetch('https://example.invalid/no-network');return true;}catch{return false;}});assert.equal(network,false);await card('counter').locator('[data-interactive-errors]').waitFor({state:'visible'});
 await counter.locator('body').evaluate(()=>location.assign('about:blank'));await card('counter').locator('iframe').waitFor({state:'detached',timeout:12000});assert.ok((await card('counter').locator('[data-interactive-errors]').textContent()).includes('导航'));await card('counter').locator('[data-interactive-action=run]').click();await counter.locator('#value').waitFor();record('Spoofed messages rejected; height bounded; network and self-navigation stopped with feedback');
 assert.equal(await card('hidden').locator('iframe').count(),0);await page.locator('[role=tab]').filter({hasText:'演示页'}).click();await run('hidden');
 assert.equal(await card('folded').locator('iframe').count(),0);await card('folded').evaluate(element=>element.closest('details').open=true);await run('folded');record('Hidden Tabs and Callout start only after becoming visible; theme reaches iframe');
 const sorting=await run('sorting');for(let i=0;i<10;i++)await sorting.locator('#step').click();assert.deepEqual(await sorting.locator('.bar').allTextContents(),['1','2','3','4','5']);assert.ok((await sorting.locator('#status').textContent()).includes('10'));await sorting.locator('#reset').click();await sorting.locator('#play').click();await sorting.locator('#pause').click();
 const formula=await run('formula');await formula.locator('#x').fill('3');assert.ok((await formula.locator('#result').textContent()).includes('9.00'));await formula.locator('#reset').click();assert.ok((await formula.locator('#result').textContent()).includes('4.00'));record('Skill examples: counter, all bubble-sort steps and formula slider verified');
 for(const width of [1440,1024,390]){await page.setViewportSize({width,height:900});await card('counter').scrollIntoViewIfNeeded();assert.equal(await card('counter').evaluate(element=>element.scrollWidth<=element.clientWidth+1),true);await page.screenshot({path:path.join(output,`${width}.png`)});}record('1440/1024/390 layouts avoid interactive card overflow');
 await page.setViewportSize({width:1440,height:960});
 const preview=await context.request.post(`${base}/api/articles/preview`,{data:{source:fence(samples.counter,'preview')},headers});assert.ok(preview.ok());assert.equal((await preview.json()).interactiveBlocks[0].title,'preview');
 await page.locator('#doc-inline-edit').click();await page.locator('.cm-editor').first().waitFor();await page.locator('.cm-interactive-html').first().scrollIntoViewIfNeeded();assert.equal(await page.locator('.cm-interactive-html iframe').count(),0);await page.locator('.cm-interactive-html').first().getByRole('button',{name:'运行预览'}).click();await page.locator('.cm-interactive-html iframe').first().waitFor();record('Inline editor is manual; preview API returns source metadata');
 const editor=page.locator('.cm-editor').first();await editor.locator('.cm-line').first().click({button:'right'});await page.getByRole('menuitem',{name:'段落设置'}).click();
 const chooser=page.waitForEvent('filechooser');await page.getByRole('menuitem',{name:'导入 HTML',exact:true}).click();await (await chooser).setFiles(path.join(root,'skills/my-blog-interactive-html/assets/counter.html'));
 await editor.locator('.cm-content').filter({hasText:'html-interactive title="counter"'}).waitFor();await editor.locator('.cm-content').first().focus();await page.keyboard.press('Control+z');await page.waitForFunction(()=>!document.querySelector('.cm-editor').textContent.includes('html-interactive title="counter"'));record('UTF-8 file import inserts at cursor and one undo removes the entire import');
 await page.goto(`${base}/doc/interactive-bundle?article=interactive-doc`);await run('counter');await page.locator('[data-doc-node="interactive-doc-two"],[data-node-id="interactive-doc-two"],a[href*="interactive-doc-two"]').first().click();await page.waitForFunction(()=>document.querySelectorAll('[data-interactive-card] iframe').length===0);record('Document article switch cleans up previous iframe instances');
 const response=await context.request.post(`${base}/api/mindmaps/ensure`,{data:{source:{domain:'article',targetId:'interactive-review'}},headers});assert.ok(response.ok());const map=(await response.json()).map,block=map.source.blocks.find(block=>block.kind==='interactive-html');assert.ok(block);
 const sourceRef={domain:'article',targetId:'interactive-review',blockId:block.blockId,fingerprint:block.fingerprint,quote:block.title};
 const nestedBlock=map.source.blocks.find(block=>block.kind==='interactive-html'&&block.markdown.includes('id="folded"'));assert.ok(nestedBlock);
 const nestedRef={...sourceRef,blockId:nestedBlock.blockId,fingerprint:nestedBlock.fingerprint,quote:nestedBlock.title};
 const data={...map.data,root:{data:{text:'交互导图',uid:'interactive-root'},children:[{data:{text:'**重命名演示**',uid:'interactive-linked',sourceRef}},{data:{text:fence(samples.counter,'inline'),uid:'interactive-inline'}},{data:{text:'卡片中的演示',uid:'interactive-nested',sourceRef:nestedRef}}]}};
 const save=await context.request.put(`${base}/api/mindmaps/${map.id}`,{data:{data,title:map.title,revision:map.revision,version:map.version},headers});assert.ok(save.ok(),await save.text());
 await page.goto(`${base}/admin/mindmaps/${map.id}`);await page.locator('.map-node-markdown [data-interactive-entry]').waitFor({timeout:30000});assert.equal(await page.locator('.map-canvas iframe').count(),0);assert.ok((await page.locator('[data-map-node=interactive-linked] strong').textContent()).includes('重命名'));
 await page.locator('[data-map-node=interactive-linked] [data-interactive-entry]').click();const dialog=page.locator('dialog[data-interactive-dialog]');await dialog.frameLocator('iframe').locator('#add').click();assert.equal(await dialog.frameLocator('iframe').locator('#value').textContent(),'1');await dialog.getByRole('button',{name:'关闭演示'}).click();await dialog.waitFor({state:'detached'});
 await page.locator('svg [data-map-node=interactive-inline] [data-interactive-open]').click();await dialog.frameLocator('iframe').locator('#value').waitFor();await dialog.getByRole('button',{name:'关闭演示'}).click();
 await dialog.waitFor({state:'detached'});await page.locator('svg [data-map-node=interactive-nested] [data-interactive-entry]').click();await dialog.frameLocator('iframe').locator('#add').click();assert.equal(await dialog.frameLocator('iframe').locator('#value').textContent(),'1');await dialog.getByRole('button',{name:'关闭演示'}).click();await dialog.waitFor({state:'detached'});record('Source references to nested Callout demos retain runnable parsed source');
 for(const type of ['md','svg','png','json']){
  const menu=page.locator('.map-header .map-menu');if(!(await menu.evaluate(element=>element.open)))await menu.locator('summary').click();
  const saved=path.join(output,`export.${type}`);
  let download;
  if(desktop)await app.evaluate(({session},file)=>{globalThis.__interactiveDownload=null;session.defaultSession.once('will-download',(_event,item)=>{item.setSavePath(file);item.once('done',(_event,state)=>globalThis.__interactiveDownload=state);});},saved);
  else download=page.waitForEvent('download');
  const label={md:'MD',svg:'SVG',png:'PNG',json:'JSON 备份'}[type];await menu.getByRole('button',{name:label,exact:true}).click();
  if(desktop){for(let i=0;i<200;i++){if(await app.evaluate(()=>globalThis.__interactiveDownload))break;await new Promise(resolve=>setTimeout(resolve,50));}assert.equal(await app.evaluate(()=>globalThis.__interactiveDownload),'completed');}
  else await (await download).saveAs(saved);
  if(type==='png'){assert.deepEqual([...fs.readFileSync(saved).subarray(0,8)],[137,80,78,71,13,10,26,10]);assert.ok(fs.statSync(saved).size>1000);continue;}
  const text=fs.readFileSync(saved,'utf8');
  if(type==='json'){assert.equal(JSON.parse(text).root.children[1].data.text,fence(samples.counter,'inline'));}
  else {assert.ok(!text.includes('html-interactive id=')&&!text.includes('<script>'));assert.ok(text.includes('交互演示'));}
 }record('PNG/SVG/outline exports are static; JSON retains the executable fence');
 const imported=JSON.parse(fs.readFileSync(path.join(output,'export.json'),'utf8'));imported.root.data.text='JSON 往返验收';imported.root.children[0].data.text='**导入后演示**';const importedFile=path.join(output,'import.json');fs.writeFileSync(importedFile,JSON.stringify(imported));
 if(desktop)await app.evaluate(({session})=>session.defaultSession.once('will-download',(event)=>event.preventDefault()));
 await page.locator('.map-header .map-menu input[type=file]').setInputFiles(importedFile);await page.locator('.smm-node').filter({hasText:'JSON 往返验收'}).waitFor();await page.locator('svg [data-map-node=interactive-linked] [data-interactive-entry]').click();await dialog.frameLocator('iframe').locator('#add').click();assert.equal(await dialog.frameLocator('iframe').locator('#value').textContent(),'1');await dialog.getByRole('button',{name:'关闭演示'}).click();record('Exported JSON reimports with renamed node and working source-linked demo');
 const roundtrip=await context.request.get(`${base}/api/mindmaps/${map.id}`,{headers});assert.deepEqual((await roundtrip.json()).map.data.root.children[0].data.sourceRef,sourceRef);record('Mindmap linked/inline demos open outside canvas; Markdown rename and JSON source survive');
 assert.deepEqual(report.errors,[]);report.ok=true;
}catch(error){report.errors.push(error.stack||String(error));await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw error;}
finally{fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));await browser?.close();await app?.evaluate(({app})=>app.exit(0)).catch(()=>{});server?.kill();console.log('REPORT',output);}
