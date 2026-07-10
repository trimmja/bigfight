// Probe the ACTUAL hub camera + where fighters project, at a real portrait
// viewport (what hub-shot uses). Tells the truth instead of guessing framing.
import { chromium } from 'playwright';
const BASE = 'http://localhost:5173/bigfight/';
const browser = await chromium.launch();
async function probe(w, h, tag) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.goto(BASE, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(700);
  for (let i = 0; i < 6; i += 1) {
    await p.mouse.click(w / 2, h / 2);
    const ok = await p.waitForFunction(() => document.body.innerText.includes('Choose your battle'), null, { timeout: 1500 }).then(() => true).catch(() => false);
    if (ok) break;
  }
  await p.waitForTimeout(3200);
  const out = await p.evaluate(() => {
    const g = window.bigfight;
    const cam = g.renderer.camera;
    const V = cam.position.constructor;
    const proj = (x, y, z) => { const v = new V(x, y, z); v.project(cam); return { sx: +(((v.x + 1) / 2) * 100).toFixed(1), sy: +(((1 - v.y) / 2) * 100).toFixed(1) }; };
    return {
      screen: g.screens?.top?.constructor?.name ?? g.screens?.current?.constructor?.name,
      aspect: +cam.aspect.toFixed(3), fov: +cam.fov.toFixed(1),
      camPos: [+cam.position.x.toFixed(2), +cam.position.y.toFixed(2), +cam.position.z.toFixed(2)],
      headCenter: proj(0, 3.6, 5.0), feetCenter: proj(0, 1.35, 5.0), headEdge: proj(7.2, 2.6, 6.4),
    };
  });
  console.log(tag, JSON.stringify(out));
  await ctx.close();
}
try { await probe(430, 830, 'PORTRAIT'); await probe(900, 420, 'LANDSCAPE'); }
catch (e) { console.error('probe err', e.message); }
finally { await browser.close(); }
