import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyAction,
  createGame,
  legalActions,
  viewFor,
  type Action,
  type GameState,
  type LogEntry,
} from '@atlas/engine';
import { createBot, DIFFICULTIES } from '../src/index.ts';

/** Plays a bot-only game to its end, checking every choice, and returns the final log. */
function playGame(players: number, seed: number): LogEntry[] {
  const bot = createBot('baseline', seed);
  let state: GameState = createGame({ players, countriesToWin: 3 }, seed);
  for (let step = 0; step < 2000; step++) {
    const { phase, log } = viewFor(state, 0);
    if (phase.kind === 'over') return log;
    const legal = legalActions(state, phase.player);
    const action = bot(viewFor(state, phase.player), legal);
    assert.ok(legal.includes(action), `not a legal action: ${JSON.stringify(action)}`);
    state = applyAction(state, phase.player, action);
  }
  throw new Error('The game did not end');
}

test('the difficulty levels are listed, and each gives a bot', () => {
  assert.deepEqual(DIFFICULTIES, ['baseline']);
  for (const difficulty of DIFFICULTIES) assert.equal(typeof createBot(difficulty, 1), 'function');
  assert.throws(() => createBot('grandmaster' as never, 1), RangeError);
});

test('a bot always returns one of the legal actions, until the game is over', () => {
  for (let seed = 1; seed <= 5; seed++) playGame(2 + (seed % 4), seed);
});

test('a bot is deterministic for a given seed', () => {
  assert.deepEqual(playGame(3, 7), playGame(3, 7));
  assert.notDeepEqual(playGame(3, 7), playGame(3, 8));
});

test('a bot lays a city when it can, and chooses among actions it does not know', () => {
  const view = viewFor(createGame({ players: 2, countriesToWin: 3 }, 1), 0);
  const unknown = [{ type: 'endTurn' }, { type: 'someLaterRule', target: 1 }, { type: 'another' }] as Action[];
  const lay: Action = { type: 'lay', card: 'paris' };
  const chosen = new Set<Action>();
  for (let seed = 0; seed < 50; seed++) {
    const bot = createBot('baseline', seed);
    assert.equal(bot(view, [...unknown, lay]), lay);
    chosen.add(bot(view, unknown));
  }
  assert.deepEqual(chosen, new Set(unknown));
});

test('a bot asked to play out of turn fails', () => {
  const state = createGame({ players: 2, countriesToWin: 3 }, 1);
  assert.throws(() => createBot('baseline', 1)(viewFor(state, 1), legalActions(state, 1)));
});
