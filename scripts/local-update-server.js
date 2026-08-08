const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..', 'dist'));
const port = Number(process.env.CLIPS_UPDATE_PORT) || 8787;
const contentTypes = {
  '.yml': 'text/yaml; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8',
  '.exe': 'application/octet-stream',
  '.blockmap': 'application/octet-stream'
};
let bytesServed = 0;
const requests = [];
function record(pathname, status, bytes) {
  bytesServed += bytes;
  requests.push({ pathname, status, bytes });
  if (requests.length > 30) requests.shift();
}

const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
  if (pathname === '/__status') {
    const body = JSON.stringify({ bytesServed, requests }, null, 2);
    response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
    response.end(body);
    return;
  }
  const relative = pathname.replace(/^\/+/, '');
  const filePath = path.resolve(root, relative);
  if (!filePath.startsWith(`${root}${path.sep}`) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    response.writeHead(404);
    response.end('Not found');
    record(pathname, 404, 0);
    return;
  }
  const stat = fs.statSync(filePath);
  const range = request.headers.range;
  response.setHeader('Accept-Ranges', 'bytes');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', contentTypes[path.extname(filePath)] || 'application/octet-stream');
  if (range) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (!match) {
      response.writeHead(416);
      response.end();
      return;
    }
    const start = Number(match[1]);
    const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
    response.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Content-Length': end - start + 1
    });
    record(pathname, 206, end - start + 1);
    fs.createReadStream(filePath, { start, end }).pipe(response);
    return;
  }
  response.writeHead(200, { 'Content-Length': stat.size });
  record(pathname, 200, stat.size);
  fs.createReadStream(filePath).pipe(response);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Serving updates from ${root}`);
  console.log(`CLIPS_UPDATE_URL=http://127.0.0.1:${port}`);
});
