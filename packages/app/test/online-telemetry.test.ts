import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { createGame, viewFor } from '@atlas/engine';
import type { ServerMessage } from '@atlas/server/protocol';
import { offline, receive, type Game, type Room, type Session } from '../src/online/session.ts';
import { loadComponent } from './componentBoundary.ts';

const room: Room = { type: 'room', code: 'BCDFG', countriesToWin: 3, you: 0, players: [
  { name: 'Private user', bot: false, status: 'connected' }, { name: 'Bot', bot: true, status: 'connected' },
] };
const view = viewFor(createGame({ players: 2, countriesToWin: 3 }, 1), 0);
const active: Game = { type: 'state', stateVersion: 1, view, legalActions: [] };
const terminal: Game = { ...active, stateVersion: 2, view: { ...view, phase: { kind: 'over', winner: 0 } } };
const welcome: ServerMessage = { type: 'welcome', token: 'private token', name: 'Private user', resumed: false };

function fixture(t: TestContext, prepared: Session) {
  const env = 'EXPO_PUBLIC_SENTRY_ANALYTICS_DSN';
  const previous = process.env[env];
  process.env[env] = 'https://0123456789abcdef0123456789abcdef@telemetry.invalid/123';
  t.after(() => { if (previous === undefined) delete process.env[env]; else process.env[env] = previous; });
  let adopt!: (next: Session, message?: ServerMessage) => void;
  const store = loadComponent(new URL('../src/online/store.ts', import.meta.url).pathname, {
    'expo-secure-store': { getItem: () => null, setItem() {} },
    'expo-localization': { getLocales: () => [{ languageTag: 'en' }] },
    './connection.ts': { connection(_socket: unknown, _get: unknown, set: typeof adopt) {
      adopt = set;
      return { send() {}, close() {} };
    } },
  }).useOnline;
  store.setState({ session: prepared });
  const events: unknown[] = [];
  t.mock.method(globalThis, 'fetch', (_url: string, request: RequestInit) => {
    const log = JSON.parse(String(request.body)).resourceLogs[0].scopeLogs[0].logRecords[0];
    events.push([log.body.stringValue, store.getState().session.game?.stateVersion]);
    return Promise.reject(Error('offline'));
  });
  const accept = (message: ServerMessage) => adopt(receive(store.getState().session, message).session, message);
  return { store, accept, events };
}

test('online reports a confirmed lobby start and first adopted finish, not intents, gaps or repeats', (t) => {
  const { store, accept, events } = fixture(t, { ...offline('Private user', null), request: { type: 'joinRoom', code: room.code } });
  accept(welcome);
  accept(room);
  store.getState().startGame();
  assert.deepEqual(events, []);
  accept(active);
  accept(active);
  assert.deepEqual(events, [['game started', 1]]);
  accept({ ...terminal, stateVersion: 6 }); // Gap: retain the old game until resync adopts the next state.
  assert.deepEqual(events, [['game started', 1]]);
  accept({ ...terminal, stateVersion: 6 });
  accept({ ...terminal, stateVersion: 6 });
  assert.deepEqual(events, [['game started', 1], ['game finished', 6]]);
});

test('a resumed seat at version one is not a start, even when an invite request is pending', (t) => {
  const { accept, events } = fixture(t, { ...offline('Private user', 'private token'), request: { type: 'joinRoom', code: room.code } });
  accept({ ...welcome, resumed: true });
  accept(room);
  accept(active);
  assert.deepEqual(events, []);
  accept(terminal);
  assert.deepEqual(events, [['game finished', 2]]);
});
