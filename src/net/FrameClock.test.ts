import assert from 'node:assert/strict';
import test from 'node:test';
import { FrameClock } from './FrameClock';
import { chooseNetworkTuning } from './tuning';

test('server-timestamped reconnect pauses do not advance the match clock', () => {
  const clock = new FrameClock();
  clock.start(1_000);
  assert.equal(clock.targetFrame(1_200), 12);
  clock.pause(1_200);
  clock.resume(1_200, 4_200);
  assert.equal(clock.targetFrame(4_200), 12);
  assert.equal(clock.targetFrame(4_300), 18);
});

test('network tuning stays responsive for direct links and cushions relay links', () => {
  const direct = chooseNetworkTuning([{ rttMs: 24, jitterMs: 2, path: 'p2p', connected: true }]);
  assert.deepEqual(direct, {
    inputDelayFrames: 2,
    rollbackWindowFrames: 12,
    effectiveOneWayMs: 16,
    path: 'p2p',
  });
  const relay = chooseNetworkTuning([{ rttMs: 24, jitterMs: 2, path: 'relay', connected: true }]);
  assert.equal(relay.inputDelayFrames, 3);
  assert.equal(relay.rollbackWindowFrames, 15);
  assert.equal(relay.path, 'relay');
});
