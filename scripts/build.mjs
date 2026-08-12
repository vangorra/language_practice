#!/usr/bin/env node
// Bundles the app (including the @jirimracek/conjugate-esp runtime
// dependency, which browsers can't resolve as a bare import on their own)
// into dist/, a fully static, self-contained folder suitable for GitHub
// Pages or any other static host.
//
// Usage: npm run build

import { build } from 'esbuild';
import { mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST = path.join(ROOT, 'dist');

mkdirSync(DIST, { recursive: true });

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

const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(
  '<script type="module" src="js/main.js"></script>',
  '<script type="module" src="bundle.js"></script>'
);
writeFileSync(path.join(DIST, 'index.html'), html);

console.log('Built dist/ (index.html, styles.css, bundle.js + bundle.js.map)');
