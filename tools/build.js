// Zero-dependency build: assemble a deployable static site in dist/.
//
// The app is plain ES modules with no bundler. The entry is src/ui/index.html,
// which loads ./main.js and ./style.css, and main.js imports ../engine/* and
// ../ai/*. For hosting we need "/" to serve the app with those relative paths
// intact. So we copy the whole src/ tree into dist/src/ and emit a dist/index.html
// at the root that points into ./src/ui/. No path inside the app changes.
//
// Usage: node tools/build.js   (output: dist/)

import { rmSync, mkdirSync, cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

// Clean.
rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

// Copy the application source verbatim (engine + ai + ui), preserving the
// relative import structure the modules rely on.
cpSync(join(ROOT, 'src'), join(DIST, 'src'), { recursive: true });

// Emit the root index.html by taking the app's own index.html and prefixing its
// local references (./main.js, ./style.css) with ./src/ui/ so they resolve from
// the dist root.
const appHtml = readFileSync(join(ROOT, 'src', 'ui', 'index.html'), 'utf8');
const rootHtml = appHtml
  .replace(/href="\.\/style\.css"/g, 'href="./src/ui/style.css"')
  .replace(/src="\.\/main\.js"/g, 'src="./src/ui/main.js"');

if (rootHtml === appHtml) {
  throw new Error('build: expected to rewrite ./main.js and ./style.css paths but found none');
}
writeFileSync(join(DIST, 'index.html'), rootHtml);

// A tiny 200/health file is handy and harmless.
writeFileSync(join(DIST, 'robots.txt'), 'User-agent: *\nAllow: /\n');

console.log('built dist/ (index.html + src/) — ready for `wrangler deploy`');
