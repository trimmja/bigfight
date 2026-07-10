import assert from 'node:assert/strict';
import test from 'node:test';
import { RoomDirectory, RoomError } from './rooms';

function directory() {
  let now = 1_000;
  let id = 0;
  let code = 0;
  const rooms = new RoomDirectory({
    now: () => now,
    createId: () => `room-${++id}`,
    createCode: () => `BCD${++code}`,
    createSeed: () => 12345,
  });
  return { rooms, tick: (ms: number) => { now += ms; } };
}

function ready(rooms: RoomDirectory, playerId: string, characterId: string) {
  rooms.setPlayer(playerId, { characterId, ready: true });
}

test('public rooms are discoverable and private rooms require their code', () => {
  const { rooms } = directory();
  const publicRoom = rooms.create({ playerId: 'a', releaseId: 'release-1', nickname: 'Alpha', visibility: 'public' });
  const privateRoom = rooms.create({ playerId: 'b', releaseId: 'release-1', nickname: 'Bravo', visibility: 'private' });
  assert.deepEqual(rooms.listPublic('release-1').map((room) => room.id), [publicRoom.id]);
  assert.equal(rooms.join({ playerId: 'c', releaseId: 'release-1', nickname: 'Charlie', roomId: publicRoom.id }).players.length, 2);
  assert.equal(rooms.join({ playerId: 'd', releaseId: 'release-1', nickname: 'Delta', code: privateRoom.code }).players.length, 2);
});

test('release mismatches fail before a player enters the room', () => {
  const { rooms } = directory();
  const room = rooms.create({ playerId: 'a', releaseId: 'release-1', nickname: 'Alpha', visibility: 'public' });
  assert.throws(
    () => rooms.join({ playerId: 'b', releaseId: 'release-2', nickname: 'Bravo', roomId: room.id }),
    (error: unknown) => error instanceof RoomError && error.code === 'releaseMismatch',
  );
  assert.equal(rooms.get(room.id)?.players.length, 1);
});

test('a completed match returns to the same lobby with picks and players intact', () => {
  const { rooms, tick } = directory();
  const room = rooms.create({ playerId: 'a', releaseId: 'release-1', nickname: 'Alpha', visibility: 'public' });
  rooms.join({ playerId: 'b', releaseId: 'release-1', nickname: 'Bravo', roomId: room.id });
  ready(rooms, 'a', 'volt');
  ready(rooms, 'b', 'kaze');
  const countdown = rooms.startCountdown('a');
  tick(3_000);
  const launch = rooms.beginMatch(countdown.id);
  const results = rooms.finishMatch('a', launch.matchId, { placements: [1, 0], kosBySlot: [1, 2] });
  assert.equal(results.phase, 'results');
  const lobby = rooms.returnToLobby('a');
  assert.equal(lobby.phase, 'lobby');
  assert.deepEqual(lobby.players.map((player) => player.characterId), ['volt', 'kaze']);
  assert.deepEqual(lobby.players.map((player) => player.ready), [false, false]);
  assert.equal(lobby.players.length, 2);
  assert.equal(lobby.matchId, null);
});

test('host departure migrates ownership instead of closing the room', () => {
  const { rooms } = directory();
  const room = rooms.create({ playerId: 'a', releaseId: 'release-1', nickname: 'Alpha', visibility: 'public' });
  rooms.join({ playerId: 'b', releaseId: 'release-1', nickname: 'Bravo', roomId: room.id });
  rooms.join({ playerId: 'c', releaseId: 'release-1', nickname: 'Charlie', roomId: room.id });
  const migrated = rooms.removePlayer('a');
  assert.equal(migrated?.hostId, 'b');
  assert.deepEqual(migrated?.players.map((player) => player.playerId), ['b', 'c']);
});

test('countdown requires two selected ready players and cancels on unready', () => {
  const { rooms } = directory();
  const room = rooms.create({ playerId: 'a', releaseId: 'release-1', nickname: 'Alpha', visibility: 'public' });
  rooms.join({ playerId: 'b', releaseId: 'release-1', nickname: 'Bravo', roomId: room.id });
  assert.throws(
    () => rooms.startCountdown('a'),
    (error: unknown) => error instanceof RoomError && error.code === 'notReady',
  );
  ready(rooms, 'a', 'volt');
  ready(rooms, 'b', 'kaze');
  assert.equal(rooms.startCountdown('a').phase, 'countdown');
  assert.equal(rooms.setPlayer('b', { ready: false }).phase, 'lobby');
});

test('untrusted room settings and visibility are normalized', () => {
  const { rooms } = directory();
  const room = rooms.create({
    playerId: 'a',
    releaseId: 'release-1',
    nickname: 'Alpha',
    visibility: 'surprise' as 'public',
  });
  assert.equal(room.visibility, 'public');
  const updated = rooms.setSettings('a', { stageId: '../ghost ship!' });
  assert.equal(updated.settings.stageId, 'ghostship');
});
