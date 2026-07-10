import { defineConfig, type Plugin } from 'vite';

// One id per build: baked into the bundle AND emitted as version.json, so the
// running app can ask the server "is there a newer me?".
const BUILD_ID = Date.now().toString(36);

function emitVersionFile(): Plugin {
  return {
    name: 'emit-version-json',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ buildId: BUILD_ID }),
      });
    },
  };
}

export default defineConfig({
  // Default '/bigfight/' for the GitHub Pages project site (trimmja.github.io/bigfight).
  // Override with BASE_PATH=/ on a root/apex-domain deploy (e.g. playbigfight.com on Cloudflare Pages).
  base: process.env.BASE_PATH ?? '/bigfight/',
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  plugins: [emitVersionFile()],
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      input: {
        main: 'index.html',
        // Character design lab — unlinked design-review page (mockup.html).
        mockup: 'mockup.html',
      },
    },
  },
});
