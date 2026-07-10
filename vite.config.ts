import { defineConfig, type Plugin } from 'vite';
import { execFileSync } from 'node:child_process';

// One id per source release, shared by every deployment of the same commit.
// Separate build timestamps made GitHub Pages and Fly reject each other even
// when their source was identical.
const BUILD_ID = releaseId();
const BASE_PATH = process.env.BASE_PATH ?? '/bigfight/';

function emitVersionFile(): Plugin {
  return {
    name: 'emit-version-json',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ buildId: BUILD_ID, releaseId: BUILD_ID }),
      });
    },
  };
}

export default defineConfig({
  base: BASE_PATH,
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

function releaseId(): string {
  const configured = (process.env.RELEASE_ID ?? process.env.GITHUB_SHA ?? '').trim();
  if (configured) return configured.slice(0, 40);
  try {
    return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'development';
  }
}
