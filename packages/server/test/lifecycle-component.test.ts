import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBot, type Bot } from '@atlas/bots';
import { applyAction, createGame, legalActions, viewFor, type GameState } from '@atlas/engine';
import { Rooms, type Member, type Snapshot } from '../src/rooms.ts';
import type { ServerMessage } from '../src/protocol.ts';
import { closeRoomResources, roomWrites } from '../src/server.ts';
import { loadSnapshots, type Sql } from '../src/db.ts';

const game = createGame({ players: 2, countriesToWin: 3 }, 1);
const snapshot: Snapshot = { code: 'BCDFG', countriesToWin: 3, players: [{ account: 'a', name: 'Ada' }, { account: 'b', name: 'Bo' }], startedAt: new Date(0), stateVersion: 9, game };

function prepared(state: GameState = game, bot?: Bot, players = snapshot.players) {
  const moves: number[] = [];
  const writes: Snapshot[] = [];
  const discarded: string[] = [];
  const rooms = new Rooms(() => { throw Error('no new game'); }, (view, legal) => {
    moves.push(view.viewer);
    if (bot) return bot(view, legal);
    return legal.find(a => a.type === 'endTurn') ?? legal[0]!;
  }, { save(s) { writes.push(s); }, finish() {}, discard(code) { discarded.push(code); } }, [{ ...snapshot, players, game: state }], { turnMs: 100, responseMs: 20, graceMs: 30, abandonedMs: 300 });
  const player = (account: string) => {
    const inbox: ServerMessage[] = [];
    const member: Member = { account, name: account, send: m => inbox.push(m), close() {} };
    const state = () => inbox.findLast(m => m.type === 'state')!;
    const room = () => inbox.findLast(m => m.type === 'room')!;
    rooms.resume(member);
    return { member, state, room, inbox };
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

test('a late disconnect cannot defer an advertised turn or response while another human stays', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const response: GameState = { ...game, phase: { kind: 'veto', player: 1, target: 1, vetoes: 0, effect: { amount: 1 }, queue: [] } };
  for (const [state, actor, observer, duration, before] of [[game, 'a', 'b', 100, 90], [response, 'b', 'a', 20, 10]] as const) {
    const { rooms, moves, player } = prepared(state);
    const away = player(actor);
    const present = player(observer);
    const seat = state.phase.kind === 'over' ? -1 : state.phase.player;
    assert.equal(present.state().deadline!.at, Date.now() + duration);
    t.mock.timers.tick(before);
    rooms.leave(away.member);
    t.mock.timers.tick(9);
    assert.deepEqual(moves, []);
    t.mock.timers.tick(1);
    assert.deepEqual(moves, [seat]);
    assert.equal(present.state().stateVersion, 10);
    assert.equal(present.room().players[seat]!.status, 'disconnected');
    assert.equal(rooms.playing(actor), true);
    rooms.stop();
  }
});

test('both expiry and grace callbacks contain bot faults and apply a progressing legal fallback', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const warnings = t.mock.method(console, 'warn', () => {});
  for (const grace of [false, true]) {
    const { rooms, moves, player } = prepared(game, () => { throw Error('private decision'); });
    const ada = player('a');
    const bo = player('b');
    if (grace) rooms.leave(ada.member);
    t.mock.timers.tick(grace ? 30 : 100);
    assert.deepEqual(moves, [0]);
    assert.equal(bo.state().stateVersion, 10);
    assert.equal(bo.state().view.turn.player, 1);
    rooms.stop();
  }
  assert.equal(warnings.mock.callCount(), 2);
  assert.doesNotMatch(JSON.stringify(warnings.mock.calls.map(call => call.arguments)), /private/);
});

test('an unplayable timer state pauses only its room without retrying or offering actions', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const warnings = t.mock.method(console, 'warn', () => {});
  const invalid: GameState = { ...game, phase: { kind: 'pay', player: 1, receiver: 0, owed: 1, amount: 1, queue: [] } };
  const { rooms, moves, player } = prepared(invalid);
  const bo = player('b');
  assert.deepEqual(bo.state().deadline, { kind: 'response', at: 1020 });
  t.mock.timers.tick(20);
  assert.equal(bo.state().deadline, undefined);
  assert.deepEqual(bo.state().legalActions, []);
  assert.equal(bo.state().stateVersion, 9);
  assert.throws(() => rooms.intent(bo.member, 9, { type: 'pay', card: 'coin-1-1' }), /game is paused/);
  t.mock.timers.tick(300);
  assert.equal(warnings.mock.callCount(), 1);
  assert.deepEqual(moves, []);
  rooms.stop();
});

test('normal bots can complete a country by reassigning a wild; expiry and cyclic bots must progress', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const state = structuredClone(game);
  state.players[0]!.hand = [];
  state.players[0]!.table = [
    { country: 'italy', cities: ['wild-egypt-italy'], upgrades: [] },
    { country: 'egypt', cities: ['cairo'], upgrades: [] },
  ];
  const botSeats = [{ account: null, name: 'Bot 1' }, snapshot.players[1]!];
  const normal = prepared(state, createBot('hard', 1), botSeats);
  const bo = normal.player('b');
  assert.deepEqual(bo.state().view.log.find(entry => entry.type === 'reassign'),
    { type: 'reassign', player: 0, card: 'wild-egypt-italy', country: 'egypt' });
  assert.equal(bo.state().view.turn.player, 1);
  normal.rooms.stop();

  const triesFree = ((_view, legal) => legal.find(action => action.type === 'reassign') ?? legal.at(-1)!) satisfies Bot;
  const timed = prepared(state, triesFree);
  timed.player('a');
  const observer = timed.player('b');
  t.mock.timers.tick(100);
  assert.deepEqual(timed.moves, [0]);
  assert.ok(!observer.state().view.log.some(entry => entry.type === 'reassign'));
  assert.equal(observer.state().view.turn.player, 1);
  timed.rooms.stop();

  const cyclic = prepared(state, triesFree, botSeats);
  const human = cyclic.player('b');
  assert.deepEqual(cyclic.moves, [0, 0]);
  assert.equal(human.state().view.log.filter(entry => entry.type === 'reassign').length, 1);
  assert.equal(human.state().view.turn.player, 1);
  cyclic.rooms.stop();
});

test('a restored bot turn pauses without humans and replays the exact payment state on resume', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const state = structuredClone(game);
  state.players[0]!.hand = ['levy-1'];
  state.players[1]!.hand = [];
  state.players[1]!.bank = ['coin-5-1'];
  const levy = { type: 'play', card: 'levy-1' } as const;
  const payment = applyAction(state, 0, levy);
  assert.equal(payment.phase.kind, 'pay');
  const { player, moves, rooms } = prepared(state, () => levy, [{ account: null, name: 'Bot 1' }, snapshot.players[1]!]);
  t.mock.timers.tick(40);
  assert.deepEqual(moves, []);
  const bo = player('b');
  const states = bo.inbox.filter(message => message.type === 'state');
  assert.deepEqual(states.map(message => message.stateVersion), [9, 10]);
  const { deadline, serverTime, ...replayed } = states[1]!;
  assert.deepEqual(replayed, { type: 'state', stateVersion: 10, view: viewFor(payment, 1), legalActions: legalActions(payment, 1) });
  assert.deepEqual(deadline, { kind: 'response', at: 1060 });
  assert.equal(serverTime, 1040);
  assert.deepEqual(moves, [0]);
  rooms.stop();
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
  const unrelated = { ...snapshot, code: 'HJKLM', players: [{ account: 'c', name: 'Cy' }, { account: 'd', name: 'Dee' }] };
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
    if (calls.length === 2 || code === unrelated.code) throw Error('private DB details');
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
  const restored = restore([...rows.values()]);
  assert.equal(restored.playing('a'), false);
  assert.equal(restored.playing('c'), true);
  t.mock.timers.tick(300);
  await new Promise(setImmediate);
  assert.equal(calls.at(-1), `delete ${unrelated.code}`);
  assert.equal(warnings.mock.callCount(), 2);
  const count = calls.length;
  restored.stop();
  t.mock.timers.tick(2_000);
  assert.equal(calls.length, count, 'shutdown cancelled the scheduled retry');
});

test('graceful shutdown settles expired deletions without discarding an unexpired snapshot', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  t.mock.method(console, 'warn', () => {});
  const unrelated = { ...snapshot, code: 'HJKLM', players: [{ account: 'c', name: 'Cy' }, { account: 'd', name: 'Dee' }] };
  const timing = { turnMs: 100, responseMs: 20, graceMs: 30, abandonedMs: 300 };
  for (const outcome of ['committed', 'pending-success', 'pending-refusal', 'retry-success', 'retry-refusal'] as const) {
    const rows = new Map([[snapshot.code, snapshot], [unrelated.code, unrelated]]);
    const first = Promise.withResolvers<void>();
    const final = Promise.withResolvers<void>();
    const deletes: string[] = [];
    const sql = (async (parts: TemplateStringsArray, code: string) => {
      if (parts[0]!.includes('select code')) return [...rows.values()];
      assert.match(parts[0]!, /delete from room_snapshots where code/);
      deletes.push(code);
      await (deletes.length === 1 ? first.promise : final.promise);
      rows.delete(code);
    }) as unknown as Sql;
    const store = roomWrites(sql);
    const restore = (snapshots: Snapshot[]) => new Rooms(() => game, () => { throw Error('unexpected bot'); }, store, snapshots, timing);
    const rooms = restore([snapshot, unrelated]);
    const member: Member = { account: 'c', name: 'Cy', send() {}, close() {} };
    rooms.resume(member); // This snapshot's room is still occupied when the other expires.
    t.mock.timers.tick(300);
    await new Promise(setImmediate);
    assert.deepEqual([...deletes], [snapshot.code]);
    if (outcome === 'committed') first.resolve();
    if (outcome.startsWith('retry')) first.reject(Error('private database details'));
    await new Promise(setImmediate);

    const closed: string[] = [];
    const closing = closeRoomResources(rooms, store, async () => { closed.push('connections'); }, async () => { closed.push('store'); });
    const refused = outcome === 'retry-refusal';
    const settled = refused ? assert.rejects(closing, /^Error: Could not delete expired rooms during shutdown\.$/) : closing;
    if (outcome.startsWith('pending')) {
      await new Promise(setImmediate);
      assert.deepEqual([...deletes], [snapshot.code], 'shutdown must not duplicate the in-flight delete');
      if (outcome === 'pending-success') first.resolve();
      else first.reject(Error('private database details'));
    }
    await new Promise(setImmediate);
    const expected = outcome === 'committed' || outcome === 'pending-success' ? [snapshot.code] : [snapshot.code, snapshot.code];
    assert.deepEqual([...deletes], expected, outcome);
    if (expected.length === 2) assert.deepEqual([...closed], ['connections'], 'the store stays open until the final delete settles');
    if (refused) final.reject(Error('private database details'));
    else final.resolve();
    await settled;
    assert.deepEqual([...closed], ['connections', 'store']);
    t.mock.timers.tick(2000);
    assert.deepEqual([...deletes], expected, 'no retries after shutdown');
    const restored = restore(await loadSnapshots(sql));
    assert.equal(restored.playing('a'), refused);
    assert.equal(restored.playing('c'), true);
    await restored.stop();
  }
});
