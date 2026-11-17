// Zero-dependency dev server. ES modules need HTTP (not file://), nothing more.
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 5173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.md': 'text/plain; charset=utf-8',
};

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(root, `.${rel}`);
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    const st = await stat(file);
    if (st.isDirectory()) {
      res.writeHead(403).end('forbidden');
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] || 'application/octet-stream',
      'content-length': st.size,
      'cache-control': 'no-cache',
    });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
  }
}).listen(port, () => {
  console.log(`泡泡前线 BubbleFront → http://localhost:${port}/`);
});
