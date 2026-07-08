import { defineConfig } from 'vite';

export default defineConfig({
  base: '/bigfight/',
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
  },
});
