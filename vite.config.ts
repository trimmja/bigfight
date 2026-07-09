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
  base: '/bigfight/',
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  plugins: [emitVersionFile()],
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
  },
});
