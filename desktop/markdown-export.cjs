/** Restricted Markdown drag bridge: renderer gets opaque tokens, never filesystem paths. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
function safeName(title) {
  let name = String(title).replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().replace(/[. ]+$/g, '').slice(0, 100) || '文章';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = '_' + name;
  return name + '.md';
}
function installMarkdownExport({ app, ipcMain, trustedWindow, baseUrl, nativeImage, fetch: request = globalThis.fetch }) {
  const prepared = new Map();
  let directory;
  async function authorized(event) {
    const win = trustedWindow(event), base = baseUrl();
    if (!win || !/^\/doc\/[^/]+\/?$/.test(new URL(event.senderFrame.url).pathname)) throw Error('请在桌面文档文章页导出');
    const cookies = await event.sender.session.cookies.get({ url: base });
    const headers = { cookie: cookies.map(item => `${item.name}=${item.value}`).join('; ') };
    const response = await request(base + '/api/admin-auth/me', { headers, signal: AbortSignal.timeout(10000) });
    const identity = await response.json();
    if (!response.ok || !(identity.identity === 'top' || identity.identity === 'github' && (identity.account?.role === 'top' || identity.account?.permissions?.includes('docs')))) throw Error('请登录具有文档管理权限的账号');
    return { win, base, headers };
  }
  ipcMain.handle('desktop:prepare-markdown-export', async (event, nodeId) => {
    try {
      if (typeof nodeId !== 'string' || !/^[\w-]{1,64}$/.test(nodeId)) throw Error('无效的文章标识');
      const { base, headers } = await authorized(event);
      const options = { headers, signal: AbortSignal.timeout(15000) };
      const nodeResponse = await request(`${base}/api/doc/nodes/${encodeURIComponent(nodeId)}`, options);
      const { node } = await nodeResponse.json();
      if (!nodeResponse.ok || node?.kind !== 'article' || new URL(event.senderFrame.url).pathname.replace(/\/$/, '') !== `/doc/${node.bundleId}`) throw Error('文档文章已切换或不存在');
      const response = await request(`${base}/api/export/doc/${encodeURIComponent(nodeId)}`, options);
      if (!response.ok) throw Error('Markdown 导出失败');
      const body = await response.text();
      if (Buffer.byteLength(body) > 4 * 1024 * 1024) throw Error('导出文件过大，请使用下载入口');
      if (!trustedWindow(event) || new URL(event.sender.getURL()).pathname.replace(/\/$/, '') !== `/doc/${node.bundleId}`) throw Error('文档页面已切换');
      directory ??= fs.mkdtempSync(path.join(os.tmpdir(), 'byqx-markdown-'));
      const token = randomUUID(), folder = path.join(directory, token), filename = safeName(node.title);
      fs.mkdirSync(folder); const file = path.join(folder, filename); fs.writeFileSync(file, body, { encoding: 'utf8', flag: 'wx' });
      prepared.set(token, { sender: event.sender.id, url: event.senderFrame.url, file, expires: Date.now() + 120000 });
      return { ok: true, token, filename };
    } catch (error) { return { ok: false, error: error.message || '导出准备失败' }; }
  });
  ipcMain.on('desktop:start-markdown-drag', (event, token) => {
    const item = prepared.get(token);
    if (!item || !trustedWindow(event) || item.sender !== event.sender.id || item.url !== event.senderFrame.url || item.expires < Date.now()) return;
    // Files survive the entire native drag, including cancellation and a subsequent retry.
    const icon = nativeImage.createFromPath(path.join(__dirname, 'assets/markdown-drag.png'));
    if (icon.isEmpty()) return;
    event.sender.startDrag({ file: item.file, icon });
  });
  const cleanup = () => {
    for (const item of prepared.values()) { try { fs.unlinkSync(item.file); fs.rmdirSync(path.dirname(item.file)); } catch { /* OS may briefly retain a drag handle. */ } }
    prepared.clear(); if (directory) { try { fs.rmdirSync(directory); } catch { /* Never recurse beyond our own files. */ } }
  };
  app.on('will-quit', cleanup);
  return { cleanup };
}
module.exports = { safeName, installMarkdownExport };
