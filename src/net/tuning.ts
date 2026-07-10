import type { PeerStats } from './transport';

export interface NetworkTuning {
  inputDelayFrames: number;
  rollbackWindowFrames: number;
  effectiveOneWayMs: number;
  path: 'p2p' | 'relay' | 'local';
}

/**
 * Choose match-start rollback settings from measured peer links. Tuning is
 * fixed for the duration of a match; changing input delay after frames have
 * been numbered would itself create divergent timelines.
 */
export function chooseNetworkTuning(peers: readonly PeerStats[]): NetworkTuning {
  let effectiveOneWayMs = 0;
  let path: NetworkTuning['path'] = 'local';
  for (const peer of peers) {
    const budget = Math.max(0, peer.rttMs * 0.5) + Math.max(0, peer.jitterMs) * 2;
    effectiveOneWayMs = Math.max(effectiveOneWayMs, budget);
    if (peer.path === 'relay') path = 'relay';
    else if (peer.path === 'p2p' && path === 'local') path = 'p2p';
  }

  let inputDelayFrames: number;
  let rollbackWindowFrames: number;
  if (effectiveOneWayMs <= 45) {
    inputDelayFrames = 2;
    rollbackWindowFrames = 12;
  } else if (effectiveOneWayMs <= 80) {
    inputDelayFrames = 3;
    rollbackWindowFrames = 15;
  } else if (effectiveOneWayMs <= 120) {
    inputDelayFrames = 4;
    rollbackWindowFrames = 20;
  } else {
    inputDelayFrames = 5;
    rollbackWindowFrames = 24;
  }

  // Relay is a fallback path with an extra server hop and TCP head-of-line
  // risk. Give it more delay/buffer instead of pretending it behaves as P2P.
  if (path === 'relay') {
    inputDelayFrames = Math.min(6, inputDelayFrames + 1);
    rollbackWindowFrames = Math.min(28, rollbackWindowFrames + 3);
  }

  return { inputDelayFrames, rollbackWindowFrames, effectiveOneWayMs, path };
}
