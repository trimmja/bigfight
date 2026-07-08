import { TIMESTEP, MAX_FRAME_DELTA, MAX_STEPS_PER_FRAME } from '../config';

/**
 * Fixed-timestep game loop. `update` runs at exactly TIMESTEP; `render` runs
 * once per rAF with the interpolation alpha (unused in v1 — we render latest
 * state). Returns a stop function.
 */
export function startLoop(
  update: (dt: number) => void,
  render: (alpha: number) => void,
): () => void {
  let last = performance.now();
  let accumulator = 0;
  let rafId = 0;
  let running = true;

  function frame(now: number) {
    if (!running) return;
    rafId = requestAnimationFrame(frame);

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

    render(accumulator / TIMESTEP);
  }

  rafId = requestAnimationFrame(frame);
  return () => {
    running = false;
    cancelAnimationFrame(rafId);
  };
}
