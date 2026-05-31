// Minimal zero-dependency static file server for local play and e2e tests.
// Usage: node tools/serve.js [port] [dir]
//   port: default 8080
//   dir:  directory to serve, relative to repo root (default: the built "dist").
//
// Serves <dir> and maps "/" to "<dir>/index.html". Defaulting to dist/ means
// local dev, the Playwright e2e suite, and production (Cloudflare) all exercise
// the EXACT same built artifact — no path-resolution divergence. Run
// `npm run build` (or `npm run serve`, which builds first) to populate dist/.
// No caching; correct MIME types for the few types used.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = normalize(join(dirname(fileURLToPath(import.meta.url)), '..'));
const PORT = Number(process.argv[2]) || 8080;
const ROOT = normalize(join(REPO_ROOT, process.argv[3] || 'dist'));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = createServer(async (req, res) => {
  try {
    let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
    const filePath = normalize(join(ROOT, urlPath));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    const info = await stat(filePath);
    if (info.isDirectory()) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    const body = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`tickets-please dev server: http://localhost:${PORT}/  (serving ${ROOT})`);
});
