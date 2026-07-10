// Deploy the BIG FIGHT online server (client + room server) to Fly.io.
//
//   node scripts/deploy-server.mjs                 build client -> stage into server/public -> flyctl deploy
//   node scripts/deploy-server.mjs --build-only    skip the flyctl step (stage only)
//
// Requires flyctl on PATH and `flyctl auth login` done once.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const pub = path.join(root, 'server', 'public');
const buildOnly = process.argv.includes('--build-only');

function run(cmd, args) {
  console.log(`\n> ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32', // npm/flyctl are .cmd shims on Windows
  });
  if (r.error) {
    console.error(`Failed to run ${cmd}: ${r.error.message}`);
    process.exit(1);
  }
  if (r.status !== 0) {
    console.error(`${cmd} exited with code ${r.status}`);
    process.exit(r.status ?? 1);
  }
}

// 1. Build the client (tsc + vite -> dist/).
// The Fly server serves the client at ROOT ("/"), so force Vite's base to "/"
// (vite.config.ts defaults to "/bigfight/" for the GitHub Pages project site — that
// would 404 every asset at the apex). spawnSync inherits process.env, so this env
// var reaches the `npm run build` child.
process.env.BASE_PATH = '/';
run('npm', ['run', 'build']);
if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.error('dist/index.html missing after build — aborting.');
  process.exit(1);
}

// 2. Stage the build into server/public/ (served by server/main.ts).
fs.rmSync(pub, { recursive: true, force: true });
fs.cpSync(dist, pub, { recursive: true });
fs.writeFileSync(path.join(pub, '.gitkeep'), ''); // keep the dir tracked
console.log(`Staged dist/ -> server/public (${fs.readdirSync(pub).length} entries)`);

if (buildOnly) {
  console.log('--build-only: skipping flyctl deploy.');
  process.exit(0);
}

// 3. Deploy from the repo root so the Docker build context includes shared/.
run('flyctl', [
  'deploy',
  '--config', 'server/fly.toml',
  '--dockerfile', 'server/Dockerfile',
  '--app', 'bigfight-online',
  '.',
]);

// 4. Pin to EXACTLY ONE machine. Rooms live in-memory per machine, so a second
// machine splits players (a joiner load-balances to the wrong instance and
// can't find the room). A family-scale game only ever needs one. Deploys can
// leave a stray second machine, so enforce count=1 every time.
run('flyctl', ['scale', 'count', '1', '--app', 'bigfight-online', '-y']);
