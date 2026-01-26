import { defineConfig } from 'vite';
import cesium from 'vite-plugin-cesium';

export default defineConfig({
  plugins: [cesium()],
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
