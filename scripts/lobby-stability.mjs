// Prove the merged battle lobby doesn't thrash: two players sit in a static
// lobby, then we count nameplate re-renders (childList mutations from
// replaceChildren) + pop/stamp animationstarts over 6s while the server keeps
// sending ~1/s ping snapshots. The signature gate should keep both at 0.
import { chromium } from 'playwright';

const BASE = process.argv.find((a) => a.startsWith('--url='))?.slice(6) ?? 'http://localhost:5173/bigfight/';
const joinUrl = (code) => (BASE.includes('?') ? `${BASE}&join=${code}` : `${BASE}?join=${code}`);
const browser = await chromium.launch();

async function player() {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 620 } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  return page;
}
async function click(page, text) {
  const ok = await page.evaluate((t) => {
    const n = [...document.querySelectorAll('button,[role=button],.bf-mode-card,.bf-card')].find((e) => (e.textContent ?? '').includes(t));
    if (n) { n.click(); return true; }
    return false;
  }, text);
  if (!ok) throw new Error(`no "${text}"`);
}
async function tapTitle(page) {
  await page.mouse.click(500, 310);
  await page.waitForTimeout(600);
}

try {
  const a = await player();
  const b = await player();
  await tapTitle(a); // title → hub
  await click(a, 'CREATE ROOM');
  await a.waitForFunction(() => /\b[BCDFGHJKLMNPQRSTVWXZ]{4}\b/.test(document.body.innerText), null, { timeout: 15000 });
  const code = await a.evaluate(() => document.body.innerText.match(/\b([BCDFGHJKLMNPQRSTVWXZ]{4})\b/)?.[1]);
  await b.goto(joinUrl(code), { waitUntil: 'domcontentloaded' });
  await b.waitForTimeout(600);
  await tapTitle(b);
  await b.waitForFunction((c) => document.body.innerText.includes(`ROOM ${c}`), code, { timeout: 15000 });
  await b.waitForTimeout(1500);

  // Both players in the lobby (static — nobody picks/readies). Instrument A:
  // watch the nameplate layer for childList mutations (a plate re-render) and
  // pop/stamp animations while ping snapshots keep arriving.
  await a.waitForSelector('.bf-plate', { timeout: 8000 });
  const result = await a.evaluate(async () => {
    const layer = document.querySelector('.bf-plate-layer');
    const p0 = layer.children[0];
    let animStarts = 0;
    let childMutations = 0;
    layer.addEventListener('animationstart', (e) => {
      if (/pop|stamp/i.test(e.animationName ?? '')) animStarts += 1;
    }, true);
    const mo = new MutationObserver((muts) => { for (const m of muts) childMutations += m.addedNodes.length; });
    // Observe the whole layer subtree — renderPlate's replaceChildren would show here.
    mo.observe(layer, { childList: true, subtree: true });
    await new Promise((r) => setTimeout(r, 6000));
    mo.disconnect();
    const filled = [...layer.children].filter((c) => !c.classList.contains('bf-plate-empty')).length;
    return { animStarts, childMutations, sameNode: layer.children[0] === p0, filled };
  });
  console.log('lobby stability over 6s (2 players, static):', JSON.stringify(result));
  const pass = result.animStarts === 0 && result.childMutations === 0 && result.sameNode && result.filled === 2;
  console.log(pass ? '✅ STABLE — no pulsing/re-render' : '❌ still thrashing');
  process.exitCode = pass ? 0 : 1;
} catch (e) {
  console.error('probe error:', e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
