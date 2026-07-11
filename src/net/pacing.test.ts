import assert from 'node:assert/strict';
import test from 'node:test';
import type { InputState } from '../contracts';
import type { Game } from '../Game';
import type { GameplayScreen } from '../screens/GameplayScreen';
import { FrameClock } from './FrameClock';
import { NetIntentSource } from './inputCodec';
import {
  CATCHUP_LIMIT_FRAMES,
  MatchPacer,
  MAX_STEPS_PER_RENDER,
  STALL_BANNER_UPDATES,
} from './pacing';
import { RollbackSession } from './RollbackSession';
import type { StateIO } from './snapshots';
import { LoopbackHub, type PeerSlot } from './transport';

/**
 * Real-time pacing regression test: two full rollback stacks over a loopback
 * network, driven exactly like NetMatchScreen drives them (FrameClock +
 * MatchPacer, one render per 60Hz tick), with a ~500ms TOTAL packet outage
 * mid-fight. This is the scenario behind the live "freeze → fast-forward →
 * flicker" report: the freeze must be bounded, recovery must come from the
 * reliable repair exchange (the outage outlives the redundant packet tail),
 * and the backlog must be dropped via the clock — never replayed as a burst.
 */

const TICK_MS = 1000 / 60;

/** Deterministic input bot: held buttons + axes vary on small prime cycles. */
class ScriptedBot {
  readonly state: InputState = {
    moveX: 0,
    moveY: 0,
    jumpPressed: false,
    jumpHeld: false,
    attackPressed: false,
    attackHeld: false,
    weaponPressed: false,
    weaponHeld: false,
    pausePressed: false,
    anyPressed: false,
  };
  private frame = 0;

  constructor(private readonly seed: number) {}

  step(): InputState {
    const f = this.frame + this.seed;
    this.state.moveX = ((f % 37) / 18) - 1;
    this.state.moveY = ((f % 23) / 11) - 1;
    this.state.jumpHeld = f % 13 < 4;
    this.state.attackHeld = f % 17 < 6;
    this.state.weaponHeld = f % 29 < 3;
    this.frame += 1;
    return this.state;
  }
}

/** Minimal deterministic "sim" satisfying the RollbackSession screen surface. */
class FakeScreen {
  x = 0;
  vy = 0;
  frames = 0;

  constructor(private readonly sources: NetIntentSource[]) {}

  update(_game: Game, _dt: number): void {
    for (let i = 0; i < this.sources.length; i += 1) {
      const s = this.sources[i]!.state;
      this.x += s.moveX * (i + 1);
      if (s.jumpPressed) this.vy += 5;
      if (s.attackHeld) this.x -= 0.25;
    }
    this.vy *= 0.98;
    this.x += this.vy * 0.01;
    this.frames += 1;
  }

  writeSnapshot(io: StateIO): void {
    io.beginWrite();
    this.sync(io);
  }

  readSnapshot(io: StateIO): void {
    io.beginRead();
    this.sync(io);
  }

  reconcileView(): void {}

  digest(): string {
    return `${this.x.toFixed(6)}|${this.vy.toFixed(6)}|${this.frames}`;
  }

  private sync(io: StateIO): void {
    this.x = io.f64(this.x);
    this.vy = io.f64(this.vy);
    this.frames = io.i32(this.frames);
  }
}

interface Peer {
  screen: FakeScreen;
  session: RollbackSession;
  clock: FrameClock;
  pacer: MatchPacer;
}

function createPeer(hub: LoopbackHub, slot: PeerSlot, seed: number): Peer {
  const sources = [new NetIntentSource(), new NetIntentSource()];
  const screen = new FakeScreen(sources);
  const bot = new ScriptedBot(seed);
  const session = new RollbackSession({
    game: null as unknown as Game,
    screen: screen as unknown as GameplayScreen,
    transport: hub.endpoint(slot),
    localSlot: slot,
    playerCount: 2,
    sources,
    inputDelay: 2,
    rollbackWindow: 18,
    sampleLocalInput: () => bot.step(),
  });
  const clock = new FrameClock();
  clock.start(0);
  return { screen, session, clock, pacer: new MatchPacer() };
}

/** One 60Hz browser tick, exactly as NetMatchScreen paces it. */
function driveTick(peer: Peer, nowMs: number): number {
  const before = peer.session.frame;
  const steps = peer.pacer.plan(peer.clock, nowMs, before);
  if (steps > 0) peer.session.pump(steps);
  else peer.session.flush();
  peer.pacer.observe(steps, before, peer.session.frame);
  const stepped = peer.session.frame - before;
  peer.pacer.onRender();
  return stepped;
}

test('a ~500ms mid-fight packet outage stalls, self-repairs, and resumes without a burst', () => {
  const hub = new LoopbackHub();
  hub.delayMs = 40;
  hub.jitterMs = 10;
  hub.lossRate = 0.02;
  const a = createPeer(hub, 0, 1000);
  const b = createPeer(hub, 1, 5000);
  const peers = [a, b];

  const OUTAGE_START = 300; // ticks (~5s in)
  const OUTAGE_END = 330; // 30 ticks = 500ms of total game-packet loss
  let maxStepsPerRender = 0;
  let stallSeen = false;
  let frameAtOutageEnd = 0;

  for (let tick = 0; tick < 900; tick += 1) {
    if (tick === OUTAGE_START) hub.lossRate = 1;
    if (tick === OUTAGE_END) {
      hub.lossRate = 0.02;
      frameAtOutageEnd = a.session.frame;
    }
    hub.pump(TICK_MS);
    const now = tick * TICK_MS;
    for (const peer of peers) {
      maxStepsPerRender = Math.max(maxStepsPerRender, driveTick(peer, now));
    }
    if (a.pacer.connectionStalled || b.pacer.connectionStalled) stallSeen = true;
  }

  // The outage exceeded the redundant packet tail (peers simulate a full
  // rollback window INTO an outage), so recovery proves the automatic
  // stall-triggered repair exchange — without it this run stays frozen.
  assert.ok(
    a.session.frame > frameAtOutageEnd + 400,
    `sim never recovered after the outage (frame ${a.session.frame} vs ${frameAtOutageEnd} at outage end)`,
  );

  // The freeze was long enough that the stall detector must have fired.
  assert.ok(stallSeen, 'the connection-stall banner state never triggered');
  assert.ok(a.pacer.stats.stalledUpdates >= STALL_BANNER_UPDATES, 'peer A never accumulated stalled updates');

  // The recovery backlog was dropped via the clock, never replayed as a
  // fast-forward: per rendered frame the sim advanced a bounded step count.
  assert.ok(maxStepsPerRender <= MAX_STEPS_PER_RENDER, `sim burst: ${maxStepsPerRender} steps in one render`);
  assert.ok(a.pacer.stats.clockShiftFrames > 0, 'peer A never shifted its clock to drop the backlog');
  assert.ok(b.pacer.stats.clockShiftFrames > 0, 'peer B never shifted its clock to drop the backlog');

  // Both peers converged on identical state: align frames, drain, compare.
  const targetFrame = Math.max(a.session.frame, b.session.frame);
  let guard = 2000;
  while ((a.session.frame < targetFrame || b.session.frame < targetFrame) && guard > 0) {
    hub.pump(TICK_MS);
    if (a.session.frame < targetFrame) a.session.pump(1);
    else a.session.flush();
    if (b.session.frame < targetFrame) b.session.pump(1);
    else b.session.flush();
    guard -= 1;
  }
  assert.ok(guard > 0, 'peers never aligned on a common frame');
  for (let i = 0; i < 120; i += 1) {
    hub.pump(TICK_MS);
    a.session.flush();
    b.session.flush();
  }
  assert.equal(a.screen.digest(), b.screen.digest(), 'peers diverged');
  assert.equal(a.session.stats.desyncs + b.session.stats.desyncs, 0);
  assert.ok(a.session.stats.rollbacks + b.session.stats.rollbacks > 0, 'network never exercised rollback');
});

test('the pacer follows the clock: no steps when ahead, bounded catch-up, big backlogs dropped', () => {
  const clock = new FrameClock();
  clock.start(0);
  const pacer = new MatchPacer();

  // On pace: target frame 10 at t=166.7ms, session at 10 → zero steps.
  assert.equal(pacer.plan(clock, 10 * TICK_MS, 10), 0);

  // Slightly behind: catch up, but never faster than 2× per update.
  assert.equal(pacer.plan(clock, 10 * TICK_MS, 6), 2);

  // Hugely behind (rAF throttle / network stall): the backlog is dropped by
  // shifting the clock so exactly one step remains — never fast-forwarded.
  const steps = pacer.plan(clock, 600 * TICK_MS, 100);
  assert.equal(steps, 1);
  assert.ok(pacer.stats.clockShiftFrames >= 600 - 100 - CATCHUP_LIMIT_FRAMES);
  assert.equal(clock.targetFrame(600 * TICK_MS), 101);

  // The per-render budget caps total steps between renders (a mild 8-frame
  // backlog, below the drop threshold, so catch-up alone is exercised).
  pacer.onRender();
  let total = 0;
  for (let i = 0; i < 5; i += 1) {
    const frame = 193 + total; // target here is 201 after the shift above
    const planned = pacer.plan(clock, 700 * TICK_MS, frame);
    pacer.observe(planned, frame, frame + planned);
    total += planned;
  }
  assert.equal(total, MAX_STEPS_PER_RENDER);

  // Sustained no-progress updates flip the stall flag; progress clears it.
  const stallPacer = new MatchPacer();
  const stallClock = new FrameClock();
  stallClock.start(0);
  for (let i = 0; i < STALL_BANNER_UPDATES; i += 1) {
    stallPacer.onRender();
    const planned = stallPacer.plan(stallClock, (i + 1) * TICK_MS, 0);
    stallPacer.observe(planned, 0, 0);
  }
  assert.ok(stallPacer.connectionStalled);
  stallPacer.observe(1, 0, 1);
  assert.ok(!stallPacer.connectionStalled);
});
