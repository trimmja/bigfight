import { TIMESTEP } from '../config';
import { events } from '../core/events';
import type { Game } from '../Game';
import { ALL_POWERUP_IDS, type MatchConfig } from '../match/MatchConfig';
import { GameplayScreen } from '../screens/GameplayScreen';
import { encodeInput, NetIntentSource } from './inputCodec';
import { ScriptedIntentSource } from './replay';
import { RollbackSession } from './RollbackSession';
import { simPhase } from './simPhase';
import { LoopbackHub, type PeerSlot } from './transport';

/**
 * Rollback GOLDEN TEST (the M1 exit gate).
 *
 * Reference run: a 2-player FFA match simulated straight-line with two input
 * bots. Then the SAME match runs as two full netplay stacks (two screens, two
 * rollback sessions) over a lossy/jittery loopback network. If rollback is
 * correct, both peers converge to EXACTLY the reference digest — despite
 * hundreds of mispredictions and resims along the way.
 */

const TEST_FRAMES = 1500;
const SEED = 0xf17e;
const INPUT_SEED_A = 0xaaaa;
const INPUT_SEED_B = 0xbbbb;

export interface RollbackTestReport {
  pass: boolean;
  referenceDigest: string;
  peerADigest: string;
  peerBDigest: string;
  rollbacksA: number;
  rollbacksB: number;
  resimmedA: number;
  resimmedB: number;
  desyncs: number;
  detail: string;
}

function testMatchConfig(): MatchConfig {
  return {
    mode: 'ffa',
    players: [
      { slot: 0, characterId: 'volt', weaponId: 'rustyPistol', sidekickId: null, teamId: 1, nickname: 'A' },
      { slot: 1, characterId: 'kaze', weaponId: 'practiceSword', sidekickId: null, teamId: 2, nickname: 'B' },
    ],
    stageId: 'rooftop',
    stocks: 99, // nobody eliminates during the test window
    crates: true,
    powerupIds: [...ALL_POWERUP_IDS],
    seed: SEED,
  };
}

export function runRollbackTest(game: Game): RollbackTestReport {
  events.setSuppressed(true);
  try {
    // --- reference: straight-line 2P sim ---
    const refDigest = runReference(game);

    // --- netplay: two full stacks over a hostile loopback network ---
    const hub = new LoopbackHub();
    hub.delayMs = 100;
    hub.jitterMs = 30;
    hub.lossRate = 0.05;

    const peerA = createPeer(game, hub, 0, INPUT_SEED_A);
    const peerB = createPeer(game, hub, 1, INPUT_SEED_B);

    // Drive both peers + the network until both simulate TEST_FRAMES.
    let guard = TEST_FRAMES * 40;
    while ((peerA.session.frame < TEST_FRAMES || peerB.session.frame < TEST_FRAMES) && guard > 0) {
      hub.pump(1000 * TIMESTEP);
      if (peerA.session.frame < TEST_FRAMES) peerA.session.pump(1);
      if (peerB.session.frame < TEST_FRAMES) peerB.session.pump(1);
      guard -= 1;
    }
    // Drain: deliver the tail inputs (rebroadcast beats loss) and let final
    // rollbacks converge both peers onto fully-confirmed state.
    for (let i = 0; i < 240; i += 1) {
      hub.pump(1000 * TIMESTEP);
      peerA.session.flush();
      peerB.session.flush();
    }

    const aDigest = peerA.screen.stateDigest();
    const bDigest = peerB.screen.stateDigest();
    const statsA = peerA.session.stats;
    const statsB = peerB.session.stats;

    let detail = '';
    if (guard <= 0) detail = `TIMEOUT: A@${peerA.session.frame} B@${peerB.session.frame}`;
    else if (aDigest !== bDigest) detail = diffPeers(peerA.screen, peerB.screen);
    else if (aDigest !== refDigest) detail = 'peers agree but differ from the straight-line reference';
    else if (statsA.rollbacks === 0 && statsB.rollbacks === 0) {
      detail = 'no rollbacks occurred — the network conditions did not exercise the engine';
    }

    peerA.screen.exit(game);
    peerB.screen.exit(game);

    const pass =
      guard > 0 &&
      aDigest === bDigest &&
      aDigest === refDigest &&
      statsA.rollbacks + statsB.rollbacks > 0 &&
      statsA.desyncs === 0;

    return {
      pass,
      referenceDigest: hex(refDigest),
      peerADigest: hex(aDigest),
      peerBDigest: hex(bDigest),
      rollbacksA: statsA.rollbacks,
      rollbacksB: statsB.rollbacks,
      resimmedA: statsA.resimmedFrames,
      resimmedB: statsB.resimmedFrames,
      desyncs: statsA.desyncs + statsB.desyncs,
      detail,
    };
  } finally {
    events.setSuppressed(false);
    simPhase.resimulating = false;
  }
}

function runReference(game: Game): number {
  const botA = new ScriptedIntentSource(INPUT_SEED_A);
  const botB = new ScriptedIntentSource(INPUT_SEED_B);
  // Mirror the netplay input path EXACTLY: encode → NetIntentSource decode,
  // including the 2-frame input delay the sessions apply.
  const srcA = new NetIntentSource();
  const srcB = new NetIntentSource();
  const screen = new GameplayScreen({
    match: testMatchConfig(),
    characterId: 'volt',
    intentSources: [srcA, srcB],
    localSlot: 0,
    onMatchEnd: () => undefined,
    onLevelEnd: () => undefined,
  });
  screen.enter(game);

  const delay = 2;
  const encodedA: Uint8Array[] = [];
  const encodedB: Uint8Array[] = [];
  for (let f = 0; f < delay; f += 1) {
    encodedA.push(new Uint8Array(3));
    encodedB.push(new Uint8Array(3));
  }
  for (let f = 0; f < TEST_FRAMES; f += 1) {
    botA.step();
    botB.step();
    const a = new Uint8Array(3);
    const b = new Uint8Array(3);
    encodeInput(botA.state, a, 0);
    encodeInput(botB.state, b, 0);
    encodedA.push(a);
    encodedB.push(b);
    srcA.applyFrame(encodedA[f]!, 0);
    srcB.applyFrame(encodedB[f]!, 0);
    screen.update(game, TIMESTEP);
  }
  const digest = screen.stateDigest();
  screen.exit(game);
  return digest;
}

function createPeer(game: Game, hub: LoopbackHub, slot: PeerSlot, inputSeed: number) {
  const sources = [new NetIntentSource(), new NetIntentSource()];
  const screen = new GameplayScreen({
    match: testMatchConfig(),
    characterId: slot === 0 ? 'volt' : 'kaze',
    intentSources: sources,
    localSlot: slot,
    onMatchEnd: () => undefined,
    onLevelEnd: () => undefined,
  });
  screen.enter(game);
  const bot = new ScriptedIntentSource(inputSeed);
  const session = new RollbackSession({
    game,
    screen,
    transport: hub.endpoint(slot),
    localSlot: slot,
    playerCount: 2,
    sources,
    sampleLocalInput: () => {
      bot.step();
      return bot.state;
    },
  });
  return { screen, session, bot };
}

function diffPeers(a: GameplayScreen, b: GameplayScreen): string {
  const dumpA = a.stateDump();
  const dumpB = b.stateDump();
  const lines: string[] = [];
  for (let i = 0; i < Math.max(dumpA.length, dumpB.length); i += 1) {
    const segA = dumpA[i];
    const segB = dumpB[i];
    if (!segA || !segB) {
      lines.push(`segment ${i}: ${segA?.label ?? segB?.label} missing on one peer`);
      continue;
    }
    for (let v = 0; v < Math.max(segA.values.length, segB.values.length); v += 1) {
      if (segA.values[v] !== segB.values[v]) lines.push(`${segA.label}[${v}]: ${segA.values[v]} vs ${segB.values[v]}`);
    }
  }
  return lines.slice(0, 24).join('\n');
}

function hex(n: number): string {
  return (n >>> 0).toString(16).padStart(8, '0');
}
