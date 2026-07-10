// Replay determinism check (M0 gate) — drives ?replaylab&ci in headless
// Chromium and asserts every fixture passes. Part of the netplay toolchain.
//
//   node scripts/replay-ci.mjs          build + vite preview + check
//   node scripts/replay-ci.mjs --dev    check against the RUNNING dev server
//                                       (http://localhost:5173/bigfight/)
import { spawn, spawnSync } from 'node:child_process';
import { chromium } from 'playwright';

const DEV = process.argv.includes('--dev');
const PORT = 4174;
const url = DEV
  ? 'http://localhost:5173/bigfight/?replaylab&ci'
  : `http://localhost:${PORT}/bigfight/?replaylab&ci`;

let previewProc = null;
if (!DEV) {
  console.log('building…');
  const build = spawnSync('npm', ['run', 'build'], { stdio: 'inherit', shell: true });
  if (build.status !== 0) process.exit(build.status ?? 1);
  previewProc = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    stdio: 'pipe',
    shell: true,
  });
  await new Promise((resolve) => setTimeout(resolve, 2500));
}

const browser = await chromium.launch();
let failed = false;
try {
  const page = await browser.newPage();
  page.on('console', (msg) => {
    if (msg.text().startsWith('[replaylab]')) console.log(msg.text());
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const result = await page.waitForFunction(() => window.__replayResult, null, {
    timeout: 180_000,
    polling: 500,
  });
  const reports = await result.jsonValue();
  for (const r of reports) {
    const line = `${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  final=${r.finalDigest}  step avg ${r.stepMsAvg.toFixed(3)}ms max ${r.stepMsMax.toFixed(2)}ms`;
    console.log(line);
    if (!r.pass) {
      failed = true;
      console.error(`  first divergence: frame ${r.firstDivergence}\n${r.divergenceDetail}`);
    }
  }
} catch (err) {
  failed = true;
  console.error('replay-ci error:', err);
} finally {
  await browser.close();
  previewProc?.kill();
}

console.log(failed ? '\nreplay determinism: FAILED' : '\nreplay determinism: PASS');
process.exit(failed ? 1 : 0);
