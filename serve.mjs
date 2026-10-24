// Tiny static file server (no dependencies): `npm start` -> http://localhost:8080
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };
const port = process.env.PORT || 8080;

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  // Resolve the directory default (index.html) from the raw pathname, which always uses '/',
  // BEFORE normalize() rewrites separators. On Windows normalize('/') yields a backslash, so
  // the trailing-slash check below would otherwise miss the site root and return 404.
  let decoded = decodeURIComponent(url.pathname);
  if (decoded.endsWith('/')) decoded += 'index.html';
  let p = normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  const file = join(root, p);
  if (!file.startsWith(root) || /\/(tests|node_modules|\.git)\//.test(p)) { res.writeHead(403).end('Forbidden'); return; }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(data);
  } catch { res.writeHead(404).end('Not found'); }
}).listen(port, () => console.log(`RoomSync running at http://localhost:${port}`));
