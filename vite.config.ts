import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' keeps asset paths relative so the built app also works when
// served from a subfolder or wrapped later with Capacitor.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
  },
  server: {
    host: '127.0.0.1',
    strictPort: true,
  },
});
