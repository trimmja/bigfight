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

function startTwoPlayerMatch() {
  const { rooms, tick } = directory();
  const room = rooms.create({ playerId: 'a', releaseId: 'release-1', nickname: 'Alpha', visibility: 'public' });
  rooms.join({ playerId: 'b', releaseId: 'release-1', nickname: 'Bravo', roomId: room.id });
  ready(rooms, 'a', 'volt');
  ready(rooms, 'b', 'kaze');
  rooms.startCountdown('a');
  tick(3_000);
  const launch = rooms.beginMatch(room.id);
  return { rooms, tick, room, launch };
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
  assert.deepEqual(migrated?.players.map((player) => player.slot), [0, 1]);
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

test('an active match pauses for a disconnected player and resumes in place', () => {
  const { rooms } = startTwoPlayerMatch();
  const paused = rooms.setConnected('b', false);
  assert.equal(paused.phase, 'paused');
  assert.equal(paused.pauseStartedAt, 4_000);
  assert.equal(paused.pausedBy, null);
  const resumed = rooms.setConnected('b', true);
  assert.equal(resumed.phase, 'match');
  assert.equal(resumed.pauseStartedAt, null);
  assert.deepEqual(resumed.players.map((player) => player.connected), [true, true]);
});

test('a player can pause an active match but cannot pause from another phase', () => {
  const { rooms, tick } = startTwoPlayerMatch();
  tick(250);
  const paused = rooms.pauseMatch('b');
  assert.equal(paused.phase, 'paused');
  assert.equal(paused.pauseStartedAt, 4_250);
  assert.equal(paused.pausedBy, 'b');
  assert.throws(
    () => rooms.pauseMatch('a'),
    (error: unknown) => error instanceof RoomError && error.code === 'invalidPhase',
  );

  const lobby = directory().rooms;
  lobby.create({ playerId: 'lobby-player', releaseId: 'release-1', nickname: 'Lobby', visibility: 'public' });
  assert.throws(
    () => lobby.pauseMatch('lobby-player'),
    (error: unknown) => error instanceof RoomError && error.code === 'invalidPhase',
  );
});

test('only the voluntary pauser can resume and receives the pause timestamps', () => {
  const { rooms, tick } = startTwoPlayerMatch();
  rooms.pauseMatch('a');
  tick(600);
  assert.throws(
    () => rooms.resumeMatch('b'),
    (error: unknown) => error instanceof RoomError && error.code === 'invalidPhase',
  );
  const { room, resumed } = rooms.resumeMatch('a');
  assert.equal(room.phase, 'match');
  assert.equal(room.pauseStartedAt, null);
  assert.equal(room.pausedBy, null);
  assert.deepEqual(resumed, { pausedAt: 4_000, resumedAt: 4_600 });
});

test('a reconnect does not dismiss a voluntary menu pause', () => {
  const { rooms } = startTwoPlayerMatch();
  rooms.pauseMatch('a');
  rooms.setConnected('b', false);
  const reconnected = rooms.setConnected('b', true);
  assert.equal(reconnected.phase, 'paused');
  assert.equal(reconnected.pauseStartedAt, 4_000);
  assert.equal(reconnected.pausedBy, 'a');
});

test('resuming a menu while a player is disconnected degrades to a connection pause', () => {
  const { rooms, tick } = startTwoPlayerMatch();
  rooms.pauseMatch('a');
  rooms.setConnected('b', false);
  tick(750);
  const degraded = rooms.resumeMatch('a');
  assert.equal(degraded.room.phase, 'paused');
  assert.equal(degraded.room.pauseStartedAt, 4_000);
  assert.equal(degraded.room.pausedBy, null);
  assert.equal(degraded.resumed, null);

  tick(250);
  const reconnected = rooms.setConnected('b', true);
  assert.equal(reconnected.phase, 'match');
  assert.equal(reconnected.pauseStartedAt, null);
});

test('forfeiting places that player last with zero KOs and ends the match', () => {
  const { rooms } = startTwoPlayerMatch();
  rooms.pauseMatch('b');
  const results = rooms.forfeitMatch('b');
  assert.equal(results.phase, 'results');
  assert.deepEqual(results.result, { placements: [0, 1], kosBySlot: [0, 0] });
  assert.equal(results.pauseStartedAt, null);
  assert.equal(results.pausedBy, null);
  assert.deepEqual(results.players.map((player) => player.ready), [false, false]);
});

test('removing a player mid-match awards results to the survivor before removal', () => {
  const { rooms } = startTwoPlayerMatch();
  const results = rooms.removePlayer('b');
  assert.equal(results?.phase, 'results');
  assert.deepEqual(results?.result, { placements: [0, 1], kosBySlot: [0, 0] });
  assert.deepEqual(results?.players.map((player) => player.playerId), ['a']);
  assert.equal(results?.players[0]?.ready, false);
});

test('removing a player from the lobby keeps the existing lobby behavior', () => {
  const { rooms } = directory();
  const room = rooms.create({ playerId: 'a', releaseId: 'release-1', nickname: 'Alpha', visibility: 'public' });
  rooms.join({ playerId: 'b', releaseId: 'release-1', nickname: 'Bravo', roomId: room.id });
  const lobby = rooms.removePlayer('b');
  assert.equal(lobby?.phase, 'lobby');
  assert.equal(lobby?.result, null);
  assert.deepEqual(lobby?.players.map((player) => player.playerId), ['a']);
});
