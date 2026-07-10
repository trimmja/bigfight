import assert from 'node:assert/strict';
import test from 'node:test';
import type { MatchLaunch, RoomPlayer } from '../../shared/protocol';
import { buildMatchConfig } from '../online/OnlineSession';

test('room launches become identical contiguous FFA match configs', () => {
  const config = buildMatchConfig(launch('ffa', [player(0, 'A', null), player(1, 'B', null)]));
  assert.equal(config.mode, 'ffa');
  assert.equal(config.stageId, 'rooftop');
  assert.deepEqual(config.players.map((entry) => entry.teamId), [1, 2]);
  assert.deepEqual(config.players.map((entry) => entry.characterId), ['volt', 'kaze']);
});

test('team room picks map to shared simulation team ids', () => {
  const config = buildMatchConfig(launch('teams', [player(0, 'A', 'A'), player(1, 'B', 'B')]));
  assert.deepEqual(config.players.map((entry) => entry.teamId), [1, 2]);
});

test('a slot gap is rejected before constructing the game simulation', () => {
  assert.throws(() => buildMatchConfig(launch('ffa', [player(0, 'A', null), player(2, 'B', null)])), /invalid fighter slot/);
});

function launch(mode: 'ffa' | 'teams', players: RoomPlayer[]): MatchLaunch {
  return {
    matchId: 'match-1',
    seed: 123,
    startAt: 10_000,
    settings: { mode, stocks: 3, stageId: 'rooftop', levelId: 1 },
    players,
  };
}

function player(slot: 0 | 1 | 2 | 3, nickname: string, team: 'A' | 'B' | null): RoomPlayer {
  return {
    playerId: `player-${slot}`,
    slot,
    nickname,
    characterId: slot === 0 ? 'volt' : 'kaze',
    weaponId: slot === 0 ? 'rustyPistol' : 'practiceSword',
    team,
    ready: true,
    connected: true,
    danceSeq: 0,
  };
}
