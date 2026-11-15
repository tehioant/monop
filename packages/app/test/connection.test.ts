import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { createGame, legalActions, viewFor } from '@atlas/engine';
import { HEARTBEAT_MS, type ServerMessage } from '@atlas/server/protocol';
import { connection, type Socket } from '../src/online/connection.ts';
import { offline, type Game, type Room, type Session } from '../src/online/session.ts';

/** A socket that does what the test says and records what the app sends. */
class FakeSocket implements Socket {
  readyState = 0;
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;

  send(text: string): void {
    this.sent.push(JSON.parse(text));
  }
  /** Closed by the app. */
  close(): void {
    this.readyState = 3;
  }
  opens(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  receives(...messages: ServerMessage[]): void {
    for (const message of messages) this.onmessage?.({ data: JSON.stringify({ v: 1, ...message }) });
  }
  /** Closed by the network or the server; also how a socket that could not be opened ends. */
  drops(): void {
    this.readyState = 3;
    this.onclose?.();
  }
}

// Message fixtures, as the server sends them.
const welcome: ServerMessage = { type: 'welcome', token: 'issued', name: 'Bo', resumed: false };
const players = [{ name: 'Ada', bot: false, status: 'connected' as const }, { name: 'Bo', bot: false, status: 'connected' as const }];
const room: Room = { type: 'room', code: 'BCDFG', countriesToWin: 3, players, you: 1 };
const game = createGame({ players: 2, countriesToWin: 3 }, 1);
const state: Game = { type: 'state', stateVersion: 3, view: viewFor(game, 1), legalActions: legalActions(game, 1) };
const sends = (type: string, fields = {}) => ({ v: 1, type, ...fields });

/** A connection on fake sockets and a fake clock, with Bo seated in a game through the first socket. */
function playing(t: TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const sockets: FakeSocket[] = [];
  const online = { session: { ...offline('Bo', 'issued'), request: { type: 'joinRoom', code: 'bcdfg' } } as Session };
  const server = connection(
    () => sockets[sockets.push(new FakeSocket()) - 1]!,
    () => online.session,
    (session) => (online.session = session),
  );
  server.open();
  sockets[0]!.opens();
  sockets[0]!.receives(welcome, room, state);
  assert.deepEqual(sockets[0]!.sent, [sends('hello', { token: 'issued', name: 'Bo' }), sends('joinRoom', { code: 'bcdfg' })]);
  return { sockets, online, server, tick: (ms: number) => t.mock.timers.tick(ms) };
}

test('a lost connection is opened again after a growing wait, and the token brings the player back to the seat', (t) => {
  const { sockets, online, server, tick } = playing(t);

  sockets[0]!.drops();
  assert.deepEqual([online.session.lost, online.session.game?.stateVersion], [0, 3]);
  tick(499);
  assert.equal(sockets.length, 1);
  tick(1);
  assert.equal(sockets.length, 2);

  // The server is still away. Nothing is sent meanwhile, whatever the player taps.
  server.send({ type: 'resync' });
  sockets[1]!.drops();
  assert.equal(online.session.lost, 1);
  tick(999);
  assert.equal(sockets.length, 2);
  tick(1);
  sockets[2]!.opens();
  assert.deepEqual(sockets[2]!.sent, [sends('hello', { token: 'issued', name: 'Bo' })]);

  sockets[2]!.receives({ ...welcome, resumed: true }, room, { ...state, stateVersion: 2 });
  assert.deepEqual([online.session.lost, online.session.game?.stateVersion], [null, 2]);
  assert.deepEqual([sockets[1]!.sent, sockets[2]!.sent.length, sockets.length], [[], 1, 3]);
});

test('a silent connection is pinged, then taken for lost and opened again; a late close of it changes nothing', (t) => {
  const { sockets, online, tick } = playing(t);
  const pings = () => sockets[0]!.sent.filter((message) => (message as { type: string }).type === 'ping').length;

  tick(HEARTBEAT_MS);
  assert.equal(pings(), 1);
  sockets[0]!.receives({ type: 'pong' });
  tick(2 * HEARTBEAT_MS);
  assert.deepEqual([pings(), online.session.lost, sockets[0]!.readyState], [3, null, 1]);

  tick(HEARTBEAT_MS);
  assert.deepEqual([pings(), online.session.lost, sockets[0]!.readyState], [3, 0, 3]);
  sockets[0]!.drops();
  assert.equal(online.session.lost, 0);

  // A connection that never opens is given up the same way.
  tick(500);
  tick(3 * HEARTBEAT_MS);
  assert.deepEqual([sockets.length, sockets[1]!.sent, sockets[1]!.readyState, online.session.lost], [2, [], 3, 1]);
});

test('the connection is closed for good when the session is out of its room, or when the player leaves', (t) => {
  const { sockets, online, server, tick } = playing(t);

  sockets[0]!.receives({ type: 'error', code: 'unsupported_version', message: '' });
  assert.deepEqual(online.session, { ...offline('Bo', 'issued'), error: 'unsupported_version' });
  assert.equal(sockets[0]!.readyState, 3);
  sockets[0]!.drops();
  assert.equal(online.session.error, 'unsupported_version');

  // Leaving while waiting to connect again: no attempt is made.
  online.session = { ...online.session, room, game: state };
  server.open();
  sockets[1]!.drops();
  assert.equal(online.session.lost, 0);
  server.close();
  tick(60_000);
  assert.equal(sockets.length, 2);
});
