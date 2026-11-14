import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGame, viewFor, type Action, type PlayerView } from '@atlas/engine';
import { actionLabel, groupActions, logLine, promptText } from '../src/table/actions.ts';

const names = ['You', 'Bot 1', 'Bot 2'];

/** An action or a phase the table has no wording or control of its own for. */
const unknown = <T>(value: object) => value as T;

test('actions are labelled from their type and card', () => {
  const label = (action: Action) => actionLabel(action, names);
  assert.equal(label({ type: 'draw' }), 'Draw from the deck');
  assert.equal(label({ type: 'drawMarket', card: 'rio-de-janeiro' }), 'Take Rio De Janeiro');
  assert.equal(label({ type: 'lay', card: 'paris' }), 'Lay Paris');
  assert.equal(label({ type: 'bank', card: 'coin-2-1' }), 'Bank Coin 2');
  assert.equal(label({ type: 'play', card: 'windfall-1' }), 'Play Windfall');
  assert.equal(label({ type: 'play', card: 'debt-1', target: 2 }), 'Play Debt (target: Bot 2)');
  assert.equal(label({ type: 'lay', card: 'wild-egypt-italy', country: 'italy' }), 'Lay Wild Egypt/Italy (country: Italy)');
  assert.equal(label({ type: 'reassign', card: 'wild-any-1', country: 'uk' }), 'Reassign Wild Any (country: UK)');
  assert.equal(label({ type: 'endTurn' }), 'End turn');
});

test('an action type the table does not know is still labelled with everything it carries', () => {
  const raid = unknown<Action>({ type: 'raid', card: 'windfall-1', target: 2, city: 'lyon' });
  assert.equal(actionLabel(raid, names), 'Raid Windfall (target: Bot 2, city: Lyon)');
  const seizure = unknown<Action>({ type: 'seizure', target: 1, country: 'uk' });
  assert.equal(actionLabel(seizure, names), 'Seizure (target: Bot 1, country: UK)');
});

test('log entries name the player, when there is one', () => {
  assert.equal(logLine({ type: 'lay', card: 'paris', player: 1 }, names), 'Bot 1: Lay Paris');
  assert.equal(logLine({ type: 'reshuffle' }, names), 'Reshuffle');
  assert.equal(logLine({ type: 'gameOver', winner: 0 }, names), 'Game over (winner: You)');
  assert.equal(logLine({ type: 'gameOver', winner: null }, names), 'Game over (winner: none)');
  assert.equal(logLine({ type: 'pay', card: 'coin-5-1', player: 2 }, names), 'Bot 2: Pay Coin 5');
});

test('the prompt says who the game waits on, and for what', () => {
  const view = viewFor(createGame({ players: 3, countriesToWin: 3 }, 1), 0);
  const during = (phase: object) => promptText({ ...view, phase: unknown<PlayerView['phase']>(phase) }, names);
  assert.equal(promptText(view, names), 'Your turn: draw 2 from the deck or the Market');
  assert.equal(during({ kind: 'play', player: 0 }), 'Your turn: 3 of 3 plays left');
  assert.equal(during({ kind: 'play', player: 2 }), 'Bot 2 is playing…');
  assert.equal(during({ kind: 'pay', player: 0, receiver: 1, owed: 3 }), 'Your move: pay (receiver: Bot 1, owed: 3)');
  assert.equal(during({ kind: 'over', winner: null }), 'Game over');
});

test('every legal action is offered once: on its card if the viewer can tap it, else as a button', () => {
  const dealt = viewFor(createGame({ players: 2, countriesToWin: 3 }, 1), 0);
  const mine = { handSize: 1, bank: ['coin-1-1'], table: [{ country: 'egypt', cities: ['cairo'], complete: false }] };
  const view = { ...dealt, hand: ['paris'], market: ['tokyo'], players: [mine, dealt.players[1]!] };
  const legal = [
    { type: 'lay', card: 'paris' },
    { type: 'bank', card: 'paris' },
    { type: 'drawMarket', card: 'tokyo' },
    { type: 'pay', card: 'coin-1-1' },
    { type: 'pay', card: 'cairo' },
    { type: 'pay', card: 'a-card-the-table-does-not-draw' },
    { type: 'endTurn' },
  ] satisfies Action[];

  const { byCard, general } = groupActions(view, legal);
  assert.deepEqual([...byCard], [
    ['paris', [legal[0], legal[1]]],
    ['tokyo', [legal[2]]],
    ['coin-1-1', [legal[3]]],
    ['cairo', [legal[4]]],
  ]);
  assert.deepEqual(general, [legal[5], legal[6]]);
});
