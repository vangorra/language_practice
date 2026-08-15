#!/usr/bin/env node
// Bundles the app (including the @jirimracek/conjugate-esp runtime
// dependency, which browsers can't resolve as a bare import on their own)
// into dist/, a fully static, self-contained folder suitable for GitHub
// Pages or any other static host.
//
// Usage: npm run build

import { build } from 'esbuild';
import { mkdirSync, copyFileSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST = path.join(ROOT, 'dist');

mkdirSync(DIST, { recursive: true });
mkdirSync(path.join(DIST, 'icons'), { recursive: true });

await build({
  entryPoints: [path.join(ROOT, 'js', 'main.js')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2020'],
  minify: true,
  sourcemap: true,
  outfile: path.join(DIST, 'bundle.js'),
});

copyFileSync(path.join(ROOT, 'styles.css'), path.join(DIST, 'styles.css'));
copyFileSync(path.join(ROOT, 'manifest.webmanifest'), path.join(DIST, 'manifest.webmanifest'));
for (const file of readdirSync(path.join(ROOT, 'icons'))) {
  copyFileSync(path.join(ROOT, 'icons', file), path.join(DIST, 'icons', file));
}

// sw.js's CACHE_NAME embeds a build id so its bytes differ on every build --
// that's what makes the browser notice a new service worker is available
// and drop the previous build's cached shell (see sw.js's own comment).
const sw = readFileSync(path.join(ROOT, 'sw.js'), 'utf8').replaceAll('__BUILD_ID__', String(Date.now()));
writeFileSync(path.join(DIST, 'sw.js'), sw);

const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(
  '<script type="module" src="js/main.js"></script>',
  '<script type="module" src="bundle.js"></script>'
);
writeFileSync(path.join(DIST, 'index.html'), html);

console.log('Built dist/ (index.html, styles.css, bundle.js + bundle.js.map, manifest.webmanifest, sw.js, icons/)');
