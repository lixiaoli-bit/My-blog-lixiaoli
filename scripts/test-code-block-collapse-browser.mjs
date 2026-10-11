/** Isolated browser/hidden desktop acceptance for code collapse and node editing. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import Database from 'better-sqlite3';
import {chromium, _electron} from 'playwright-core';
import {collapseMarkdown, reviewCollapse} from './code-block-collapse-review.mjs';
import {reviewExpand} from './mindmap-expand-review.mjs';

const root = path.resolve(import.meta.dirname,'..');
const desktop = process.argv.includes('--desktop');
const portable = path.join(root,'release',process.env.BYQX_DESKTOP_BUNDLE_DIR || 'portable');
const output = path.join(root,'outputs/code-block-collapse',`${desktop ? 'desktop' : 'browser'}-${Date.now()}`);
fs.mkdirSync(output,{recursive:true});
const databasePath = path.join(output,'test.db');
fs.copyFileSync(path.join(portable,'resources/desktop-assets/template.db'),databasePath);
const db = new Database(databasePath), now = Date.now();
db.prepare('INSERT INTO articles (id,slug,title,type,content,summary,encrypted,created_at,updated_at) VALUES (?,?,?,?,?,?,0,?,?)')
  .run('collapse-review','collapse-review','代码折叠隔离验收','note',collapseMarkdown,'隔离测试',now,now);
db.prepare('INSERT INTO doc_categories (id,name,created_at,updated_at) VALUES (?,?,?,?)').run('collapse-category','隔离验收',now,now);
db.prepare('INSERT INTO doc_bundles (id,category_id,name,created_at,updated_at) VALUES (?,?,?,?,?)').run('collapse-bundle','collapse-category','隔离文档',now,now);
db.prepare('INSERT INTO doc_nodes (id,bundle_id,kind,title,content,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run('collapse-doc','collapse-bundle','article','代码折叠验收',collapseMarkdown,now,now);
db.close();
const port = await new Promise(resolve => {const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});
const base = `http://127.0.0.1:${port}`, password = 'isolated-collapse-review';
const cases = [], errors = [], record = label => {cases.push(label);console.log('PASS',label);};
let browser, application, server;
try {
  let context, page;
  if (desktop) {
    const appData = path.join(output,'appdata'), profile = path.join(output,'profile');
    fs.mkdirSync(path.join(appData,'byqx-blog-desktop'),{recursive:true});fs.mkdirSync(profile,{recursive:true});
    fs.writeFileSync(path.join(appData,'byqx-blog-desktop/config.json'),JSON.stringify({LOCAL_DB_PATH:databasePath,ADMIN_PASSWORD:password,AUTH_SECRET:crypto.randomBytes(32).toString('hex'),SYNC_DATABASE_URL:'postgres://unused:unused@127.0.0.1:1/isolated',PORT:String(port)}));
    const main = path.join(portable,'resources/app/desktop/main.cjs'), bootstrap=path.join(output,'bootstrap.cjs');
    fs.writeFileSync(bootstrap,`const electron=require('electron'),{app}=electron;const OriginalWindow=electron.BrowserWindow;const hiddenElectron=Object.create(electron);Object.defineProperty(hiddenElectron,'BrowserWindow',{value:class extends OriginalWindow{constructor(options){super({...options,show:false,webPreferences:{...options.webPreferences,backgroundThrottling:false}});this.show=()=>{};this.focus=()=>{};}}});const Module=require('module'),load=Module._load;Module._load=function(request,parent,isMain){return request==='electron'?hiddenElectron:load.call(this,request,parent,isMain);};app.setPath('appData',${JSON.stringify(appData)});app.setPath('userData',${JSON.stringify(profile)});process.argv=[process.argv[0]];const main=${JSON.stringify(main)};delete require.cache[require.resolve(main)];require(main);`);
    const env={...process.env,APPDATA:appData,BYQX_START_PATH:'/',DATABASE_URL_FALLBACK:'',SYNC_DATABASE_URL_FALLBACK:'',BYQX_CONFIG_PATH:path.join(output,'ai.json'),BYQX_PI_AUTH_PATH:path.join(output,'pi.json')};
    delete env.ELECTRON_RUN_AS_NODE;delete env.BYQX_SMOKE;delete env.BYQX_CAPTURE;
    application=await _electron.launch({executablePath:path.join(portable,'白衣卿相.exe'),args:['--toolchain-runner',bootstrap],env,cwd:output,timeout:60000});
    page=await application.firstWindow();context=application.context();
    await page.waitForURL(`${base}/**`,{timeout:60000});
    assert.equal(await application.evaluate(({app})=>app.getPath('appData')),appData);
  } else {
    const log=fs.openSync(path.join(output,'server.log'),'a');
    server=spawn(process.execPath,[path.join(root,'dist/server/entry.mjs')],{cwd:root,windowsHide:true,stdio:['ignore',log,log],env:{...process.env,HOST:'127.0.0.1',PORT:String(port),DATABASE_URL:`file:${databasePath}`,DATABASE_URL_FALLBACK:'',SYNC_DATABASE_URL:'',SYNC_DATABASE_URL_FALLBACK:'',ADMIN_PASSWORD:password,TOP_ADMIN_PASSWORD:password,AUTH_SECRET:crypto.randomBytes(32).toString('hex'),DESKTOP_MODE:'1',SITE_URL:base}});
    fs.closeSync(log);
    for (let i=0;i<100;i++) {try {if((await fetch(base+'/api/ui-style',{signal:AbortSignal.timeout(1000)})).ok())break;}catch{}await new Promise(resolve=>setTimeout(resolve,200));}
    browser=await chromium.launch({channel:'msedge',headless:true});context=await browser.newContext({extraHTTPHeaders:{Origin:base}});page=await context.newPage();
  }
  page.on('pageerror',error=>errors.push(error.stack));page.on('dialog',dialog=>dialog.accept());
  assert.ok((await context.request.post(base+'/api/admin-auth/login',{headers:{Origin:base,'User-Agent':'CollapseReview'},data:{password}})).ok());
  await context.addCookies((await context.cookies()).map(cookie=>({...cookie,secure:false})));
  await reviewCollapse({context,page,base,output,sourceUrls:process.argv.includes('--mindmap-only') ? [] : ['/blog/collapse-review','/doc/collapse-bundle?article=collapse-doc'],record,captureScreenshots:!desktop});
  await reviewExpand({context,page,base,record});
  assert.deepEqual(errors,[]);
  console.log('CODE_COLLAPSE_OK',desktop ? 'portable' : 'browser',cases.length);
} catch (error) {
  errors.push(error.stack);throw error;
} finally {
  fs.writeFileSync(path.join(output,'review.json'),JSON.stringify({desktop,portable,isolated:true,cases,errors},null,2));
  fs.writeFileSync(path.join(root,'outputs/code-block-collapse',`latest-${desktop?'desktop':'browser'}.json`),JSON.stringify({output,cases,errors},null,2));
  if(application) {await application.evaluate(({BrowserWindow,app})=>{BrowserWindow.getAllWindows().forEach(window=>window.destroy());app.quit();}).catch(()=>{});await application.close().catch(()=>{});}
  await browser?.close();server?.kill();
}
