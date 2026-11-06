/**
 * Browser demo of the renderer (no Electron): `npx vite --config vite.demo.config.ts`
 *
 *   http://localhost:5199/                       scene launcher
 *   http://localhost:5199/overlay.html?scene=recruit
 *   http://localhost:5199/settings.html?scene=gameOver
 *
 * The renderer detects that `window.tavernLens` is missing and installs the mock
 * bridge (src/renderer/src/bridge/mock.ts). Test fixtures are served at
 * /__fixtures/ so `?scene=replay` can stream a recorded Power.log through the
 * real tracker in the browser.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const root = fileURLToPath(new URL('.', import.meta.url));
const fixturesDir = resolve(root, 'test/fixtures');

/** Serves test/fixtures as raw bytes (no Content-Encoding, the page gunzips itself). */
function fixtures(): Plugin {
  const handler = (req: { url?: string }, res: import('node:http').ServerResponse, next: () => void) => {
    const url = req.url?.split('?')[0] ?? '';
    if (!url.startsWith('/__fixtures/')) return next();
    const file = normalize(resolve(fixturesDir, decodeURIComponent(url.slice('/__fixtures/'.length))));
    if (!file.startsWith(fixturesDir + sep) || !existsSync(file) || !statSync(file).isFile()) {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', String(statSync(file).size));
    res.setHeader('Cache-Control', 'no-store');
    createReadStream(file).pipe(res);
  };
  return {
    name: 'tavern-lens-fixtures',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}

export default defineConfig({
  root: resolve(root, 'src/renderer'),
  resolve: {
    alias: {
      '@shared': resolve(root, 'src/shared'),
      '@core': resolve(root, 'src/core'),
    },
  },
  plugins: [react(), fixtures()],
  worker: { format: 'es' },
  server: {
    port: 5199,
    strictPort: false,
    fs: { allow: [root] },
  },
  preview: { port: 5199 },
  build: {
    outDir: resolve(root, 'out/demo'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(root, 'src/renderer/index.html'),
        overlay: resolve(root, 'src/renderer/overlay.html'),
        settings: resolve(root, 'src/renderer/settings.html'),
      },
    },
  },
});
