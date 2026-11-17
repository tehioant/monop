import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGame, legalActions, viewFor } from '@atlas/engine';
import { PROTOCOL_VERSION } from '@atlas/server/protocol';
import { offline, decode, receive } from '../src/online/session.ts';
import { hooks, loadComponent, native, nodes } from './componentBoundary.ts';
const state = createGame({ players: 2, countriesToWin: 3 }, 1);
const game = { type: 'state', stateVersion: 9, view: viewFor(state, 0), legalActions: legalActions(state, 0) };
const room = { type: 'room', code: 'BCDFG', countriesToWin: 3, you: 0, players: [{ name: 'Ada', bot: false, status: 'connected' }, { name: 'Bo', bot: false, status: 'disconnected' }] };

test('storage read/write errors do not crash store or suppress received state; stale actions refuse', (t) => {
  const warnings: unknown[][] = []; t.mock.method(console, 'warn', (...args: unknown[]) => warnings.push(args));
  let callback: any; const sends: unknown[] = [];
  const store = loadComponent(new URL('../src/online/store.ts', import.meta.url).pathname, {
    'expo-secure-store': { getItem() { throw Error('private token'); }, setItem() { throw Error('private token'); } },
    './connection.ts': { connection(_socket: any, _get: any, set: any) { callback = set; return { open() {}, close() {}, send(m: unknown) { sends.push(m); } }; } },
  }).useOnline;
  assert.doesNotThrow(() => store.getState().createRoom(3));
  callback({ ...offline('Ada', 'issued'), room, game, synced: false, lost: 0 });
  store.getState().play({ type: 'draw' }); assert.deepEqual(sends, []);
  callback({ ...store.getState().session, synced: true, lost: null });
  store.getState().play({ type: 'draw' }); assert.equal(sends.length, 1);
  store.getState().leaveRoom(); store.getState().leaveRoom(); store.getState().play({ type: 'draw' });
  assert.deepEqual(sends.slice(1), [{ type: 'leaveRoom' }]);
  assert.equal(store.getState().session.leaving, true);
  callback(receive(store.getState().session, { type: 'error', code: 'leave_failed', message: '' }).session);
  assert.equal(store.getState().session.room, room);
  store.getState().leaveRoom();
  assert.deepEqual(sends.slice(1), [{ type: 'leaveRoom' }, { type: 'leaveRoom' }]);
  assert.ok(warnings.length > 0 && warnings.length <= 1); assert.ok(!JSON.stringify(warnings).includes('private'));
});

test('online actual screen composes pacing, settings, reconnecting, all-seat presence and update prompt', () => {
  const runtime = hooks(); let session: any = { ...offline('Ada', 'issued'), room, game, synced: false, lost: 0 };
  const Online = loadComponent(new URL('../src/app/online.tsx', import.meta.url).pathname, {
    react: runtime.react, '../table/parts.tsx': { Button() {}, Panel() {}, shared: {} }, '../table/Choice.tsx': { Choice() {} }, 'react-native': native, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    'expo-router': { router: {} }, '../online/store.ts': { useOnline: () => ({ session, resume() {}, leave() {}, play() {} }) },
    '../table/usePaced.ts': { usePaced: (view: any, legal: any) => ({ view, legal, settled: true }) },
    '../table/Table.tsx': { Table() {} }, '../table/Results.tsx': { Results() {} },
  }).default;
  const playing: any = runtime.render(Online); const tree = runtime.render(() => playing.type(playing.props));
  assert.ok(nodes(tree).some(n => n.props?.label === 'Settings'));
  assert.deepEqual(nodes(tree).find(n => n.type?.name === 'Table').props.legal, []);
  const reconnect = nodes(tree).find(n => n.type?.name === 'Reconnecting'); assert.equal(reconnect.type().props.children, 'Reconnecting…');
  const presence = nodes(tree).find(n => n.type?.name === 'Presence');
  assert.ok(JSON.stringify(presence.type(presence.props)).includes('offline'));
  assert.ok(JSON.stringify(presence.type(presence.props)).includes('Ada'));
  session = { ...session, error: 'unsupported_version' };
  const update: any = runtime.render(Online); assert.ok(JSON.stringify(update.type()).includes('Update needed')); runtime.unmount();
});

test('incompatible predecessor protocol is refused, while cross-version update errors retain shape', () => {
  assert.ok(PROTOCOL_VERSION > 1, 'required resumed/status and resync are incompatible with v1 servers');
  assert.equal(decode(JSON.stringify({ v: 1, type: 'welcome', token: 'old', name: 'Ada' })).type, 'error');
  assert.equal(receive(offline('Ada', null), decode(JSON.stringify({ v: 1, type: 'error', code: 'unsupported_version', message: '' }))).session.error, 'unsupported_version');
});


test('repeated invalid-token refusal stops instead of an unbounded hello loop', () => {
  const guest = { ...offline('Ada', null), request: { type: 'joinRoom' as const, code: 'BCDFG' } };
  const refused = receive(guest, { type: 'error', code: 'invalid_token', message: '' });
  assert.deepEqual(refused.send, []); assert.equal(refused.session.error, 'invalid_token');
});

test('online screen shows the response clock and bot cover, and navigates only after leave acknowledgement', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 2000 });
  const runtime = hooks(); const clock = hooks(); let active = runtime.react;
  const react = { ...active, useState: (initial: unknown) => active.useState(initial), useEffect: (effect: () => unknown, deps: unknown[]) => active.useEffect(effect, deps) };
  const coveredRoom = { ...room, players: [room.players[0], { ...room.players[1], status: 'bot-replaced' }] };
  const live = decode(JSON.stringify({ ...game, v: PROTOCOL_VERSION, deadline: { kind: 'response', at: 6300 }, serverTime: 5000 }));
  let session = receive({ ...offline('Ada', 'issued'), room: coveredRoom } as any, live).session;
  let requests = 0; let homes = 0; let closes = 0;
  const store = { resume() {}, leave() { closes++; }, leaveRoom() { requests++; session = { ...session, leaving: true }; }, play() {} };
  const Online = loadComponent(new URL('../src/app/online.tsx', import.meta.url).pathname, {
    react, '../table/parts.tsx': { Button() {}, Panel() {}, shared: {} }, '../table/Choice.tsx': { Choice() {} }, 'react-native': native,
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' }, 'expo-router': { router: { dismissTo() { homes++; } } },
    '../online/store.ts': { useOnline: () => ({ session, ...store }) },
    '../table/usePaced.ts': { usePaced: (view: any, legal: any) => ({ view, legal, settled: true }) },
    '../table/Table.tsx': { Table() {} }, '../table/Results.tsx': { Results() {} },
  }).default;
  const playing: any = runtime.render(Online); runtime.flush();
  const tree = nodes(playing.type(playing.props));
  const countdown = tree.find(n => n.type?.name === 'Countdown'); assert.ok(countdown, 'countdown is mounted');
  active = clock.react;
  const drawClock = () => clock.render(() => countdown.type(countdown.props));
  assert.match(JSON.stringify(drawClock()), /Response.*2s/);
  clock.flush(); t.mock.timers.tick(500);
  assert.match(JSON.stringify(drawClock()), /Response.*1s/);
  const presence = tree.find(n => n.type?.name === 'Presence');
  assert.match(JSON.stringify(presence.type(presence.props)), /Bot covering/);
  tree.find(n => n.props?.label === 'Leave game').props.onPress();
  assert.equal(requests, 1); assert.equal(homes, 0);
  active = runtime.react; clock.unmount();
  session = receive(session, decode(JSON.stringify({ v: PROTOCOL_VERSION, type: 'left' }))).session;
  runtime.render(Online); runtime.flush();
  assert.equal(homes, 1); runtime.unmount();
  assert.equal(closes, 1); assert.equal(requests, 1);
});
