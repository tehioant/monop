import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { createGame, legalActions, viewFor } from '@atlas/engine';
import { Rooms, type Member, type Snapshot } from '../src/rooms.ts';
import { PROTOCOL_VERSION as v, type ServerMessage } from '../src/protocol.ts';
import { loadComponent } from '../../app/test/componentBoundary.ts';

const game = createGame({ players: 2, countriesToWin: 3 }, 1);
const snapshot: Snapshot = { code: 'BCDFG', countriesToWin: 3, players: [{ account: 'a', name: 'Ada' }, { account: 'b', name: 'Bo' }], startedAt: new Date(0), stateVersion: 9, game };
function prepared() {
  const rooms = new Rooms(() => { throw Error('no new game'); }, () => { throw Error('no bots'); }, { save() { throw Error('no write'); }, finish() { throw Error('no finish'); } }, [snapshot]);
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
  assert.deepEqual(newer.messages.at(-1), expected);
  rooms.resync(newer.member); assert.deepEqual(newer.messages.at(-1), expected);
  const room = newer.messages.at(-2); assert.equal(room?.type, 'room');
  if (room?.type === 'room') { assert.equal(room.you, 0); assert.deepEqual(room.players.map(p => p.status), ['connected', 'disconnected']); }
  const bo = member('b'); rooms.resume(bo.member);
  assert.deepEqual(bo.messages.at(-1), { ...expected, view: viewFor(game, 1), legalActions: legalActions(game, 1) });
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
