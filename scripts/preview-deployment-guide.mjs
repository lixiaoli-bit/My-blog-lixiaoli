import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const directory = path.resolve(import.meta.dirname, '../public/deploy');
const files = { '/deploy/': ['index.html', 'text/html'], '/deploy/index.html': ['index.html', 'text/html'], '/deploy/guide.css': ['guide.css', 'text/css'], '/deploy/guide.js': ['guide.js', 'text/javascript'] };
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname === '/' || url.pathname === '/deploy') { response.writeHead(302, { location: '/deploy/' }); response.end(); return; }
  const file = files[url.pathname];
  if (!file) { response.writeHead(404); response.end('Not found'); return; }
  response.writeHead(200, { 'content-type': `${file[1]}; charset=utf-8`, 'cache-control': 'no-store' });
  response.end(fs.readFileSync(path.join(directory, file[0])));
});
server.listen(Number(process.env.GUIDE_PORT || 4390), '127.0.0.1', () => console.log(`Local: http://127.0.0.1:${server.address().port}/deploy/`));
