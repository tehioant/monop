import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { createGame, legalActions, viewFor } from '@atlas/engine';
import { PROTOCOL_VERSION, HEARTBEAT_MS, type ServerMessage } from '@atlas/server/protocol';
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
    for (const message of messages) this.onmessage?.({ data: JSON.stringify({ v: PROTOCOL_VERSION, ...message }) });
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
const sends = (type: string, fields = {}) => ({ v: PROTOCOL_VERSION, type, ...fields });

/** A connection on fake sockets and a fake clock, with Bo seated in a game through the first socket. */
function preparedSession(t: TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const sockets: FakeSocket[] = [];
  const online = { session: { ...offline('Bo', 'issued'), room, game: state, synced: true } as Session };
  const server = connection(
    () => sockets[sockets.push(new FakeSocket()) - 1]!,
    () => online.session,
    (session) => (online.session = session),
  );
  server.open();
  sockets[0]!.opens();
  return { sockets, online, server, tick: (ms: number) => t.mock.timers.tick(ms) };
}

test('a lost connection is opened again after a growing wait, and the token brings the player back to the seat', (t) => {
  const { sockets, online, server, tick } = preparedSession(t);

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
  const { sockets, online, tick } = preparedSession(t);
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
  const { sockets, online, server, tick } = preparedSession(t);

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
for (const fault of ['constructor', 'send', 'close', 'malformed']) {
  test(`external ${fault} failure is contained with bounded sanitized diagnostics and retry`, (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const warnings: unknown[][] = []; t.mock.method(console, 'warn', (...args: unknown[]) => warnings.push(args));
    let session: Session = { ...offline('Bo', 'issued'), room, game: state, synced: true };
    const sockets: FakeSocket[] = [];
    const server = connection(() => {
      if (fault === 'constructor') throw Error('private token');
      const socket = new FakeSocket(); sockets.push(socket);
      if (fault === 'send') socket.send = () => { throw Error('private token'); };
      if (fault === 'close') socket.close = () => { throw Error('private token'); };
      return socket;
    }, () => session, next => { session = next; });
    assert.doesNotThrow(() => server.open());
    if (fault === 'constructor') assert.equal(session.lost, 0);
    else {
      assert.doesNotThrow(() => sockets[0]!.opens());
      if (fault === 'malformed') assert.doesNotThrow(() => sockets[0]!.onmessage?.({ data: '{private token' }));
      if (fault === 'close') assert.doesNotThrow(() => sockets[0]!.drops());
      assert.equal(session.lost, 0);
    }
    t.mock.timers.tick(500); t.mock.timers.tick(1000);
    server.close(); t.mock.timers.tick(60_000);
    assert.ok(warnings.length > 0 && warnings.length <= 2);
    assert.ok(!JSON.stringify(warnings).includes('private'));
  });
}

test('lost and unsynced sessions cannot send stale intents, including before replacement full state', (t) => {
  const { sockets, online, server, tick } = preparedSession(t);
  online.session = { ...online.session, synced: false };
  server.send({ type: 'intent', stateVersion: 3, action: { type: 'draw' } });
  assert.equal(sockets[0]!.sent.length, 1);
  sockets[0]!.drops(); tick(500); sockets[1]!.opens();
  const old = sockets[0]!;
  old.onopen?.(); old.receives({ type: 'replaced' }); old.drops();
  assert.equal(online.session.lost, 0);
  sockets[1]!.receives({ ...welcome, resumed: true }, room);
  assert.equal(online.session.synced, false);
  assert.equal(online.session.lost, 0);
  server.send({ type: 'intent', stateVersion: 3, action: { type: 'draw' } });
  assert.equal(sockets[1]!.sent.length, 1);
  sockets[1]!.receives({ ...state, stateVersion: 1 });
  server.send({ type: 'intent', stateVersion: 1, action: { type: 'draw' } });
  assert.equal(sockets[1]!.sent.length, 2);
  assert.equal(online.session.lost, null);
  server.close();
});

for (const packet of ['incomplete view', 'unknown phase', 'unknown action', 'malformed room']) {
  test(`nested wire ${packet} is refused by the connection without replacing last good data`, (t) => {
    const { sockets, online, server, tick } = preparedSession(t);
    t.mock.method(console, 'warn', () => {});
    const bad = structuredClone({ v: PROTOCOL_VERSION, ...state }) as any;
    if (packet === 'incomplete view') bad.view = { players: [], hand: [], log: [], phase: { kind: 'not-a-phase' } };
    if (packet === 'unknown phase') bad.view.phase = { kind: 'not-a-phase', player: 0 };
    if (packet === 'unknown action') bad.legalActions = [{ type: 'not-an-action' }];
    const message = packet === 'malformed room' ? { v: PROTOCOL_VERSION, ...room, countriesToWin: null } : bad;
    assert.doesNotThrow(() => sockets[0]!.onmessage?.({ data: JSON.stringify(message) }));
    assert.equal(online.session.game, state);
    assert.equal(online.session.room, room);
    assert.equal(online.session.synced, false);
    assert.equal(online.session.lost, 0);
    assert.equal(sockets[0]!.readyState, 3);
    tick(499); assert.equal(sockets.length, 1);
    tick(1); assert.equal(sockets.length, 2);
    server.close();
  });
}
