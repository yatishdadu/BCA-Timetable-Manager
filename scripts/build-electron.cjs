// Phase 2F1: compile the main process without bundling native runtime modules.
// sqlite3 is loaded from electron-builder's production node_modules at runtime.
const path = require('node:path');
const fs = require('node:fs');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist', 'main');
fs.mkdirSync(dist, { recursive: true });

async function main() {
  await esbuild.build({
    entryPoints: [path.join(root, 'src', 'main', 'index.ts')],
    bundle: true,
    packages: 'external',
    external: ['electron'],
    platform: 'node',
    format: 'esm',
    target: 'node20',
    outfile: path.join(dist, 'index.mjs'),
    sourcemap: false,
    logLevel: 'info',
  });
  await esbuild.build({
    entryPoints: [path.join(root, 'src', 'main', 'preload.ts')],
    bundle: true,
    external: ['electron'],
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    outfile: path.join(dist, 'preload.js'),
    sourcemap: false,
    logLevel: 'info',
  });
}
main().catch(err => { console.error('[desktop-build]', err); process.exitCode = 1; });
