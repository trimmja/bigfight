// End-to-end online match test: two headless browsers drive the REAL merged
// flow (title tap → hub → create/join room → pick fighter + ready in the 3D
// battle lobby → countdown → rollback match) and verify both sims advance
// together with zero desyncs.
//
//   node scripts/e2e-online.mjs                              live Fly server
//   node scripts/e2e-online.mjs --url=.../bigfight/?localserver   local dev + local ws
//   node scripts/e2e-online.mjs --url=https://playbigfight.com/   deployed origin
import { chromium } from 'playwright';

const urlArg = process.argv.find((a) => a.startsWith('--url='));
const BASE = urlArg ? urlArg.slice(6) : 'http://localhost:5173/bigfight/';
// Deep-link join keeps any existing query (e.g. ?localserver) and adds join=.
const joinUrl = (code) => (BASE.includes('?') ? `${BASE}&join=${code}` : `${BASE}?join=${code}`);
const SHOTS = process.env.E2E_SHOTS ?? '';

const browser = await chromium.launch();
let failed = false;
const log = (who, msg) => console.log(`[${who}] ${msg}`);

async function newPlayer(name) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') console.error(`[${name}:console] ${m.text()}`);
  });
  page.on('pageerror', (e) => {
    failed = true;
    console.error(`[${name}:pageerror] ${e.message}`);
  });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  return page;
}

async function shot(page, label) {
  if (!SHOTS) return;
  await page.screenshot({ path: `${SHOTS}/${label}.png` }).catch(() => undefined);
}

async function clickText(page, text, timeout = 12000) {
  // Atomic in-page click: the lobby re-renders on every room snapshot, so a
  // located node can detach before Playwright's click lands. Finding and
  // clicking inside one evaluate() closes that race (and dodges the infinite
  // springy animations that break the stability wait).
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const clicked = await page.evaluate((needle) => {
      const nodes = [...document.querySelectorAll('button, [role="button"], .bf-card')];
      const hit = nodes.find((n) => (n.textContent ?? '').includes(needle));
      if (hit) {
        hit.click();
        return true;
      }
      return false;
    }, text);
    if (clicked) return;
    await page.waitForTimeout(250);
  }
  const bodyText = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 400));
  await page.screenshot({ path: `${SHOTS || '.'}/FAIL-${text.replace(/\W/g, '')}.png` }).catch(() => undefined);
  throw new Error(`clickText: "${text}" never appeared — page says: ${bodyText}`);
}

// Advance past the title screen (pointerdown anywhere → hub).
async function tapTitle(page) {
  await page.mouse.click(640, 360);
  await page.waitForTimeout(600);
}

try {
  const a = await newPlayer('A');
  const b = await newPlayer('B');

  // A: title tap → hub (FFA is the default mode) → create room.
  await tapTitle(a);
  await shot(a, 'a1-hub');
  await clickText(a, 'CREATE ROOM');
  // Read the 4-letter room code off the lobby chip.
  await a.waitForFunction(() => /\b[BCDFGHJKLMNPQRSTVWXZ]{4}\b/.test(document.body.innerText), null, {
    timeout: 15000,
  });
  const code = await a.evaluate(() => document.body.innerText.match(/\b([BCDFGHJKLMNPQRSTVWXZ]{4})\b/)?.[1]);
  log('A', `room code ${code}`);
  await shot(a, 'a2-lobby');

  // B: join via deep link (exercises ?join= too).
  await b.goto(joinUrl(code), { waitUntil: 'domcontentloaded' });
  await b.waitForTimeout(600);
  await tapTitle(b); // in case the deep-link still shows the title first
  await b.waitForFunction((c) => document.body.innerText.includes(`ROOM ${c}`), code, { timeout: 15000 });
  await b.waitForTimeout(1200);
  await shot(b, 'b1-joined');

  // Pick distinct fighters from the lobby carousel (so the pedestals differ).
  await clickText(a, 'Grim');
  await clickText(b, 'Kaze');
  await a.waitForTimeout(400);

  // Both ready in the lobby — readying sends the current pick too. Verify the
  // toggle landed (button flips to "✔ READY!"), retry if the snapshot raced.
  const readyUp = async (page, who) => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await clickText(page, 'READY');
      const confirmed = await page
        .waitForFunction(() => /✔ READY/.test(document.body.innerText), null, { timeout: 2500 })
        .then(() => true)
        .catch(() => false);
      if (confirmed) return;
      await page.waitForTimeout(600);
    }
    throw new Error(`${who}: ready never registered`);
  };
  await readyUp(a, 'A');
  await readyUp(b, 'B');
  log('*', 'both picked + ready — expecting countdown → READY TO FIGHT → match');
  await shot(a, 'a3-ready');

  // Match: NetMatchScreen mounted and sim frames advancing on BOTH peers.
  const getStats = () => {
    const top = window.bigfight?.screens?.top;
    return top && top.stats ? JSON.parse(JSON.stringify(top.stats)) : null;
  };
  const inMatch = async (page, who) => {
    await page
      .waitForFunction(() => {
        const top = window.bigfight?.screens?.top;
        return Boolean(top && top.stats && top.stats.frame >= 0);
      }, null, { timeout: 30000 })
      .catch(() => {
        throw new Error(`${who}: match never started`);
      });
  };
  await inMatch(a, 'A');
  await inMatch(b, 'B');
  log('*', 'match started on both peers — sampling frames');
  await shot(a, 'a5-match');
  await shot(b, 'b5-match');

  const f0a = (await a.evaluate(getStats))?.frame ?? -1;
  const f0b = (await b.evaluate(getStats))?.frame ?? -1;
  await a.waitForTimeout(8000);
  const statsA = await a.evaluate(getStats);
  const statsB = await b.evaluate(getStats);
  log('A', `frames ${f0a} → ${statsA?.frame} confirmed ${statsA?.confirmedFrame} rollbacks ${statsA?.rollbacks} desyncs ${statsA?.desyncs} stalls ${statsA?.stalledFrames}`);
  log('B', `frames ${f0b} → ${statsB?.frame} confirmed ${statsB?.confirmedFrame} rollbacks ${statsB?.rollbacks} desyncs ${statsB?.desyncs} stalls ${statsB?.stalledFrames}`);
  await shot(a, 'a6-match-late');
  await shot(b, 'b6-match-late');

  if (!statsA || !statsB) throw new Error('missing session stats');
  if (statsA.frame <= f0a + 200 || statsB.frame <= f0b + 200) {
    throw new Error('sim did not advance ~8s of frames — match stalled');
  }
  if (statsA.desyncs > 0 || statsB.desyncs > 0) {
    throw new Error(`DESYNCS detected: A ${statsA.desyncs} B ${statsB.desyncs}`);
  }
  if (Math.abs(statsA.frame - statsB.frame) > 90) {
    throw new Error(`peers drifted: A@${statsA.frame} vs B@${statsB.frame}`);
  }
  log('*', '✅ E2E ONLINE MATCH PASS');
} catch (err) {
  failed = true;
  console.error('E2E FAILED:', err);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
