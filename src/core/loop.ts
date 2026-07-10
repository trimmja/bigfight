import { TIMESTEP, MAX_FRAME_DELTA, MAX_STEPS_PER_FRAME } from '../config';

/**
 * Fixed-timestep game loop. `update` runs at exactly TIMESTEP; `render` runs
 * once per rAF with the interpolation alpha (unused in v1 — we render latest
 * state). Returns a stop function.
 *
 * Hidden-tab stepping: rAF pauses in occluded/backgrounded Chrome (documented
 * repo gotcha — "the game froze"), which would also stall a netplay peer's
 * input stream. A dedicated Worker clock (worker timers are not visibility-
 * throttled) drives the accumulator while the tab is hidden; render is skipped
 * (nothing visible to draw). rAF resumes seamlessly on focus.
 */
export function startLoop(
  update: (dt: number) => void,
  render: (alpha: number) => void,
): () => void {
  let last = performance.now();
  let accumulator = 0;
  let rafId = 0;
  let running = true;

  function tick(now: number, hidden: boolean) {
    let delta = (now - last) / 1000;
    last = now;
    if (delta > MAX_FRAME_DELTA) delta = MAX_FRAME_DELTA;

    accumulator += delta;
    let steps = 0;
    while (accumulator >= TIMESTEP && steps < MAX_STEPS_PER_FRAME) {
      update(TIMESTEP);
      accumulator -= TIMESTEP;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) accumulator = 0; // spiral-of-death guard

    if (!hidden) render(accumulator / TIMESTEP);
  }

  function frame(now: number) {
    if (!running) return;
    rafId = requestAnimationFrame(frame);
    tick(now, false);
  }

  // Worker clock: ~4ms pings, consumed only while the document is hidden.
  const worker = createClockWorker();
  if (worker) {
    worker.onmessage = () => {
      if (!running || document.visibilityState !== 'hidden') return;
      tick(performance.now(), true);
    };
  }
  const onVisibility = () => {
    // Re-anchor the clock on driver swaps so no giant delta accumulates.
    last = performance.now();
  };
  document.addEventListener('visibilitychange', onVisibility);

  rafId = requestAnimationFrame(frame);
  return () => {
    running = false;
    cancelAnimationFrame(rafId);
    document.removeEventListener('visibilitychange', onVisibility);
    worker?.terminate();
  };
}

function createClockWorker(): Worker | null {
  try {
    const src = 'setInterval(function(){postMessage(0)},4);';
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    const worker = new Worker(url);
    URL.revokeObjectURL(url);
    return worker;
  } catch {
    return null; // CSP or ancient browser — hidden-tab stepping unavailable.
  }
}
