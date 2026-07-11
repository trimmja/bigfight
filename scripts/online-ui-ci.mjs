// Full production online UI gate: two isolated browsers create/join, choose
// loadouts, launch one match, receive authoritative results, and rematch in
// the same persistent room.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const VITE_PORT = 4178;
const BACKEND_PORT = 4188;
const backend = spawn(process.execPath, ['--import', 'tsx', 'server/main.ts'], {
  env: { ...process.env, PORT: String(BACKEND_PORT), RECONNECT_GRACE_MS: '2000' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const vite = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(VITE_PORT), '--strictPort'], {
  env: { ...process.env, VITE_MULTIPLAYER_URL: `ws://127.0.0.1:${BACKEND_PORT}/ws` },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let backendOutput = '';
let viteOutput = '';
backend.stdout.on('data', (chunk) => { backendOutput += chunk.toString(); });
backend.stderr.on('data', (chunk) => { backendOutput += chunk.toString(); });
vite.stdout.on('data', (chunk) => { viteOutput += chunk.toString(); });
vite.stderr.on('data', (chunk) => { viteOutput += chunk.toString(); });

const browser = await chromium.launch();
let failed = false;
try {
  await waitForServers();
  const host = await makePlayer('HOST');
  await host.page.getByText('HOST GAME', { exact: true }).click();
  await host.page.getByText('PICK WEAPON ▶', { exact: true }).click();
  await host.page.getByText('LOCK IN ▶', { exact: true }).click();

  const guest = await makePlayer('GUEST');
  await guest.page.locator('.bf-online-room-row').first().click();
  // Role-scoped: the roster-bar heading can also read KAZE (the guest's
  // highlight auto-slides off the host's claimed fighter).
  await guest.page.getByRole('button', { name: 'KAZE', exact: true }).click();
  await guest.page.getByText('PICK WEAPON ▶', { exact: true }).click();
  await guest.page.getByText('PRACTICE SWORD', { exact: true }).click();
  await guest.page.getByText('LOCK IN ▶', { exact: true }).click();

  await host.page.waitForFunction(() => document.body.innerText.includes('GUEST') && document.body.innerText.includes('START MATCH'));
  const lobbyText = await host.page.locator('body').innerText();
  assert(lobbyText.includes('P3 · OPEN') && lobbyText.includes('P4 · OPEN'), 'open slots missing');
  assert(lobbyText.includes('VOLT · RUSTY PISTOL'), 'host loadout missing');
  assert(lobbyText.includes('KAZE · PRACTICE SWORD'), 'guest loadout missing');

  await host.page.getByText('START MATCH', { exact: true }).click();
  await Promise.all([waitForTop(host.page, 'NetMatchScreen', 8_000), waitForTop(guest.page, 'NetMatchScreen', 8_000)]);

  // The gameplay result rules are tested deterministically elsewhere. This
  // forces their already-computed callback so this gate can focus on the UI,
  // server authority, and persistent-room lifecycle without a 3-stock bot run.
  await forceResult(guest.page);
  await forceResult(host.page);
  await Promise.all([waitForTop(host.page, 'OnlineResultsScreen'), waitForTop(guest.page, 'OnlineResultsScreen')]);
  assert((await host.page.locator('body').innerText()).includes('BACK TO SAME ROOM'), 'host results missing rematch');
  assert((await guest.page.locator('body').innerText()).includes('BACK TO SAME ROOM'), 'guest results missing rematch');

  await host.page.getByText('BACK TO SAME ROOM', { exact: true }).click();
  await Promise.all([waitForTop(host.page, 'OnlineLobbyScreen'), waitForTop(guest.page, 'OnlineLobbyScreen')]);
  const rematchText = await guest.page.locator('body').innerText();
  assert(rematchText.includes('BATTLE LOBBY'), 'guest did not follow host to same room');
  assert(rematchText.includes('HOST'), 'same-room players were not preserved');

  await host.context.close();
  await guest.context.close();
  console.log('PASS  online UI create > join > loadout > match > results > same-room rematch');
} catch (error) {
  failed = true;
  console.error('online-ui-ci error:', error);
  if (backendOutput) console.error(backendOutput);
  if (viteOutput) console.error(viteOutput);
} finally {
  await browser.close();
  backend.kill('SIGTERM');
  vite.kill('SIGTERM');
}

process.exit(failed ? 1 : 0);

async function makePlayer(nickname) {
  const context = await browser.newContext({ viewport: { width: 667, height: 375 } });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${VITE_PORT}/bigfight/`, { waitUntil: 'networkidle' });
  // Tap through the title, then pick the ONLINE mode card.
  await page.locator('.bf-title-screen').click();
  await page.getByText('ONLINE', { exact: true }).click();
  await page.locator('input[aria-label="Your nickname"]').fill(nickname);
  return { context, page };
}

async function waitForTop(page, name, timeout = 5_000) {
  await page.waitForFunction(
    (screenName) => window.bigfight?.screens.top?.constructor?.name === screenName,
    name,
    { timeout },
  );
}

async function forceResult(page) {
  await page.evaluate(() => {
    const net = window.bigfight?.screens.top;
    const inner = net?.inner;
    if (!inner) throw new Error('NetMatchScreen inner gameplay screen is missing');
    inner.finishVersusMatch();
  });
}

async function waitForServers() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (backendOutput.includes(`listening on :${BACKEND_PORT}`)) {
      try {
        const response = await fetch(`http://127.0.0.1:${VITE_PORT}/bigfight/`);
        if (response.ok) return;
      } catch {
        // Still starting.
      }
    }
    if (backend.exitCode !== null) throw new Error(`Backend exited: ${backendOutput}`);
    if (vite.exitCode !== null) throw new Error(`Vite exited: ${viteOutput}`);
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  throw new Error(`Servers did not start. backend=${backendOutput} vite=${viteOutput}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
