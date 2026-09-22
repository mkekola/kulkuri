// maplibre-gl loads its worker (and the worker its shared chunk) via
// relative URLs at runtime, which Vite's bundler can't see statically. Both
// files are copied here, unhashed and side by side, so those relative paths
// stay valid in the production build. Runs on `npm install` (postinstall)
// so it stays in sync with whatever maplibre-gl version is installed.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceDir = join(rootDir, 'node_modules/maplibre-gl/dist');
const targetDir = join(rootDir, 'public/assets');

mkdirSync(targetDir, { recursive: true });

for (const file of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
  copyFileSync(join(sourceDir, file), join(targetDir, file));
}

console.log('Copied maplibre-gl worker assets into public/assets/');
