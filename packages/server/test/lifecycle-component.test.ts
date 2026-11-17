import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGame, legalActions, type GameState } from '@atlas/engine';
import { Rooms, type Member, type Snapshot } from '../src/rooms.ts';
import type { ServerMessage } from '../src/protocol.ts';
import { roomWrites } from '../src/server.ts';
import type { Sql } from '../src/db.ts';

const game = createGame({ players: 2, countriesToWin: 3 }, 1);
const snapshot: Snapshot = { code: 'BCDFG', countriesToWin: 3, players: [{ account: 'a', name: 'Ada' }, { account: 'b', name: 'Bo' }], startedAt: new Date(0), stateVersion: 9, game };

function prepared(state: GameState = game) {
  const moves: number[] = [];
  const writes: Snapshot[] = [];
  const discarded: string[] = [];
  const rooms = new Rooms(() => { throw Error('no new game'); }, (view, legal) => {
    moves.push(view.viewer);
    return legal.find(a => a.type === 'endTurn') ?? legal[0]!;
  }, { save(s) { writes.push(s); }, finish() {}, discard(code) { discarded.push(code); } }, [{ ...snapshot, game: state }], { turnMs: 100, responseMs: 20, graceMs: 30, abandonedMs: 300 });
  const player = (account: string) => {
    const inbox: ServerMessage[] = [];
    const member: Member = { account, name: account, send: m => inbox.push(m), close() {} };
    const state = () => inbox.findLast(m => m.type === 'state')!;
    const room = () => inbox.findLast(m => m.type === 'room')!;
    rooms.resume(member);
    return { member, state, room };
  };
  return { rooms, moves, writes, discarded, player };
}

test('turn deadline survives an ordinary play and resync, then the server plays a legal bot move', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const { rooms, moves, player } = prepared();
  const ada = player('a');
  player('b');
  assert.deepEqual(ada.state().deadline, { kind: 'turn', at: 1100 });
  t.mock.timers.tick(40);
  const bank = ada.state().legalActions.find(a => a.type === 'bank')!;
  assert.ok(bank);
  rooms.intent(ada.member, 9, bank);
  rooms.resync(ada.member);
  assert.deepEqual(ada.state().deadline, { kind: 'turn', at: 1100 });
  t.mock.timers.tick(59);
  assert.deepEqual(moves, []);
  // Wall time can reach expiry before the queued timer gets to run.
  t.mock.timers.setTime(1100);
  assert.throws(() => rooms.intent(ada.member, 10, { type: 'endTurn' }), /expired/);
  t.mock.timers.tick(1);
  assert.deepEqual(moves, [0]);
  assert.equal(ada.state().view.turn.player, 1);
});

test('a prepared response has its own shorter deadline, and answering returns to the original turn clock', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const response: GameState = { ...game, phase: { kind: 'veto', player: 1, target: 1, vetoes: 0, effect: { amount: 1 }, queue: [] } };
  const { moves, player } = prepared(response);
  const ada = player('a');
  player('b');
  assert.deepEqual(legalActions(response, 1).at(-1), { type: 'decline' });
  assert.deepEqual(ada.state().deadline, { kind: 'response', at: 1020 });
  t.mock.timers.tick(20);
  assert.deepEqual(moves, [1]);
  assert.deepEqual(ada.state().deadline, { kind: 'turn', at: 1100 });
});

test('disconnect waits for grace, covers the seat, and the same account reclaims its current private view', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const { rooms, moves, player } = prepared();
  const ada = player('a');
  const bo = player('b');
  rooms.leave(ada.member);
  t.mock.timers.tick(29);
  assert.equal(bo.room().players[0]!.status, 'disconnected');
  assert.deepEqual(moves, []);
  t.mock.timers.tick(1);
  assert.equal(bo.room().players[0]!.status, 'bot-replaced');
  assert.deepEqual(moves, [0]);
  const reclaimed = player('a');
  assert.equal(reclaimed.state().view.viewer, 0);
  assert.equal(reclaimed.state().stateVersion, bo.state().stateVersion);
  assert.equal(bo.room().players[0]!.status, 'connected');
  rooms.leave(ada.member);
  t.mock.timers.tick(30);
  assert.equal(bo.room().players[0]!.status, 'connected');
  rooms.leave(reclaimed.member);
  t.mock.timers.tick(29);
  player('a');
  t.mock.timers.tick(1);
  assert.equal(bo.room().players[0]!.status, 'connected');
});

test('restored empty rooms do not play bots, cancel expiry on resume, and delete the snapshot after abandonment', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const { rooms, moves, discarded, player } = prepared();
  t.mock.timers.tick(299);
  assert.deepEqual(moves, []);
  const ada = player('a');
  t.mock.timers.tick(1);
  assert.deepEqual(discarded, []);
  rooms.leave(ada.member);
  t.mock.timers.tick(299);
  assert.equal(rooms.playing('a'), true);
  t.mock.timers.tick(1);
  assert.deepEqual(discarded, ['BCDFG']);
  await Promise.resolve();
  assert.equal(rooms.playing('a'), false);
  assert.equal(rooms.playing('b'), false);
});

test('expired rooms refuse reclaim while ordered deletion is pending and until a failed delete is retried', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const warnings = t.mock.method(console, 'warn', () => {});
  const unrelated = { ...snapshot, code: 'HJKLM' };
  const rows = new Map([[snapshot.code, snapshot], [unrelated.code, unrelated]]);
  const calls: string[] = [];
  const { promise: saveGate, resolve: allowSave } = Promise.withResolvers<void>();
  const sql = Object.assign(async (parts: TemplateStringsArray, code: string) => {
    if (parts[0]!.includes('insert into room_snapshots')) {
      calls.push('save');
      await saveGate;
      return;
    }
    assert.match(parts[0]!, /delete from room_snapshots where code/);
    calls.push(`delete ${code}`);
    if (calls.length === 2) throw Error('private DB details');
    rows.delete(code);
  }, { json: (value: unknown) => value }) as unknown as Sql;
  const store = roomWrites(sql);
  const restore = (snapshots: Snapshot[]) => new Rooms(() => game, () => { throw Error('unexpected bot'); }, store, snapshots,
    { turnMs: 100, responseMs: 20, graceMs: 30, abandonedMs: 300 });
  const rooms = restore([snapshot]);
  t.after(() => rooms.stop());
  const save = store.save(snapshot);
  await Promise.resolve();
  t.mock.timers.tick(300);
  const messages: ServerMessage[] = [];
  const returning: Member = { account: 'a', name: 'Ada', send: m => messages.push(m), close() {} };
  rooms.resume(returning);
  assert.deepEqual(messages, []);
  assert.equal(rooms.playing('a'), false);
  assert.deepEqual(calls, ['save']);
  allowSave();
  await save;
  await new Promise(setImmediate);
  assert.deepEqual(calls, ['save', `delete ${snapshot.code}`]);
  assert.equal(rows.get(snapshot.code), snapshot);
  assert.equal(warnings.mock.callCount(), 1);
  assert.doesNotMatch(JSON.stringify(warnings.mock.calls[0]!.arguments), /private/);
  rooms.resume(returning);
  assert.deepEqual(messages, []);
  t.mock.timers.tick(999);
  assert.equal(calls.length, 2);
  t.mock.timers.tick(1);
  await new Promise(setImmediate);
  assert.deepEqual(calls, ['save', `delete ${snapshot.code}`, `delete ${snapshot.code}`]);
  assert.deepEqual([...rows.values()], [unrelated]);
  const restored = restore([...(rows.has(snapshot.code) ? [rows.get(snapshot.code)!] : [])]);
  t.after(() => restored.stop());
  assert.equal(restored.playing('a'), false);
});
