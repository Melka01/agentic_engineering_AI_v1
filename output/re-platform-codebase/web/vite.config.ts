import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: true },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3000' },
    fs: { allow: ['..'] },
  },
});
