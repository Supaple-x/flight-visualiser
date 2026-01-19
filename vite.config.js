import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    host: 'localhost',
    strictPort: false,
    open: true
  },
  build: {
    target: 'esnext',
    outDir: 'dist'
  }
});
