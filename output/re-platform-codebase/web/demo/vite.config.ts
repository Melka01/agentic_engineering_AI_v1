import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** Standalone browser demo: one JS chunk + one CSS file, inlined by scripts/build-demo.mjs. */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    modulePreload: false,
    cssCodeSplit: false,
    sourcemap: false,
  },
});
