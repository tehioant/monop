import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, createGame, viewFor, type Action, type CardId, type GameState, type PlayerView } from '@atlas/engine';
import { cueBetween, movesBetween, type Cue } from '../src/table/moves.ts';

const draw: Action = { type: 'draw' };
const end: Action = { type: 'endTurn' };
const take = (card: CardId): Action => ({ type: 'drawMarket', card });
const lay = (card: CardId): Action => ({ type: 'lay', card });
const bank = (card: CardId): Action => ({ type: 'bank', card });
const pay = (card: CardId): Action => ({ type: 'pay', card });
const play = (card: CardId, target?: number): Action => ({ type: 'play', card, ...(target === undefined ? {} : { target }) });

/** Two players. Seat 0 holds Australia's two cities, a Windfall and a Debt; seat 1 a Windfall and coins. */
function game(): GameState {
  const deck = [
    ...['sydney', 'melbourne', 'windfall-1', 'debt-1', 'coin-1-1'],
    ...['london', 'coin-5-1', 'coin-5-2', 'windfall-2', 'coin-2-2'],
    ...['tokyo', 'coin-3-1', 'coin-3-2'], // the Market
    ...['coin-1-2', 'coin-1-3', 'coin-1-4', 'coin-1-5', 'coin-2-3', 'coin-2-4', 'coin-2-5'],
    ...['coin-4-1', 'coin-4-2', 'coin-4-3', 'coin-3-3', 'coin-3-4'],
  ];
  // Prepared ordinary round: opening compensation is not the movement contract under test.
  const state = createGame({ players: 2, countriesToWin: 3 }, 1, { deck });
  return { ...state, phase: { kind: 'draw', player: 0, remaining: 2 },
    log: [{ type: 'endTurn', player: 0 }, { type: 'endTurn', player: 1 }] };
}

/** The actions of the game, each by the player the game then waits on. */
const script: Action[] = [
  ...[draw, take('tokyo'), lay('sydney'), bank('coin-1-1'), play('windfall-1'), end],
  ...[draw, take('coin-3-1'), lay('london'), bank('coin-5-1'), play('windfall-2'), end],
  ...[draw, draw, lay('melbourne'), play('debt-1', 1), pay('coin-5-1')],
];

/** What `viewer` sees of each action of the script: the cards that move, as 'card: from > to', and the cue. */
function watch(viewer: number): { moves: string[][]; cues: (Cue | null)[] } {
  let state = game();
  const seen = { moves: [] as string[][], cues: [] as (Cue | null)[] };
  for (const action of script) {
    const before = viewFor(state, viewer);
    const { phase } = before;
    if (phase.kind === 'over') throw new Error('The game is over');
    state = applyAction(state, phase.player, action);
    const after = viewFor(state, viewer);
    seen.moves.push(movesBetween(before, after).map(({ card, from, to }) => `${card ?? '?'}: ${from} > ${to}`).sort());
    seen.cues.push(cueBetween(before, after));
  }
  return seen;
}

test("the viewer's own cards move between the deck, the Market, their hand, their table and the discard pile", () => {
  assert.deepEqual(watch(0).moves.slice(0, 6), [
    ['coin-1-2: deck > hand:0'],
    ['coin-1-3: deck > market', 'tokyo: market > hand:0'],
    ['sydney: hand:0 > table:0'],
    ['coin-1-1: hand:0 > bank:0'],
    ['coin-1-4: deck > hand:0', 'coin-1-5: deck > hand:0', 'windfall-1: hand:0 > discard'],
    [],
  ]);
});

test("an opponent's cards move the same way, face down while they are hidden", () => {
  const { moves } = watch(0);
  assert.deepEqual(moves.slice(6, 12), [
    ['?: deck > hand:1'],
    ['coin-2-4: deck > market', 'coin-3-1: market > hand:1'],
    ['london: hand:1 > table:1'],
    ['coin-5-1: hand:1 > bank:1'],
    ['?: deck > hand:1', '?: deck > hand:1', 'windfall-2: hand:1 > discard'],
    [],
  ]);
  // The Debt, then what it is paid with, from one player's table to the other's.
  assert.deepEqual(moves.slice(-2), [['debt-1: hand:0 > discard'], ['coin-5-1: bank:1 > bank:0']]);
  assert.deepEqual(watch(1).moves.slice(-2), [['debt-1: hand:0 > discard'], ['coin-5-1: bank:1 > bank:0']]);
});

test('the cue is the most notable thing a step did, from the side of the viewer', () => {
  assert.deepEqual(watch(0).cues, [
    ...['play', 'play', 'play', 'play', 'play', null],
    ...['move', 'move', 'move', 'move', 'move', 'turn'],
    ...['play', 'play', 'complete', 'play', 'move'],
  ]);
  assert.deepEqual(watch(1).cues, [
    ...['move', 'move', 'move', 'move', 'move', 'turn'],
    ...['play', 'play', 'play', 'play', 'play', null],
    // Australia is complete; then the Debt: the game waits on seat 1 in the middle of seat 0's turn.
    ...['move', 'move', 'complete', 'alert', 'play'],
  ]);
});

test('the end of the game is cued once, as a win or a loss', () => {
  const view = viewFor(game(), 0);
  const over = (winner: number | null): PlayerView => ({ ...view, phase: { kind: 'over', winner } });
  assert.equal(cueBetween(view, over(0)), 'win');
  assert.equal(cueBetween(view, over(1)), 'lose');
  assert.equal(cueBetween(view, over(null)), 'lose');
  assert.equal(cueBetween(over(0), over(0)), null);
  assert.equal(cueBetween(view, view), null);
});
