// Charging cards (Levy, Debt) and the payment phase.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGame, legalActions, viewFor, type Action, type GameState } from '../src/index.ts';
import { act, drawAll, seat, stack, turn } from './helpers.ts';

const bank = (card: string): Action => ({ type: 'bank', card });
const lay = (card: string): Action => ({ type: 'lay', card });
const pay = (card: string): Action => ({ type: 'pay', card });

/** Three players. Seat 0 has 7 coin in the bank and Paris laid, seat 1 has 1 coin; seat 2 is about to play a Debt. */
function beforeDebt(): GameState {
  const deck = stack([['coin-5-1', 'coin-2-1', 'paris'], ['coin-1-1'], ['debt-1']]);
  let game = createGame({ players: 3, countriesToWin: 3 }, 1, { deck });
  game = turn(game, bank('coin-5-1'), bank('coin-2-1'), lay('paris'));
  return drawAll(turn(game, bank('coin-1-1')));
}

const debtOnSeat0: Action = { type: 'play', card: 'debt-1', target: 0 };

test('a Debt makes the chosen opponent pay its amount from their bank and laid cities, never from hand', () => {
  let game = beforeDebt();
  // A Debt needs a target: any one opponent.
  assert.deepEqual(
    legalActions(game, 2).filter((a) => a.type === 'play'),
    [debtOnSeat0, { type: 'play', card: 'debt-1', target: 1 }],
  );

  // The owing player is the one to act, and only with what is on their table.
  game = act(game, debtOnSeat0);
  let view = viewFor(game, 1);
  assert.deepEqual(view.phase, { kind: 'pay', player: 0, receiver: 2, owed: 5, amount: 5, queue: [] });
  assert.equal(view.discardTop, 'debt-1');
  assert.deepEqual(legalActions(game, 0), [pay('coin-5-1'), pay('coin-2-1'), pay('paris')]);

  // Exact payment: the coin goes to the receiver's bank and the turn resumes, one play spent.
  game = act(game, pay('coin-5-1'));
  view = viewFor(game, 1);
  assert.deepEqual(view.phase, { kind: 'play', player: 2 });
  assert.equal(view.turn.playsLeft, 2);
  assert.deepEqual(view.players[2]!.bank, ['coin-5-1']);
  assert.deepEqual(seat(view, 0), {
    handSize: 4,
    bank: ['coin-2-1'],
    table: [{ country: 'france', cities: ['paris'], complete: false }],
  });
  assert.deepEqual(view.players[1]!.bank, ['coin-1-1']);
});

test("a laid city used to pay goes to the receiver's countries, and no change is given", () => {
  let game = act(beforeDebt(), debtOnSeat0, pay('paris'));
  assert.deepEqual(viewFor(game, 0).phase, { kind: 'pay', player: 0, receiver: 2, owed: 3, amount: 5, queue: [] });
  assert.deepEqual(legalActions(game, 0), [pay('coin-5-1'), pay('coin-2-1')]);

  game = act(game, pay('coin-5-1')); // 7 paid for 5 owed
  const view = viewFor(game, 0);
  assert.deepEqual(view.phase, { kind: 'play', player: 2 });
  assert.deepEqual(seat(view, 2), {
    handSize: 6,
    bank: ['coin-5-1'],
    table: [{ country: 'france', cities: ['paris'], complete: false }],
  });
  assert.deepEqual(view.players[0], { handSize: 4, bank: ['coin-2-1'], table: [] });
});

test('a Levy charges every opponent its amount, in turn order starting after the player', () => {
  const deck = stack([['coin-2-1', 'coin-1-1'], ['levy-1'], ['coin-3-1', 'coin-1-2']]);
  let game = createGame({ players: 3, countriesToWin: 3 }, 1, { deck });
  game = turn(game, bank('coin-2-1'), bank('coin-1-1'));
  game = turn(game);
  game = turn(game, bank('coin-3-1'), bank('coin-1-2'));
  game = drawAll(turn(game));

  assert.deepEqual(
    legalActions(game, 1).filter((a) => a.type === 'play' && a.card === 'levy-1'),
    [{ type: 'play', card: 'levy-1' }], // no target to choose
  );

  game = act(game, { type: 'play', card: 'levy-1' });
  assert.deepEqual(viewFor(game, 0).phase, { kind: 'pay', player: 2, receiver: 1, owed: 2, amount: 2, queue: [0] });
  game = act(game, pay('coin-3-1'));
  assert.deepEqual(viewFor(game, 0).phase, { kind: 'pay', player: 0, receiver: 1, owed: 2, amount: 2, queue: [] });
  game = act(game, pay('coin-1-1'), pay('coin-2-1'));

  const view = viewFor(game, 0);
  assert.deepEqual(view.phase, { kind: 'play', player: 1 });
  assert.deepEqual(
    view.players.map((p) => p.bank),
    [[], ['coin-3-1', 'coin-1-1', 'coin-2-1'], ['coin-1-2']],
  );
});

test('a player who cannot cover the amount pays everything on their table; one with nothing pays nothing', () => {
  const deck = stack([['coin-1-1'], [], ['levy-1']]);
  let game = createGame({ players: 3, countriesToWin: 3 }, 1, { deck });
  game = turn(game, bank('coin-1-1'));
  game = drawAll(turn(game));
  game = act(game, { type: 'play', card: 'levy-1' });

  // Nobody has a choice to make, so nobody is asked: the turn goes on, and the debts are settled.
  const view = viewFor(game, 0);
  assert.deepEqual(view.phase, { kind: 'play', player: 2 });
  assert.deepEqual(
    view.players.map((p) => ({ bank: p.bank, handSize: p.handSize })),
    [
      { bank: [], handSize: 6 },
      { bank: [], handSize: 7 },
      { bank: ['coin-1-1'], handSize: 6 },
    ],
  );
  assert.deepEqual(view.log.slice(-2), [
    { type: 'play', card: 'levy-1', player: 2 },
    { type: 'pay', card: 'coin-1-1', player: 0 },
  ]);
});

test('a city received as payment can complete a country and win the game', () => {
  const deck = stack(
    [
      ['cairo', 'sydney'],
      ['paris', 'lyon', 'marseille', 'alexandria', 'melbourne'],
    ],
    ['coin-1-1', 'coin-1-2', 'debt-1'],
  );
  let game = createGame({ players: 2, countriesToWin: 3 }, 1, { deck });
  game = turn(game, lay('cairo'), lay('sydney'));
  game = turn(game, lay('paris'), lay('lyon'), lay('marseille'));
  game = turn(game);
  game = act(drawAll(game), lay('alexandria'), lay('melbourne'));
  assert.equal(viewFor(game, 0).phase.kind, 'play');

  // Seat 0 owes more than their two cities are worth: both go to seat 1, completing Egypt and Australia.
  game = act(game, { type: 'play', card: 'debt-1', target: 0 });
  const view = viewFor(game, 0);
  assert.deepEqual(view.phase, { kind: 'over', winner: 1 });
  assert.deepEqual(view.players[0]!.table, []);
  assert.deepEqual(view.log.slice(-3), [
    { type: 'pay', card: 'cairo', player: 0 },
    { type: 'pay', card: 'sydney', player: 0 },
    { type: 'gameOver', winner: 1 },
  ]);
});
