import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, createGame, viewFor, type Action, type PlayerView } from '@atlas/engine';
import { actionLabel, groupActions, logLine, promptText, shownCards } from '../src/table/actions.ts';

const names = ['You', 'Bot 1', 'Bot 2'];

/** An action or a phase the table has no wording or control of its own for. */
const unknown = <T>(value: object) => value as T;

test('actions are labelled from their type and card', () => {
  const label = (action: Action) => actionLabel(action, names);
  assert.equal(label({ type: 'draw' }), 'Draw from the deck');
  assert.equal(label({ type: 'drawMarket', card: 'rio-de-janeiro' }), 'Take Rio de Janeiro');
  assert.equal(label({ type: 'lay', card: 'paris' }), 'Lay Paris');
  assert.equal(label({ type: 'bank', card: 'coin-2-1' }), 'Bank Coin 2');
  assert.equal(label({ type: 'play', card: 'windfall-1' }), 'Play Windfall');
  assert.equal(label({ type: 'play', card: 'debt-1', target: 2 }), 'Play Debt (target: Bot 2)');
  assert.equal(label({ type: 'lay', card: 'wild-egypt-italy', country: 'italy' }), 'Lay Wild Egypt/Italy (country: Italy)');
  assert.equal(label({ type: 'reassign', card: 'wild-any-1', country: 'uk' }), 'Reassign Wild Any (country: Thailand)');
  assert.equal(label({ type: 'play', card: 'raid-1', target: 1, city: 'lyon' }), 'Play Raid (target: Bot 1, city: Lyon)');
  assert.equal(label({ type: 'decline' }), 'Decline');
  assert.equal(label({ type: 'endTurn' }), 'End turn');
});

test('an action type the table does not know is still labelled with everything it carries', () => {
  const embargo = unknown<Action>({ type: 'tradeEmbargo', card: 'windfall-1', target: 2, city: 'lyon' });
  assert.equal(actionLabel(embargo, names), 'Trade embargo Windfall (target: Bot 2, city: Lyon)');
  const blockade = unknown<Action>({ type: 'blockade', target: 1, country: 'uk', cost: { coins: 2 } });
  assert.equal(actionLabel(blockade, names), 'Blockade (target: Bot 1, country: Thailand, cost: coins: 2)');
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
  assert.equal(promptText(view, names), 'Your turn (plays left: 3)');
  assert.equal(during({ kind: 'draw', player: 0, remaining: 2 }), 'Your turn: draw 2 from the deck or the Market');
  assert.equal(during({ kind: 'play', player: 0 }), 'Your turn (plays left: 3)');
  assert.equal(during({ kind: 'play', player: 2 }), 'Bot 2 is playing…');
  assert.equal(during({ kind: 'pay', player: 0, receiver: 1, owed: 3 }), 'Your move: pay (receiver: Bot 1, owed: 3)');
  assert.equal(
    during({ kind: 'veto', player: 0, effect: { take: { type: 'play', card: 'raid-1', target: 0, city: 'lyon' } }, queue: [] }),
    'Your move: veto (effect: take: Play Raid (target: You, city: Lyon), queue: none)',
  );
  assert.equal(during({ kind: 'over', winner: null }), 'Game over');
});

test('every legal action is offered once: on its card if the viewer can tap it, else as a button', () => {
  // Seat 0 is dealt the first five cards, seat 1 the next five, then the Market, then the draws.
  const deck = [
    ...['paris', 'cairo', 'coin-1-1', 'coin-1-2', 'coin-1-3'],
    ...['coin-2-1', 'coin-2-2', 'coin-2-3', 'coin-2-4', 'coin-2-5'],
    ...['tokyo', 'coin-3-1', 'coin-3-2'],
    ...['coin-3-3', 'coin-4-1', 'coin-4-2'],
  ];
  let state = createGame({ players: 2, countriesToWin: 3 }, 1, { deck });
  for (const action of [{ type: 'lay', card: 'cairo' }, { type: 'bank', card: 'coin-1-1' }] as const) {
    state = applyAction(state, 0, action);
  }
  // One action per place a card of the viewer's can be, one on a card the table does not draw, one with no card.
  const legal: Action[] = [
    { type: 'lay', card: 'paris' },
    { type: 'bank', card: 'paris' },
    { type: 'drawMarket', card: 'tokyo' },
    { type: 'pay', card: 'coin-1-1' },
    { type: 'pay', card: 'cairo' },
    { type: 'pay', card: 'coin-2-1' },
    { type: 'endTurn' },
  ];

  const { byCard, general } = groupActions(viewFor(state, 0), legal);
  assert.deepEqual([...byCard], [
    ['paris', [legal[0], legal[1]]],
    ['tokyo', [legal[2]]],
    ['coin-1-1', [legal[3]]],
    ['cairo', [legal[4]]],
  ]);
  assert.deepEqual(general, [legal[5], legal[6]]);
});

test('the cards shown are those the viewer can see on the table: never another hand, never the deck', () => {
  const deck = [
    ...['cairo', 'alexandria', 'upgrade-1', 'coin-1-2', 'coin-1-3'],
    ...['coin-2-1', 'coin-2-2', 'coin-2-3', 'coin-2-4', 'coin-2-5'],
    ...['tokyo', 'coin-3-1', 'coin-3-2'],
    ...['coin-1-1', 'coin-4-1', 'coin-4-2', 'coin-5-1', 'coin-5-2'],
  ];
  const draw: Action = { type: 'draw' };
  const turns: [number, Action[]][] = [
    [0, [{ type: 'lay', card: 'cairo' }, { type: 'lay', card: 'alexandria' }]],
    [0, [{ type: 'play', card: 'upgrade-1', country: 'egypt' }, { type: 'endTurn' }]],
    [1, [draw, { type: 'bank', card: 'coin-2-1' }]],
  ];
  let state = createGame({ players: 2, countriesToWin: 3 }, 1, { deck });
  for (const [player, actions] of turns) for (const action of actions) state = applyAction(state, player, action);
  const view = viewFor(state, 0);
  // The discard pile is still empty: its top card is shown too, once there is one.
  const shown = shownCards({ ...view, discardTop: 'windfall-1' });
  const expected = ['cairo', 'alexandria', 'upgrade-1', 'coin-2-1', 'windfall-1', ...view.hand, ...view.market];
  assert.deepEqual([...shown].sort(), expected.sort());
  assert.deepEqual([view.hand.length, view.market.length], [2, 3]);
});
