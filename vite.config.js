import { defineConfig } from 'vite';
export default defineConfig({
  base: './', cacheDir: '.cache/vite', optimizeDeps:{entries:['index.html']},
  server: { host: '127.0.0.1', port: 4184, strictPort: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 8000 },
});
