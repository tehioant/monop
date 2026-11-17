import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, createGame, legalActions, viewFor, type GameState } from '@atlas/engine';
import { PROTOCOL_VERSION, type ServerMessage } from '@atlas/server/protocol';
import { Rooms } from '../../server/src/rooms.ts';
import { translate } from '../src/i18n/strings.ts';
import { offline, decode, disconnected, receive } from '../src/online/session.ts';
import { englishLocale, hooks, loadComponent, native, nodes } from './componentBoundary.ts';
const state = createGame({ players: 2, countriesToWin: 3 }, 1);
const game = { type: 'state', stateVersion: 9, view: viewFor(state, 0), legalActions: legalActions(state, 0) };
const room = { type: 'room', code: 'BCDFG', countriesToWin: 3, you: 0, players: [{ name: 'Ada', bot: false, status: 'connected' }, { name: 'Bo', bot: false, status: 'disconnected' }] };

test('storage read/write errors do not crash store or suppress received state; stale actions refuse', (t) => {
  const warnings: unknown[][] = []; t.mock.method(console, 'warn', (...args: unknown[]) => warnings.push(args));
  let callback: any; const sends: unknown[] = [];
  const store = loadComponent(new URL('../src/online/store.ts', import.meta.url).pathname, {
    'expo-localization': { getLocales: () => [{ languageTag: 'en' }] },
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

test('blank online names use the chosen language without letting a locale read block room entry', (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const storage = new Map<string, string>();
  let broken = true;
  let reads = 0;
  let opens = 0;
  const fixture = () => loadComponent(new URL('../src/online/store.ts', import.meta.url).pathname, {
    'expo-localization': { getLocales() {
      reads++;
      if (broken) throw Error('private locale details');
      return [{ languageTag: 'fr-CA' }];
    } },
    'expo-secure-store': { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) },
    './connection.ts': { connection: () => ({ open() { opens++; } }) },
  }).useOnline;
  const store = fixture();
  const create = (expected: RegExp) => {
    const before = opens;
    store.getState().setName('   ');
    store.getState().createRoom(3);
    assert.equal(opens, before + 1);
    assert.deepEqual(store.getState().session.request, { type: 'createRoom', countriesToWin: 3 });
    assert.match(store.getState().session.name, expected);
    assert.equal(storage.get('atlas.name'), store.getState().session.name);
  };
  create(/^Guest [0-9]{4}$/);
  create(/^Guest [0-9]{4}$/);
  assert.equal(reads, 2);
  assert.equal(warn.mock.callCount(), 1);
  assert.match(String(warn.mock.calls[0]!.arguments[0]), /locale/i);
  assert.doesNotMatch(JSON.stringify(warn.mock.calls[0]!.arguments), /private/);
  broken = false;
  create(/^Invité [0-9]{4}$/);
  const readsBeforeOverride = reads;
  broken = true;
  storage.set('atlas.settings', JSON.stringify({ language: 'fr' }));
  const explicit = fixture();
  explicit.getState().setName('');
  explicit.getState().joinRoom('BCDFG');
  assert.equal(opens, 4);
  assert.deepEqual(explicit.getState().session.request, { type: 'joinRoom', code: 'BCDFG' });
  assert.match(explicit.getState().session.name, /^Invité [0-9]{4}$/);
  assert.equal(reads, readsBeforeOverride, 'explicit override never reaches the throwing adapter');
});

test('online actual screen composes pacing, settings, reconnecting, all-seat presence and update prompt', () => {
  const runtime = hooks(); let session: any = { ...offline('Ada', 'issued'), room, game, synced: false, lost: 0 };
  let homes = 0; let closes = 0; let permanentLeaves = 0;
  const Online = loadComponent(new URL('../src/app/online.tsx', import.meta.url).pathname, {
    '../i18n/locale.tsx': englishLocale, react: runtime.react, '../table/parts.tsx': { Button() {}, Panel() {}, shared: {} }, '../table/Choice.tsx': { Choice() {} }, 'react-native': native, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    'expo-router': { useLocalSearchParams: () => ({}), router: { dismissTo(path: string) { assert.equal(path, '/'); homes++; } } },
    '../online/store.ts': { useOnline: () => ({ session, resume() {}, leave() { closes++; }, leaveRoom() { permanentLeaves++; }, play() {} }) },
    '../table/usePaced.ts': { usePaced: (view: any, legal: any) => ({ view, legal, settled: true }) },
    '../table/Table.tsx': { Table() {} }, '../table/Results.tsx': { Results() {} },
  }).default;
  const playing: any = runtime.render(Online); const tree = runtime.render(() => playing.type(playing.props));
  assert.ok(nodes(tree).some(n => n.props?.label === 'Settings'));
  assert.deepEqual(nodes(tree).find(n => n.type?.name === 'Table').props.legal, []);
  const reconnect = nodes(tree).find(n => n.type?.name === 'Reconnecting'); assert.equal(reconnect.type().props.children, 'Reconnecting…');
  assert.ok(!nodes(tree).some(n => n.props?.label === 'Leave game'));
  runtime.flush();
  const ordinaryBack = nodes(tree).find(n => n.props?.label?.startsWith('Back'));
  assert.ok(ordinaryBack && !ordinaryBack.props.disabled);
  ordinaryBack.props.onPress();
  assert.equal(homes, 1);

  session = disconnected({ ...session, synced: true, lost: null, leaving: true });
  const pending: any = runtime.render(Online);
  const pendingTree = nodes(runtime.render(() => pending.type(pending.props)));
  assert.ok(pendingTree.some(n => n.props?.children === 'Your leave request may still complete. Going back does not cancel it.'));
  const back = pendingTree.find(n => n.props?.label === 'Back');
  assert.ok(back && !back.props.disabled);
  assert.equal(ordinaryBack.props.label, 'Back');
  assert.ok(!pendingTree.some(n => n.props?.label === 'Leave game'));
  back.props.onPress();
  assert.equal(homes, 2);
  const presence = nodes(tree).find(n => n.type?.name === 'Presence');
  assert.ok(JSON.stringify(presence.type(presence.props)).includes('offline'));
  assert.ok(JSON.stringify(presence.type(presence.props)).includes('Ada'));
  session = { ...session, error: 'unsupported_version' };
  const update: any = runtime.render(Online); assert.ok(JSON.stringify(update.type()).includes('Update needed')); runtime.unmount();
  assert.equal(closes, 1);
  assert.equal(permanentLeaves, 0);
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
  let tOnline = englishLocale.useTranslation();
  const coveredRoom = { ...room, players: [{ ...room.players[0], name: 'Ada  {amount}' }, { ...room.players[1], name: 'Bot 4', status: 'bot-replaced' }] };
  const live = decode(JSON.stringify({ ...game, v: PROTOCOL_VERSION, deadline: { kind: 'response', at: 3300 }, serverTime: 2000 }));
  let session = receive({ ...offline('Ada', 'issued'), room: coveredRoom } as any, live).session;
  let requests = 0; let homes = 0; let closes = 0;
  const store = { resume() {}, leave() { closes++; }, leaveRoom() { requests++; session = { ...session, leaving: true }; }, play() {} };
  const Online = loadComponent(new URL('../src/app/online.tsx', import.meta.url).pathname, {
    '../i18n/locale.tsx': { useTranslation: () => tOnline }, react, '../table/parts.tsx': { Button() {}, Panel() {}, shared: {} }, '../table/Choice.tsx': { Choice() {} }, 'react-native': native,
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' }, 'expo-router': { useLocalSearchParams: () => ({}), router: { dismissTo() { homes++; } } },
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
  tOnline = translate('fr');
  assert.equal(drawClock().props.children, 'Réponse : 1 s');
  assert.match(JSON.stringify(presence.type(presence.props)), /Remplacé par un robot/);
  assert.match(JSON.stringify(presence.type(presence.props)), /Bot 4/);
  active = runtime.react;
  assert.deepEqual(nodes(playing.type(playing.props)).find(n => n.type?.name === 'Table').props.names, ['Ada  {amount}', 'Bot 4']);
  const permanentRoom = { ...coveredRoom, players: [coveredRoom.players[0], { ...coveredRoom.players[1], bot: true, status: 'connected' }] };
  const frenchTree = nodes(playing.type({ ...playing.props, room: permanentRoom }));
  assert.deepEqual(frenchTree.find(n => n.type?.name === 'Table').props.names, ['Ada  {amount}', 'Bot 4']);
  const permanentPresence = frenchTree.find(n => n.type?.name === 'Presence');
  const seat = nodes(permanentPresence.type(permanentPresence.props)).find(n => n.props?.children?.includes('Bot 4'));
  assert.ok(seat?.props.children.includes(' (Robot)'), 'the role is localized separately from the retained name');
  frenchTree.find(n => n.props?.label === 'Quitter la partie').props.onPress();
  assert.equal(requests, 1); assert.equal(homes, 0);
  active = runtime.react; clock.unmount();
  session = receive(session, decode(JSON.stringify({ v: PROTOCOL_VERSION, type: 'left' }))).session;
  runtime.render(Online); runtime.flush();
  assert.equal(homes, 1); runtime.unmount();
  assert.equal(closes, 1); assert.equal(requests, 1);
});

test('a timed response bypasses queued animation without a delayed packet extending its deadline', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1000 });
  const screen = hooks(); const table = hooks(); const clock = hooks(); let active = screen.react;
  const react = { ...active, useState: (initial: unknown) => active.useState(initial), useEffect: (effect: () => unknown, deps: unknown[]) => active.useEffect(effect, deps) };
  let session = receive({ ...offline('Ada', 'issued'), room } as any, decode(JSON.stringify({ ...game, v: PROTOCOL_VERSION }))).session;
  const store = { resume() {}, leave() {}, leaveRoom() {}, play() {} };
  const Online = loadComponent(new URL('../src/app/online.tsx', import.meta.url).pathname, {
    '../i18n/locale.tsx': englishLocale, react, '../table/parts.tsx': { Button() {}, Panel() {}, shared: {} }, '../table/Choice.tsx': { Choice() {} }, 'react-native': native,
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' }, 'expo-router': { useLocalSearchParams: () => ({}), router: {} },
    '../online/store.ts': { useOnline: () => ({ session, ...store }) },
    '../table/Table.tsx': { Table() {} }, '../table/Results.tsx': { Results() {} },
  }).default;
  const draw = () => {
    active = screen.react;
    const playing: any = screen.render(Online);
    active = table.react;
    return nodes(table.render(() => playing.type(playing.props)));
  };
  const deliver = (current: GameState, stateVersion: number, deadline: { kind: 'turn' | 'response'; at: number }) => {
    const packet = { v: PROTOCOL_VERSION, type: 'state', view: viewFor(current, 0), legalActions: legalActions(current, 0), stateVersion, deadline, serverTime: 1000 };
    session = receive(session, decode(JSON.stringify(packet))).session;
  };

  draw(); screen.flush(); table.flush();
  const peerTurn: GameState = { ...state, phase: { kind: 'play', player: 1 }, turn: { player: 1, played: 0 } };
  const bank = (current: GameState) => applyAction(current, 1, legalActions(current, 1).find(action => action.type === 'bank')!);
  const banked = bank(peerTurn);
  const queued = bank(banked);
  deliver(banked, 10, { kind: 'turn', at: 2000 }); draw(); table.flush();
  deliver(queued, 11, { kind: 'turn', at: 2000 }); draw(); table.flush();
  const ordinary = draw().find(n => n.type?.name === 'Table');
  assert.deepEqual(ordinary.props.view, viewFor(banked, 0));
  assert.deepEqual(ordinary.props.legal, [], 'ordinary online animation still withholds new legal actions');

  const response: GameState = { ...queued, phase: { kind: 'veto', player: 0, target: 0, vetoes: 0, effect: { amount: 1 }, queue: [] } };
  t.mock.timers.tick(100);
  deliver(response, 12, { kind: 'response', at: 1200 });
  const exact = draw().find(n => n.type?.name === 'Table'); // Before a pacing effect or timer can flush.
  assert.deepEqual(exact.props.view, viewFor(response, 0));
  assert.deepEqual(exact.props.legal, legalActions(response, 0));
  assert.ok(exact.props.legal.some((a: { type: string }) => a.type === 'decline'));
  table.flush();
  t.mock.timers.tick(101);
  deliver(response, 12, { kind: 'response', at: 1200 }); // An already-expired packet arrives late.
  const countdown = draw().find(n => n.type?.name === 'Countdown');
  active = clock.react;
  assert.match(JSON.stringify(clock.render(() => countdown.type(countdown.props))), /Response.*0s/);
  screen.unmount(); table.unmount(); clock.unmount();
});

test('a paused room visibly disables play and allows local Back across resync and reconnect', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  t.mock.method(console, 'warn', () => {});
  const runtime = hooks();
  let session = offline('Bo', 'issued');
  const send = (message: ServerMessage) => {
    session = receive(session, decode(JSON.stringify({ v: PROTOCOL_VERSION, ...message }))).session;
  };
  const invalid: GameState = { ...state, phase: { kind: 'pay', player: 1, receiver: 0, owed: 1, amount: 1, queue: [] } };
  const rooms = new Rooms(() => state, () => { throw Error('unexpected bot'); }, { save() {}, finish() {}, discard() {} }, [{
    code: room.code, countriesToWin: 3, startedAt: new Date(0), stateVersion: 9, game: invalid,
    players: [{ account: 'a', name: 'Ada' }, { account: 'b', name: 'Bo' }],
  }], { turnMs: 100, responseMs: 20, graceMs: 30, abandonedMs: 300 });
  t.after(() => { runtime.unmount(); rooms.stop(); });
  const bo = { account: 'b', name: 'Bo', send, close() {} };
  rooms.resume(bo);

  let homes = 0;
  const Online = loadComponent(new URL('../src/app/online.tsx', import.meta.url).pathname, {
    '../i18n/locale.tsx': englishLocale, react: runtime.react, '../table/parts.tsx': { Button() {}, Panel() {}, shared: {} }, '../table/Choice.tsx': { Choice() {} },
    'react-native': native, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    'expo-router': { useLocalSearchParams: () => ({}), router: { dismissTo(path: string) { assert.equal(path, '/'); homes++; } } },
    '../online/store.ts': { useOnline: () => ({ session, resume() {}, leave() {}, leaveRoom() { assert.fail('local Back cannot release the seat'); } }) },
    '../table/usePaced.ts': { usePaced: (view: unknown, legal: unknown) => ({ view, legal, settled: true }) },
    '../table/Table.tsx': { Table() {} }, '../table/Results.tsx': { Results() {} },
  }).default;
  const draw = () => {
    const playing: any = runtime.render(Online);
    return nodes(runtime.render(() => playing.type(playing.props)));
  };
  const hasPauseNotice = (tree: ReturnType<typeof draw>) => tree.some(n => n.props?.children === 'This game is paused.');
  const pausedTree = () => {
    const tree = draw();
    assert.ok(hasPauseNotice(tree), 'the current room state visibly explains why play stopped');
    assert.deepEqual(tree.find(n => n.type?.name === 'Table').props.legal, []);
    assert.ok(!tree.some(n => n.type?.name === 'Countdown'));
    return tree;
  };
  assert.ok(draw().some(n => n.type?.name === 'Countdown'));
  t.mock.timers.tick(20);
  const back = pausedTree().find(n => n.props?.label === 'Back');
  assert.ok(back && !back.props.disabled);
  back.props.onPress();
  assert.equal(homes, 1);

  rooms.resync(bo);
  pausedTree();
  rooms.leave(bo);
  session = disconnected(session);
  send({ type: 'welcome', name: 'Bo', token: 'issued', resumed: true });
  rooms.resume({ ...bo });
  assert.equal(session.synced, true);
  pausedTree();

  const live: GameState = { ...state, phase: { kind: 'play', player: 1 }, turn: { player: 1, played: 0 } };
  const clean = { ...game, view: viewFor(live, 1), legalActions: legalActions(live, 1) };
  assert.ok(clean.legalActions.length > 0);
  for (const malformed of [{ ...clean, paused: 'private error' }, { ...clean, paused: true }]) {
    assert.throws(() => decode(JSON.stringify({ v: PROTOCOL_VERSION, ...malformed })), /Invalid/);
  }
  session = receive(session, decode(JSON.stringify({ v: PROTOCOL_VERSION, ...clean }))).session;
  const active = draw();
  assert.equal(hasPauseNotice(active), false);
  assert.deepEqual(active.find(n => n.type?.name === 'Table').props.legal, clean.legalActions);
});
