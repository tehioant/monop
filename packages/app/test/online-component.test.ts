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
