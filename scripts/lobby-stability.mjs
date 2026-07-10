// Prove the lobby stops thrashing: two players in a static lobby, then count
// slot-card animationstart events + DOM replacements over 6s. Should be ~0.
import { chromium } from 'playwright';

const BASE = process.argv.find((a) => a.startsWith('--url='))?.slice(6) ?? 'http://localhost:5173/bigfight/';
const browser = await chromium.launch();

async function player() {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 620 } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  return page;
}
async function click(page, text) {
  const ok = await page.evaluate((t) => {
    const n = [...document.querySelectorAll('button,[role=button],.bf-card')].find((e) => (e.textContent ?? '').includes(t));
    if (n) { n.click(); return true; }
    return false;
  }, text);
  if (!ok) throw new Error(`no "${text}"`);
}

try {
  const a = await player();
  const b = await player();
  await click(a, 'ONLINE');
  await a.waitForTimeout(400);
  await click(a, 'CREATE ROOM');
  await a.waitForFunction(() => /\b[BCDFGHJKLMNPQRSTVWXZ]{4}\b/.test(document.body.innerText), null, { timeout: 15000 });
  const code = await a.evaluate(() => document.body.innerText.match(/\b([BCDFGHJKLMNPQRSTVWXZ]{4})\b/)?.[1]);
  await b.goto(`${BASE}?join=${code}`, { waitUntil: 'domcontentloaded' });
  await b.waitForTimeout(2500);

  // Both players now in the lobby. Instrument A: watch a slot card for
  // animationstart (pop-in re-fires) + whether the node gets replaced.
  await a.waitForSelector('.bf-slot[data-slot="0"]', { timeout: 8000 });
  const result = await a.evaluate(async () => {
    const row = document.querySelector('.bf-slot-row');
    const firstCard = row.querySelector('.bf-slot[data-slot="0"]');
    let animStarts = 0;
    let replacements = 0;
    row.addEventListener('animationstart', (e) => { if (e.animationName?.includes('pop-in')) animStarts += 1; }, true);
    const mo = new MutationObserver((muts) => { for (const m of muts) replacements += m.addedNodes.length; });
    mo.observe(row, { childList: true });
    await new Promise((r) => setTimeout(r, 6000));
    mo.disconnect();
    return { animStarts, replacements, sameNode: row.querySelector('.bf-slot[data-slot="0"]') === firstCard, players: row.querySelectorAll('.bf-slot-filled').length };
  });
  console.log('lobby stability over 6s (2 players, static):', JSON.stringify(result));
  const pass = result.animStarts === 0 && result.replacements === 0 && result.sameNode && result.players === 2;
  console.log(pass ? '✅ STABLE — no pulsing' : '❌ still thrashing');
  process.exitCode = pass ? 0 : 1;
} catch (e) {
  console.error('probe error:', e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
