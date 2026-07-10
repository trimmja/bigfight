// Capture the cinematic 3D lobby with 2 players on pedestals (different picks).
// Uses the LOCAL dev server (vite :5173) + LOCAL ws server (:8080 via ?localserver).
import { chromium } from 'playwright';
const BASE = process.argv.find((a) => a.startsWith('--url='))?.slice(6) ?? 'http://localhost:5173/bigfight/?localserver';
const joinUrl = (code) => (BASE.includes('?') ? `${BASE}&join=${code}` : `${BASE}?join=${code}`);
const OUT = process.env.SHOTS ?? '.';
const browser = await chromium.launch();

async function player() {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 420 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error') console.log('  [console.error]', m.text().slice(0, 140)); });
  p.on('pageerror', (e) => console.log('  [pageerror]', e.message.slice(0, 140)));
  await p.goto(BASE, { waitUntil: 'domcontentloaded' });
  return p;
}
async function clickText(page, text) {
  return page.evaluate((t) => {
    const n = [...document.querySelectorAll('button,[role=button],.bf-mode-card,.bf-card')].find((e) => (e.textContent ?? '').includes(t));
    if (n) { n.click(); return true; } return false;
  }, text);
}
// Advance past the title screen (pointerdown anywhere).
async function tapTitle(page) {
  await page.mouse.click(450, 210);
  await page.waitForTimeout(600);
}
try {
  const a = await player();
  const b = await player();
  await tapTitle(a); // title -> hub
  await a.waitForTimeout(300);
  console.log('A create clicked:', await clickText(a, 'CREATE ROOM'));
  // Lobby shows ROOM <code>; grab a 4-consonant code from the DOM.
  await a.waitForFunction(() => /\b[BCDFGHJKLMNPQRSTVWXZ]{4}\b/.test(document.body.innerText), null, { timeout: 15000 });
  const code = await a.evaluate(() => document.body.innerText.match(/\b([BCDFGHJKLMNPQRSTVWXZ]{4})\b/)?.[1]);
  console.log('room code:', code);
  await b.goto(joinUrl(code), { waitUntil: 'domcontentloaded' });
  await b.waitForTimeout(600);
  await tapTitle(b); // in case deep-link still shows title first
  // Wait until B is actually in the lobby (its ROOM chip renders).
  await b.waitForFunction((c) => document.body.innerText.includes(`ROOM ${c}`), code, { timeout: 15000 }).catch(() => console.log('  B never reached lobby'));
  await b.waitForTimeout(1500);
  // Pick distinct fighters from the bottom carousel (by name).
  console.log('A pick Grim:', await clickText(a, 'Grim'));
  await a.waitForTimeout(300);
  console.log('B pick Kaze:', await clickText(b, 'Kaze'));
  await b.waitForTimeout(300);
  // Let the camera settle + fighters greet on their pedestals.
  await a.waitForTimeout(2400);
  await a.screenshot({ path: `${OUT}/arena-2p.png` });
  await b.screenshot({ path: `${OUT}/arena-2p-b.png` });
  console.log('captured arena-2p (+ B view)');
  // A readies (pedestal surge + nameplate stamp).
  console.log('A ready:', await clickText(a, 'READY'));
  await a.waitForTimeout(900);
  await a.screenshot({ path: `${OUT}/arena-ready.png` });
  console.log('captured arena-ready');
} catch (e) { console.error('shot error:', e.message); } finally { await browser.close(); }
