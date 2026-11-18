import assert from 'node:assert/strict';
import { test } from 'node:test';
import { englishLocale, animated, hooks, loadComponent, native, nodes } from './componentBoundary.ts';
import { startSolo, type SoloGame } from '../src/solo/solo.ts';
import { serialize, deserialize } from '../src/solo/save.ts';
import { COUNTRIES } from '@atlas/engine';

const config = { bots: 1, difficulty: 'easy' as const, countriesToWin: 3 };
const path = (name: string) => new URL(`../src/${name}`, import.meta.url).pathname;
function device(saved?: SoloGame, fetch = async (_url: string, _request: RequestInit): Promise<never> => {
  throw Error('unexpected telemetry');
}) {
  const files = new Map<string, string>(saved ? [['solo-game.json', serialize(saved)]] : []);
  const faults = new Set<string>();
  const calls: string[] = [];
  class File {
    name: string;
    constructor(_dir: unknown, name: string) { if (faults.has('constructor')) throw Error('private details'); this.name = name; }
    get exists() { return files.has(this.name); }
    info() { if (faults.has('info')) throw Error('private details'); return { exists: files.has(this.name) }; }
    textSync() { calls.push('read'); if (faults.has('read')) throw Error('private details'); return files.get(this.name)!; }
    writeSync(text: string) { calls.push('write'); files.set(this.name, faults.has('write') ? 'partial' : text); if (faults.has('write')) throw Error('private details'); }
    copySync(to: File, _options?: unknown) { if (faults.has('copy')) throw Error('private details'); files.set(to.name, files.get(this.name)!); }
    moveSync(to: File, _options?: unknown) { files.delete(to.name); if (faults.has('move')) throw Error('private details'); files.set(to.name, files.get(this.name)!); files.delete(this.name); this.name = to.name; }
    delete() { calls.push('delete'); if (faults.has('delete')) throw Error('private details'); files.delete(this.name); }
  }
  const load = () => loadComponent(path('solo/store.ts'), { 'expo-file-system': { File, Paths: { document: 'device' } }, 'expo/fetch': { fetch } }).useSolo;
  return { files, faults, calls, load };
}
function prepared(player = 0): SoloGame {
  const game = startSolo(config, 123);
  game.state.turn = { player, played: 0 };
  game.state.phase = { kind: 'draw', player, remaining: 1 };
  return game;
}

test('solo telemetry observes saved starts, rematches and the first persisted terminal transition', (t) => {
  t.mock.method(console, 'warn', () => {});
  const env = 'EXPO_PUBLIC_SENTRY_ANALYTICS_DSN';
  const previous = process.env[env];
  process.env[env] = 'https://0123456789abcdef0123456789abcdef@telemetry.invalid/123';
  t.after(() => { if (previous === undefined) delete process.env[env]; else process.env[env] = previous; });

  const active = prepared();
  const almostOver = prepared();
  almostOver.state.players[0]!.table = COUNTRIES.slice(0, 3).map(({ id, cities }) => ({ country: id, cities: [...cities], upgrades: [] }));
  const observed: unknown[] = [];
  const io = device(active, async (_url, request) => {
    const log = JSON.parse(String(request.body)).resourceLogs[0].scopeLogs[0].logRecords[0];
    observed.push([log.body.stringValue, store.getState().game?.state.phase.kind === 'over', io.files.has('solo-game.json')]);
    throw Error('private');
  });
  const store = io.load();
  assert.deepEqual(observed, [], 'loading a save is silent');
  io.faults.add('write');
  assert.equal(store.getState().start(config), false);
  io.faults.clear();
  assert.equal(store.getState().start(config), true);
  assert.equal(store.getState().abandon(), true);
  store.setState({ game: almostOver });
  io.files.set('solo-game.json', serialize(active));
  io.faults.add('delete');
  assert.equal(store.getState().play({ type: 'draw' }), false);
  assert.equal(store.getState().game, almostOver);
  io.faults.clear();
  assert.equal(store.getState().play({ type: 'draw' }), true);
  assert.equal(store.getState().game?.state.phase.kind, 'over');
  store.getState().retrySave();
  assert.equal(store.getState().rematch(), true);
  assert.deepEqual(observed, [['game started', false, true], ['game finished', true, false], ['game started', false, true]]);
});

test('native store saves new starts and each human or bot action, and reloads identically', () => {
  const fresh = device(); const started = fresh.load(); started.getState().start(config);
  assert.deepEqual(fresh.load().getState().game, started.getState().game);
  for (const player of [0, 1]) {
    const game = prepared(player); const io = device(game); const store = io.load();
    assert.deepEqual(store.getState().game, game);
    if (player === 0) assert.equal(store.getState().play({ type: 'draw' }), true); else store.getState().stepBot();
    assert.notDeepEqual(store.getState().game, game);
    assert.deepEqual(io.load().getState().game, store.getState().game);
  }
});

test('unreadable saves refuse replacement or deletion until a successful retry', () => {
  const game = prepared(); const io = device(game); io.faults.add('read'); const store = io.load();
  assert.ok(store.getState().saveError);
  store.getState().start(config); store.getState().abandon();
  assert.equal(io.files.get('solo-game.json'), serialize(game));
  assert.ok(!io.calls.includes('write') && !io.calls.includes('delete'));
  io.faults.clear(); store.getState().retrySave();
  assert.deepEqual(store.getState().game, game);
  assert.equal(store.getState().saveError, null);
  for (const failure of ['read', 'info']) {
    const existing = device(game); const loaded = existing.load(); existing.faults.add(failure); existing.faults.add('move');
    loaded.getState().play({ type: 'draw' }); loaded.getState().abandon();
    assert.ok(loaded.getState().saveError);
    assert.equal(existing.files.get('solo-game.json'), serialize(game));
    assert.ok(!existing.calls.includes('write') && !existing.calls.includes('delete'));
  }
});

test('failed writes and failed installation retain the previous save without an existing backup', () => {
  for (const failure of ['write', 'move', 'copy']) {
    const game = prepared(); const io = device(game); const store = io.load(); io.faults.add(failure);
    assert.equal(store.getState().play({ type: 'draw' }), false);
    assert.ok(store.getState().saveError);
    io.faults.clear();
    assert.deepEqual(io.load().getState().game, game);
    const unchanged = store.getState().game;
    store.getState().retrySave(); assert.equal(store.getState().saveError, null);
    assert.equal(store.getState().game, unchanged, 'retry must not replay the refused action');
    assert.equal(store.getState().play({ type: 'draw' }), true);
  }
});

test('abandon refuses failed deletion and clears durable and memory state only on success', () => {
  const game = prepared(); const io = device(game); const store = io.load(); io.faults.add('delete');
  store.getState().abandon(); assert.deepEqual(store.getState().game, game); assert.ok(store.getState().saveError);
  io.faults.clear(); store.getState().abandon();
  assert.equal(store.getState().game, null); assert.equal(io.load().getState().game, null);
});

test('home confirmation cancel retains a save; accept calls actual abandon; Settings stays reachable', () => {
  const io = device(prepared()); const store = io.load(); let buttons: any[] = [];
  const useSolo = (selector: any) => selector(store.getState());
  const runtime = hooks();
  const Home = loadComponent(path('app/index.tsx'), {
    react: runtime.react, '../i18n/locale.tsx': englishLocale, '../solo/store.ts': { useSolo },
    'expo-router': { router: { push() {} } }, 'expo-secure-store': { getItem: () => 'skipped' },
    'react-native': { ...native, Alert: { alert(_a: any, _b: any, options: any) { buttons = options; } } },
    '../table/parts.tsx': { Button() {} },
  }).default;
  const tree = runtime.render(Home); assert.ok(nodes(tree).some(n => n.props?.label === 'Settings'));
  nodes(tree).find(n => n.props?.label === 'Abandon solo game').props.onPress();
  buttons.find(b => b.style === 'cancel').onPress?.(); assert.ok(store.getState().game);
  buttons.find(b => b.style === 'destructive').onPress(); assert.equal(store.getState().game, null);
});

test('results rematch saves same configuration with a different seed even when random collides, then routes', () => {
  const game = prepared(); game.seed = 0; game.state.phase = { kind: 'over', winner: 0 };
  const io = device(); const store = io.load(); store.setState({ game }); const random = Math.random;
  Math.random = () => 0;
  try {
    const useSolo = () => store.getState();
    const Results = loadComponent(path('app/solo/results.tsx'), { '../i18n/locale.tsx': englishLocale, '../../i18n/locale.tsx': englishLocale, 'react-native-reanimated': animated, '../../solo/store.ts': { useSolo }, 'expo-router': { Redirect: 'Redirect', router: {} }, 'react-native': native, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' }, '../../table/parts.tsx': { Button() {} }, '../../table/Results.tsx': { Results() {} } }).default;
    nodes(Results()).find(n => n.props?.label === 'Rematch').props.onPress();
    assert.deepEqual(store.getState().game.config, config); assert.notEqual(store.getState().game.seed, game.seed);
    assert.deepEqual(deserialize(io.files.get('solo-game.json')!), store.getState().game);
    assert.equal(Results().props.href, '/solo/table');
  } finally { Math.random = random; }
});

test('constructor errors are contained and repeated failures log only bounded sanitized diagnostics', () => {
  const io = device(prepared()); io.faults.add('constructor'); const warnings: unknown[][] = []; const warn = console.warn;
  console.warn = (...args) => { warnings.push(args); };
  try {
    const store = io.load(); for (let i = 0; i < 3; i++) store.getState().retrySave();
    assert.ok(store.getState().saveError); assert.equal(warnings.length, 1); assert.ok(!JSON.stringify(warnings).includes('private'));
  } finally { console.warn = warn; }
});

test('new game refuses navigation on save failure and the visible save error offers retry', () => {
  const runtime = hooks(); const io = device(); const store = io.load(); io.faults.add('write'); const routes: string[] = [];
  const useSolo = (selector: any) => selector(store.getState());
  const NewGame = loadComponent(path('app/solo/new.tsx'), { '../i18n/locale.tsx': englishLocale, '../../i18n/locale.tsx': englishLocale,
    react: runtime.react, 'react-native': native, 'react-native-reanimated': animated,
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    'expo-router': { router: { replace: (route: string) => routes.push(route) } },
    '../../solo/store.ts': { useSolo }, '../../table/parts.tsx': { Button() {} },
  }).default;
  const render = () => runtime.render(NewGame);
  nodes(render()).find(n => n.props?.label === 'Start').props.onPress();
  assert.deepEqual(routes, []); assert.equal(store.getState().game, null);
  const status = nodes(render()).find(n => n.type?.name === 'SaveStatus');
  const visible = status.type(status.props);
  assert.ok(nodes(visible).some(n => n.props?.children === 'Could not access the saved game. No changes were made. Please retry.'));
  io.faults.clear(); nodes(visible).find(n => n.props?.label === 'Retry save').props.onPress();
  nodes(render()).find(n => n.props?.label === 'Start').props.onPress();
  assert.deepEqual(routes, ['/solo/table']); assert.deepEqual(io.load().getState().game, store.getState().game);
});
