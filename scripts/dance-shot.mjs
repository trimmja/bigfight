// Verify the networked lobby dance: A picks Grim + hits DANCE; capture A's own
// view AND B's view a beat later — both should show Grim mid-dance (proves the
// emote is networked, not local-only).
import { chromium } from 'playwright';
const BASE = process.argv.find((a) => a.startsWith('--url='))?.slice(6) ?? 'http://localhost:5173/bigfight/?localserver';
const joinUrl = (c) => (BASE.includes('?') ? `${BASE}&join=${c}` : `${BASE}?join=${c}`);
const OUT = process.env.SHOTS ?? '.';
const browser = await chromium.launch();
async function player() {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 420 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('  [pageerror]', e.message.slice(0, 140)));
  await p.goto(BASE, { waitUntil: 'domcontentloaded' });
  return p;
}
async function click(page, text) {
  return page.evaluate((t) => { const n = [...document.querySelectorAll('button,[role=button],.bf-mode-card,.bf-card')].find((e) => (e.textContent ?? '').includes(t)); if (n) { n.click(); return true; } return false; }, text);
}
async function tapTitle(p) { await p.mouse.click(450, 210); await p.waitForTimeout(600); }
try {
  const a = await player();
  const b = await player();
  await tapTitle(a);
  await click(a, 'CREATE ROOM');
  await a.waitForFunction(() => /\b[BCDFGHJKLMNPQRSTVWXZ]{4}\b/.test(document.body.innerText), null, { timeout: 15000 });
  const code = await a.evaluate(() => document.body.innerText.match(/\b([BCDFGHJKLMNPQRSTVWXZ]{4})\b/)?.[1]);
  console.log('room', code);
  await b.goto(joinUrl(code), { waitUntil: 'domcontentloaded' });
  await b.waitForTimeout(600); await tapTitle(b);
  await b.waitForFunction((c) => document.body.innerText.includes(`ROOM ${c}`), code, { timeout: 15000 });
  await b.waitForTimeout(1500);
  console.log('A pick Grim:', await click(a, 'Grim'));
  await a.waitForTimeout(900);
  // A hits the dance button.
  console.log('A dance:', await a.evaluate(() => { const d = document.querySelector('.bf-arena-dance'); if (d) { d.click(); return true; } return false; }));
  await a.waitForTimeout(1100); // let the dance play + network to B
  await a.screenshot({ path: `${OUT}/dance-A.png` });
  await b.screenshot({ path: `${OUT}/dance-B.png` });
  console.log('captured dance-A (own) + dance-B (remote view)');
} catch (e) { console.error('shot error:', e.message); } finally { await browser.close(); }
