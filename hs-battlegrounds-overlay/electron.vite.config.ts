import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

const alias = {
  '@shared': resolve(__dirname, 'src/shared'),
  '@core': resolve(__dirname, 'src/core'),
};

export default defineConfig({
  main: {
    resolve: { alias },
    build: { outDir: 'out/main' },
  },
  preload: {
    resolve: { alias },
    build: {
      outDir: 'out/preload',
      rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } },
    },
  },
  renderer: {
    root: 'src/renderer',
    resolve: { alias },
    plugins: [react()],
    worker: { format: 'es' },
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: {
          overlay: resolve(__dirname, 'src/renderer/overlay.html'),
          settings: resolve(__dirname, 'src/renderer/settings.html'),
        },
      },
    },
  },
});
