// Capture the "Choose your battle" hub with its cinematic roster backdrop, at
// mid-march and settled, in landscape + portrait. No server needed.
import { chromium } from 'playwright';
const BASE = process.argv.find((a) => a.startsWith('--url='))?.slice(6) ?? 'http://localhost:5173/bigfight/';
const OUT = process.env.SHOTS ?? '.';
const browser = await chromium.launch();

async function grab(w, h, tag) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log(`  [${tag} pageerror]`, e.message.slice(0, 140)));
  await p.goto(BASE, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(700);
  // Tap title → hub; retry until the hub actually appears (title tap can race).
  for (let i = 0; i < 6; i += 1) {
    await p.mouse.click(w / 2, h / 2);
    const inHub = await p
      .waitForFunction(() => document.body.innerText.includes('Choose your battle'), null, { timeout: 1500 })
      .then(() => true)
      .catch(() => false);
    if (inHub) break;
  }
  await p.waitForTimeout(850);
  await p.screenshot({ path: `${OUT}/hub-${tag}-march.png` });
  await p.waitForTimeout(2600);
  await p.screenshot({ path: `${OUT}/hub-${tag}-settled.png` });
  await ctx.close();
  console.log(`captured hub-${tag}-march + hub-${tag}-settled`);
}

try {
  await grab(900, 420, 'land');
  await grab(430, 830, 'port');
} catch (e) {
  console.error('shot error:', e.message);
} finally {
  await browser.close();
}
