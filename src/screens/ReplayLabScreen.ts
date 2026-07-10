import type { Game } from '../Game';
import { FIXTURES, runReplayCheck, type FixtureReport } from '../net/replay';
import { button, el, uiRoot } from '../ui/dom';
import type { Screen } from './Screen';

/**
 * Replay Lab (`?replaylab` URL flag; `&ci` auto-runs and exposes results on
 * window.__replayResult for scripts/replay-ci.mjs). Dev tool — proves sim
 * determinism (M0 gate) and measures pure-sim step cost. Run it on the iPhone
 * over the LAN dev server for the cross-engine (V8 vs JSC) digest check: the
 * finalDigest hex per fixture must match across devices.
 */
export class ReplayLabScreen implements Screen {
  private root: HTMLElement | null = null;
  private output: HTMLPreElement | null = null;

  enter(game: Game): void {
    const root = uiRoot('bf-replay-lab');
    root.style.cssText =
      'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;' +
      'gap:14px;padding:28px;overflow:auto;background:rgba(20,28,52,0.92);z-index:40;';
    this.root = root;

    const title = el('div', 'bf-title');
    title.textContent = 'REPLAY LAB';
    title.style.cssText = 'font-size:34px;color:#fff;';
    root.appendChild(title);

    const info = el('div');
    info.style.cssText = 'color:#bfe8ff;font-size:14px;max-width:640px;text-align:center;';
    info.textContent =
      `Runs ${FIXTURES.length} scripted fixtures twice each and compares per-frame state ` +
      'digests. PASS = the sim is deterministic (rollback-ready). finalDigest must also ' +
      'match across devices (desktop vs iPhone).';
    root.appendChild(info);

    const runButton = button('RUN DETERMINISM CHECK', () => this.run(game, runButton));
    root.appendChild(runButton);

    const output = document.createElement('pre');
    output.style.cssText =
      'color:#d9f6ff;font:13px/1.5 ui-monospace,Consolas,monospace;background:rgba(0,0,0,0.35);' +
      'padding:14px 18px;border-radius:12px;max-width:860px;white-space:pre-wrap;';
    output.textContent = 'idle';
    this.output = output;
    root.appendChild(output);

    const w = window as unknown as {
      __replayCheck?: () => FixtureReport[];
      __replayResult?: FixtureReport[];
    };
    w.__replayCheck = () => this.run(game, runButton);

    if (location.search.includes('ci')) {
      // CI mode: run after first paint, publish results for Playwright.
      setTimeout(() => {
        w.__replayResult = this.run(game, runButton);
      }, 300);
    }
  }

  exit(_game: Game): void {
    this.root?.remove();
    this.root = null;
    this.output = null;
    const w = window as unknown as { __replayCheck?: unknown };
    delete w.__replayCheck;
  }

  update(_game: Game, _dt: number): void {}

  private run(game: Game, runButton: HTMLButtonElement): FixtureReport[] {
    runButton.disabled = true;
    if (this.output) this.output.textContent = 'running…';
    const reports = runReplayCheck(game);
    const lines: string[] = [];
    for (const r of reports) {
      lines.push(
        `${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  (${r.frames} frames)`,
        `    finalDigest ${r.finalDigest}   sim step avg ${r.stepMsAvg.toFixed(3)}ms  max ${r.stepMsMax.toFixed(2)}ms`,
      );
      if (!r.pass) {
        lines.push(`    first divergence at frame ${r.firstDivergence}:`, r.divergenceDetail);
      }
    }
    const text = lines.join('\n');
    if (this.output) this.output.textContent = text;
    console.log(`[replaylab]\n${text}`);
    runButton.disabled = false;
    return reports;
  }
}
