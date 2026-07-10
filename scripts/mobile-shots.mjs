// Screenshot the online hub + lobby at true mobile viewports (landscape +
// portrait) so the responsive design can be eyeballed. Dev-only tool.
import { chromium, devices } from 'playwright';

const BASE = 'http://localhost:5173/bigfight/';
const OUT = process.env.SHOTS || '.';
const browser = await chromium.launch();

async function shot(name, viewport, isLandscape) {
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  // Jump straight to the hub.
  await page.evaluate(async () => {
    const m = await import('/bigfight/src/flowOnline.ts');
    m.goOnlineMenu(window.bigfight);
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/hub-${name}.png` });
  // And create a room to see the lobby controls.
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    btns.find((b) => b.textContent.includes('CREATE'))?.click();
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/lobby-${name}.png` });
  const info = await page.evaluate(() => ({
    portrait: matchMedia('(orientation: portrait)').matches,
    short: matchMedia('(max-height: 500px)').matches,
    w: innerWidth,
    h: innerHeight,
  }));
  console.log(`${name}: ${JSON.stringify(info)}`);
  await ctx.close();
}

await shot('landscape', { width: 844, height: 390 }, true);
await shot('portrait', { width: 390, height: 844 }, false);
await browser.close();
console.log('done');
