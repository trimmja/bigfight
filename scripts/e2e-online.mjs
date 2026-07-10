// End-to-end online match test: two headless browsers drive the REAL flow
// (title → online → create/join room → ready → char select → rollback match
// over the live Fly relay) and verify both sims advance together.
//
//   node scripts/e2e-online.mjs            uses the running dev server :5173
//   node scripts/e2e-online.mjs --url=***  any deployed origin (e.g. playbigfight.com)
import { chromium } from 'playwright';

const urlArg = process.argv.find((a) => a.startsWith('--url='));
const BASE = urlArg ? urlArg.slice(6) : 'http://localhost:5173/bigfight/';
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

try {
  const a = await newPlayer('A');
  const b = await newPlayer('B');

  // A: title → online → create room.
  await clickText(a, 'ONLINE');
  await shot(a, 'a1-menu');
  await clickText(a, 'CREATE ROOM');
  // Read the 4-letter room code off the lobby.
  await a.waitForFunction(() => /\b[BCDFGHJKLMNPQRSTVWXZ]{4}\b/.test(document.body.innerText), null, {
    timeout: 15000,
  });
  const code = await a.evaluate(() => document.body.innerText.match(/\b([BCDFGHJKLMNPQRSTVWXZ]{4})\b/)?.[1]);
  log('A', `room code ${code}`);
  await shot(a, 'a2-lobby');

  // B: join via deep link (exercises ?join= too).
  await b.goto(`${BASE}?join=${code}`, { waitUntil: 'domcontentloaded' });
  await b.waitForTimeout(2500);
  await shot(b, 'b1-joined');

  // Both ready in the lobby — verify the toggle actually landed, retry if not.
  const readyUp = async (page, who) => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await clickText(page, 'READY');
      const confirmed = await page
        .waitForFunction(
          () => /TAP TO WAIT|TAP TO CHANGE|✔ READY/.test(document.body.innerText),
          null,
          { timeout: 2500 },
        )
        .then(() => true)
        .catch(() => false);
      if (confirmed) return;
      await page.waitForTimeout(600);
    }
    throw new Error(`${who}: ready never registered`);
  };
  await readyUp(a, 'A');
  await readyUp(b, 'B');
  log('*', 'both ready — countdown');
  await shot(a, 'a3-ready');

  // Countdown (3s) → char select.
  const inSelect = (page) =>
    page.waitForFunction(() => document.body.innerText.includes('PICK YOUR FIGHTER'), null, {
      timeout: 25000,
    });
  await inSelect(a);
  await inSelect(b);
  await shot(a, 'a4-charselect');

  // Pick fighters (click card by name) + ready (retry-verified again).
  await clickText(a, 'Volt').catch(() => clickText(a, 'VOLT'));
  await clickText(b, 'Kaze').catch(() => clickText(b, 'KAZE'));
  await a.waitForTimeout(400);
  await readyUp(a, 'A');
  await readyUp(b, 'B');
  log('*', 'picks locked — expecting READY TO FIGHT → match');

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
