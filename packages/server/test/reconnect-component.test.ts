import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { createGame, legalActions, viewFor } from '@atlas/engine';
import { Rooms, type Member, type Snapshot } from '../src/rooms.ts';
import { PROTOCOL_VERSION as v, type ServerMessage } from '../src/protocol.ts';
import { loadComponent } from '../../app/test/componentBoundary.ts';
import { saveSnapshot, discardSnapshot, type Sql } from '../src/db.ts';

const game = createGame({ players: 2, countriesToWin: 3 }, 1);
const snapshot: Snapshot = { code: 'BCDFG', countriesToWin: 3, players: [{ account: 'a', name: 'Ada' }, { account: 'b', name: 'Bo' }], startedAt: new Date(0), stateVersion: 9, game };
function prepared(save: (s: Snapshot) => void | Promise<void> = () => { throw Error('no write'); }) {
  const rooms = new Rooms(() => { throw Error('no new game'); }, () => { throw Error('no bots'); }, { save, finish() { throw Error('no finish'); }, discard() { throw Error('no discard'); } }, [snapshot]);
  const member = (account: string) => {
    const messages: ServerMessage[] = []; let closed = false;
    const member: Member = { account, name: 'changed', send: m => { messages.push(m); }, close() { closed = true; } };
    return { member, messages, closed: () => closed };
  };
  return { rooms, member };
}
test('prepared current snapshot resumes original seat/private legal view; replacement rejects old actions and late close', () => {
  const { rooms, member } = prepared(); const old = member('a'); rooms.resume(old.member);
  const newer = member('a'); rooms.resume(newer.member);
  assert.equal(old.closed(), true); assert.deepEqual(old.messages.at(-1), { type: 'replaced' });
  assert.throws(() => rooms.intent(old.member, 9, legalActions(game, 0)[0]), /Not in a room/);
  rooms.leave(old.member);
  assert.equal(newer.member.name, 'Ada');
  const expected = { type: 'state', stateVersion: 9, view: viewFor(game, 0), legalActions: legalActions(game, 0) };
  assert.partialDeepStrictEqual(newer.messages.at(-1), expected);
  rooms.resync(newer.member); assert.partialDeepStrictEqual(newer.messages.at(-1), expected);
  const room = newer.messages.at(-2); assert.equal(room?.type, 'room');
  if (room?.type === 'room') { assert.equal(room.you, 0); assert.deepEqual(room.players.map(p => p.status), ['connected', 'disconnected']); }
  const bo = member('b'); rooms.resume(bo.member);
  assert.partialDeepStrictEqual(bo.messages.at(-1), { ...expected, view: viewFor(game, 1), legalActions: legalActions(game, 1) });
});

class Socket extends EventEmitter {
  OPEN = 1; readyState = 1; sent: any[] = []; failSend = false; failClose = false;
  send(text: string) { if (this.failSend) throw Error('private token'); this.sent.push(JSON.parse(text)); }
  close() { this.readyState = 3; this.emit('close'); if (this.failClose) throw Error('private token'); }
}
const flush = () => new Promise(setImmediate);
function handler() {
  return loadComponent(new URL('../src/server.ts', import.meta.url).pathname, {
    './db.ts': { async findAccount() { return { id: 'a', name: 'Ada' }; }, async renameAccount() {}, async createAccount() { throw Error('no guest'); } },
  }).serve;
}
test('actual serve hello uses token and current Rooms snapshot; malformed/version packets refuse without auth', async () => {
  const { rooms } = prepared(); const socket = new Socket(); const serve = handler();
  serve(socket, {}, rooms, () => {});
  for (const data of ['{', 'null', JSON.stringify({ v: v - 1, type: 'hello' })]) { socket.emit('message', data); await flush(); }
  assert.deepEqual(socket.sent.map(m => m.code), ['bad_message', 'bad_message', 'unsupported_version']);
  socket.emit('message', JSON.stringify({ v, type: 'hello', token: 'saved' })); await flush();
  assert.equal(socket.sent.at(-3).resumed, true); assert.equal(socket.sent.at(-1).view.viewer, 0);
  socket.emit('message', JSON.stringify({ v, type: 'resync' })); await flush();
  assert.equal(socket.sent.at(-1).stateVersion, 9); socket.close(); await flush();
});
test('serve contains send/close failures without rejected queues or private diagnostics', async (t) => {
  const warnings: any[] = []; t.mock.method(console, 'warn', (...args: unknown[]) => warnings.push(args));
  const { rooms } = prepared(); const socket = new Socket(); const serve = handler();
  serve(socket, {}, rooms, () => {}); socket.failSend = true; socket.failClose = true;
  socket.emit('message', JSON.stringify({ v, type: 'ping' })); await flush(); await flush();
  assert.equal(socket.readyState, 3); assert.equal(warnings.length, 1);
  assert.ok(!JSON.stringify(warnings).includes('private'));
});

test('explicit leave acknowledges only a durable mid-turn release; a refused write can be retried', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const writes: Snapshot[] = [];
  let stored!: () => void;
  const { rooms } = prepared(s => {
    writes.push(s);
    if (writes.length === 1) throw Error('store unavailable');
    return new Promise<void>(resolve => { stored = resolve; });
  });
  const socket = new Socket(); const serve = handler();
  serve(socket, {}, rooms, () => {});
  const send = (type: string) => socket.emit('message', JSON.stringify({ v, type, token: 'saved' }));
  send('hello'); await flush();
  send('leaveRoom'); await flush();
  assert.equal(socket.sent.at(-1).code, 'leave_failed');
  assert.equal(rooms.playing('a'), true);
  send('leaveRoom'); await flush();
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[1]!.players[0], { account: null, name: 'Ada' });
  assert.equal(writes[1]!.stateVersion, 9);
  assert.ok(!socket.sent.some(m => m.type === 'left'));
  stored(); await flush();
  assert.equal(socket.sent.at(-1).type, 'left');
  assert.equal(rooms.playing('a'), false);
  const restored = new Rooms(() => game, () => { throw Error('no bots in empty room'); }, { save() {}, finish() {}, discard() {} }, [writes[1]!]);
  assert.equal(restored.playing('a'), false);
  socket.close(); await flush();
  const returning = new Socket(); serve(returning, {}, rooms, () => {});
  returning.emit('message', JSON.stringify({ v, type: 'hello', token: 'saved' })); await flush();
  assert.deepEqual(returning.sent.map(m => [m.type, m.resumed]), [['welcome', false]]);
});

test('a reconnect sees the settled leave outcome, never an acknowledgement addressed to the old socket', async (t) => {
  const serve = handler();
  const send = (socket: Socket, type: string) => socket.emit('message', JSON.stringify({ v, type, token: 'saved' }));
  for (const commits of [true, false]) {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const { rooms, member } = prepared(() => promise);
    t.after(() => rooms.stop());
    const old = new Socket();
    serve(old, {}, rooms, () => {});
    send(old, 'hello'); await flush();
    send(old, 'leaveRoom'); await flush();
    const direct = member('a');
    rooms.resume(direct.member);
    assert.deepEqual(direct.messages, []);
    old.close();
    const abandonedReconnect = new Socket();
    const reconnect = new Socket();
    for (const socket of [abandonedReconnect, reconnect]) {
      serve(socket, {}, rooms, () => {});
      send(socket, 'hello');
    }
    await flush();
    assert.deepEqual(abandonedReconnect.sent, []);
    assert.equal(reconnect.sent.length, 0);
    abandonedReconnect.close();
    if (commits) resolve(); else reject(Error('write refused'));
    await flush();
    assert.deepEqual(abandonedReconnect.sent, []);
    assert.deepEqual(reconnect.sent.map(m => m.type), commits ? ['welcome'] : ['welcome', 'room', 'state']);
    assert.equal(reconnect.sent[0].resumed, !commits);
    assert.equal(rooms.playing('a'), !commits);
    assert.ok(!old.sent.some(m => m.type === 'left'), 'the acknowledgement was lost on the closed connection');
    if (!commits) {
      assert.equal(reconnect.sent.at(-1).view.viewer, 0);
      assert.equal(reconnect.sent.at(-1).stateVersion, 9);
    }
  }
});

test('snapshot SQL replaces persisted seat owners and deletes only the abandoned room', async () => {
  const queries: { text: string; values: unknown[] }[] = [];
  const sql = Object.assign((parts: TemplateStringsArray, ...values: unknown[]) => {
    queries.push({ text: parts.join('?'), values });
  }, { json: (value: unknown) => value }) as unknown as Sql;
  const departed = { ...snapshot, players: [{ account: null, name: 'Ada' }, snapshot.players[1]!] };
  await saveSnapshot(sql, departed);
  assert.match(queries[0]!.text.split('on conflict')[1]!, /players\s*=\s*excluded\.players/);
  assert.deepEqual(queries[0]!.values[2], departed.players);
  await discardSnapshot(sql, 'BCDFG');
  assert.deepEqual(queries[1], { text: 'delete from room_snapshots where code = ?', values: ['BCDFG'] });
});
