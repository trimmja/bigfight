// Deploy one source release as both the browser client and online server.
//
//   node scripts/deploy-server.mjs
//   node scripts/deploy-server.mjs --build-only
//   FLY_APP=bigfight-staging node scripts/deploy-server.mjs
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildOnly = process.argv.includes('--build-only');
const releaseId = process.env.GITHUB_SHA?.trim() || gitReleaseId();
const appArg = process.argv.find((arg) => arg.startsWith('--app='))?.slice('--app='.length);
const app = cleanAppName(appArg || process.env.FLY_APP || 'bigfight-online');

const deployArgs = [
  'deploy',
  '--config', 'server/fly.toml',
  '--dockerfile', 'server/Dockerfile',
  '--app', app,
  '--build-arg', `RELEASE_ID=${releaseId}`,
  ...(buildOnly ? ['--build-only'] : []),
  '.',
];
run('flyctl', deployArgs);

if (!buildOnly) {
  // Rooms are intentionally in-memory at family scale. A second machine would
  // split the room directory unless we later add shared room storage.
  run('flyctl', ['scale', 'count', '1', '--app', app, '-y']);
}

function cleanAppName(value) {
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(value)) {
    console.error(`Invalid Fly app name: ${value}`);
    process.exit(1);
  }
  return value;
}

function gitReleaseId() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return 'development';
  }
}

function run(command, args) {
  console.log(`> ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) {
    console.error(`${command} failed: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
