import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGame, legalActions, viewFor, type GameState, type Phase } from '@atlas/engine';
import { PROTOCOL_VERSION as v, type ServerMessage } from '@atlas/server/protocol';
import { Rooms } from '../../server/src/rooms.ts';
import { decode } from '../src/online/session.ts';

const base = () => createGame({ players: 2, countriesToWin: 3 }, 1);
const packet = (game = base()) => ({ v, type: 'state', stateVersion: 1, view: viewFor(game, 0), legalActions: legalActions(game, 0) });
const malformed: [string, (m: any) => void][] = [
  ['incomplete view', m => { m.view = { players: [], hand: [], log: [], phase: { kind: 'not-a-phase' } }; }],
  ['unknown phase', m => { m.view.phase = { kind: 'future', player: 0 }; }],
  ['unknown action', m => { m.legalActions = [{ type: 'future' }]; }],
  ...['options', 'market', 'perks', 'turn'].map(key => [`missing ${key}`, (m: any) => { delete m.view[key]; }] as [string, (m: any) => void]),
  ['viewer bounds', m => { m.view.viewer = 2; }],
  ['turn seat', m => { m.view.turn.player = -1; }],
  ['options mismatch', m => { m.view.options.players = 3; }],
  ['bank collection', m => { m.view.players[0].bank = null; }],
  ['table fields', m => { m.view.players[0].table = [{ country: 'france', cities: ['paris'] }]; }],
  ['unknown card', m => { m.view.hand = ['unknown']; }],
  ['unknown country', m => { m.view.perks[0].country = 'unknown'; }],
  ['unknown perk', m => { m.view.perks[0].perk = 'unknown'; }],
  ['perk seat', m => { m.view.perks[0].activeFor = [2]; }],
  ['payment queue', m => { m.view.phase = { kind: 'pay', player: 0, receiver: 1, owed: 2, amount: 2, queue: [2] }; }],
  ['veto effect', m => { m.view.phase = { kind: 'veto', player: 0, target: 1, vetoes: 0, queue: [], effect: { take: { type: 'play' } } }; }],
  ['draw remaining', m => { m.view.phase = { kind: 'draw', player: 0 }; }],
  ['winner bounds', m => { m.view.phase = { kind: 'over', winner: 2 }; }],
  ['action card', m => { m.legalActions = [{ type: 'bank', card: null }]; }],
  ['play target', m => { m.legalActions = [{ type: 'play', card: 'debt-1', target: 2 }]; }],
  ['action nested extra', m => { m.legalActions = [{ type: 'draw', surprise: { type: null } }]; }],
  ['log entry', m => { m.view.log = [null]; }],
  ['log player', m => { m.view.log = [{ type: 'draw', player: 2 }]; }],
];
for (const [name, change] of malformed) test(`wire decode rejects ${name}`, () => {
  const m = packet(); change(m); assert.throws(() => decode(JSON.stringify(m)), /Invalid message/);
});
for (const [name, change] of [
  ['missing options', (m: any) => { delete m.countriesToWin; }],
  ['seat bounds', (m: any) => { m.you = 2; }],
  ['excess seats', (m: any) => { m.players = Array(6).fill(m.players[0]); }],
  ['player status', (m: any) => { m.players[0].status = null; }],
] as const) test(`wire room rejects ${name}`, () => {
  const m = { v, type: 'room', code: 'BCDFG', countriesToWin: 3, you: 0, players: [{ name: 'Ada', bot: false, status: 'connected' }] };
  change(m); assert.throws(() => decode(JSON.stringify(m)), /Invalid message/);
});

// Each state is independently prepared. No actions, turns, bot loops or network are executed.
for (const phase of [
  { kind: 'draw', player: 0, remaining: 2 }, { kind: 'play', player: 0 }, { kind: 'discard', player: 0 },
  { kind: 'pay', player: 0, receiver: 1, owed: 2, amount: 2, queue: [1] },
  { kind: 'veto', player: 0, target: 1, vetoes: 0, effect: { amount: 2 }, queue: [] },
  { kind: 'veto', player: 0, target: 1, vetoes: 1, effect: { take: { type: 'play', card: 'raid-1', target: 1, city: 'paris' } }, queue: [] },
  { kind: 'over', winner: 0 }, { kind: 'over', winner: null },
] satisfies Phase[]) test(`wire accepts independently prepared engine ${JSON.stringify(phase)} view`, () => {
  const game: GameState = { ...base(), phase };
  game.players[0]!.bank = ['coin-2-1'];
  game.players[0]!.hand = ['veto-1', 'paris', 'debt-1'];
  const m = packet(game); assert.deepEqual(decode(JSON.stringify(m)), m);
});
test('wire accepts actual Rooms room and private state output without advancing a game', () => {
  const game = base();
  const rooms = new Rooms(() => { throw Error('no start'); }, () => { throw Error('no bot turn'); },
    { save() { throw Error('no save'); }, finish() { throw Error('no finish'); }, discard() { throw Error('no discard'); } },
    [{ code: 'BCDFG', countriesToWin: 3, players: [{ account: 'a', name: 'Ada' }, { account: null, name: 'Bot' }], startedAt: new Date(0), stateVersion: 1, game }]);
  const messages: ServerMessage[] = [];
  rooms.resume({ account: 'a', name: 'Ada', send: m => messages.push(m), close() {} });
  assert.deepEqual(messages.map(m => m.type), ['room', 'state']);
  for (const m of messages) assert.deepEqual(decode(JSON.stringify({ v, ...m })), { v, ...m });
  // A bot-to-move view is produced by the engine directly, never executed by Rooms.
  const bot = base(); bot.turn.player = 1; bot.phase = { kind: 'play', player: 1 };
  const m = { v, type: 'state', stateVersion: 2, view: viewFor(bot, 0), legalActions: legalActions(bot, 0) };
  assert.deepEqual(decode(JSON.stringify(m)), m);
});

test('wire accepts known action and log payloads with nested table collections', () => {
  const m = packet();
  m.view.players[0]!.table = [{ country: 'france', cities: ['paris'], upgrades: ['upgrade-1'], complete: false, toll: 4 }];
  const actions = [
    { type: 'draw' }, { type: 'drawMarket', card: 'paris' }, { type: 'lay', card: 'paris' },
    { type: 'lay', card: 'wild-any-1', country: 'france' }, { type: 'reassign', card: 'wild-any-1', country: 'france' },
    { type: 'bank', card: 'coin-2-1' }, { type: 'pay', card: 'paris' }, { type: 'discard', card: 'paris' },
    { type: 'endTurn' }, { type: 'decline' }, { type: 'play', card: 'veto-1' },
    { type: 'play', card: 'windfall-1' }, { type: 'play', card: 'levy-1' },
    { type: 'play', card: 'debt-1', target: 1 }, { type: 'play', card: 'toll-1', country: 'france' },
    { type: 'play', card: 'upgrade-1', country: 'france' },
    { type: 'play', card: 'raid-1', target: 1, city: 'paris' },
    { type: 'play', card: 'exchange-1', target: 1, give: 'paris', take: 'lyon' },
    { type: 'play', card: 'seizure-1', target: 1, country: 'france' },
  ];
  const full = { ...m, legalActions: actions, view: { ...m.view, log: [
    ...actions.map(action => ({ ...action, player: 0 })), { type: 'reshuffle' },
    { type: 'return', card: 'veto-1', player: 1 }, { type: 'gameOver', winner: null },
  ] } };
  assert.deepEqual(decode(JSON.stringify(full)), full);
});
test('wire refuses the v2 predecessor and preserves its update error', () => {
  assert.equal(v, 3);
  const refusal = { v: v - 1, type: 'error', code: 'unsupported_version', message: 'Update required' };
  assert.deepEqual(decode(JSON.stringify(refusal)), refusal);
  assert.deepEqual(decode(JSON.stringify({ v: v - 1, type: 'state' })), { type: 'error', code: 'unsupported_version', message: '' });
});
test('wire keeps older and newer cross-version refusal shapes', () => {
  for (const version of [1, v + 1]) {
    const refusal = { v: version, type: 'error', code: 'unsupported_version', message: 'Update' };
    assert.deepEqual(decode(JSON.stringify(refusal)), refusal);
    assert.equal((decode(JSON.stringify({ v: version, type: 'state' })) as any).code, 'unsupported_version');
  }
});
