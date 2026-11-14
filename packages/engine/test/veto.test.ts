// Veto: the response phase, chains of Vetoes, and cards that hit several opponents.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  COUNTRIES,
  createGame,
  legalActions,
  RULES,
  viewFor,
  type Action,
  type CardId,
  type Effect,
  type GameState,
  type Play,
} from '../src/index.ts';
import { act, drawAll, stack, turn } from './helpers.ts';

const lay = (card: CardId): Action => ({ type: 'lay', card });
const bank = (card: CardId): Action => ({ type: 'bank', card });
const veto = (card: CardId): Action => ({ type: 'play', card });
const decline: Action = { type: 'decline' };

const egypt = { country: 'egypt', cities: ['cairo', 'alexandria'], complete: true };

test('each card that hits an opponent waits for their Veto, which cancels it; the card is still spent', () => {
  // Seat 0 holds Egypt, Paris and a Veto. Seat 1 has laid Sydney and holds one card of each kind, with two plays left.
  const deck = stack(
    [
      ['cairo', 'alexandria', 'paris', 'veto-1'],
      ['sydney', 'toll-1', 'levy-1', 'debt-1', 'raid-1'],
    ],
    ['coin-1-1', 'coin-1-2', 'exchange-1', 'seizure-1'],
  );
  let game = createGame({ players: 2, countriesToWin: 3 }, 1, { deck });
  game = turn(game, lay('cairo'), lay('alexandria'), lay('paris'));
  game = act(drawAll(game), lay('sydney'));
  const before = viewFor(game, 0);

  const raid: Play = { type: 'play', card: 'raid-1', target: 0, city: 'paris' };
  const exchange: Play = { type: 'play', card: 'exchange-1', target: 0, give: 'sydney', take: 'paris' };
  const seizure: Play = { type: 'play', card: 'seizure-1', target: 0, country: 'egypt' };
  const cases: [Play, Effect][] = [
    [{ type: 'play', card: 'toll-1', country: 'australia' }, { amount: COUNTRIES[1].toll[0] }],
    [{ type: 'play', card: 'levy-1' }, { amount: RULES.levyAmount }],
    [{ type: 'play', card: 'debt-1', target: 0 }, { amount: RULES.debtAmount }],
    [raid, { take: raid }],
    [exchange, { take: exchange }],
    [seizure, { take: seizure }],
  ];
  for (const [play, effect] of cases) {
    // Nothing has happened yet: the target is asked first.
    const asked = act(game, play);
    assert.deepEqual(viewFor(asked, 0).phase, { kind: 'veto', player: 0, target: 0, vetoes: 0, effect, queue: [] });
    assert.deepEqual(legalActions(asked, 0), [veto('veto-1'), decline]);

    // Seat 1 has no Veto to answer with, so the card is cancelled and their turn goes on.
    const view = viewFor(act(asked, veto('veto-1')), 0);
    assert.deepEqual(view.phase, { kind: 'play', player: 1 }, play.card);
    assert.deepEqual(view.players[0], { ...before.players[0]!, handSize: before.players[0]!.handSize - 1 });
    assert.deepEqual(view.players[1], { ...before.players[1]!, handSize: before.players[1]!.handSize - 1 });
    assert.equal(view.turn.playsLeft, before.turn.playsLeft - 1);
    assert.equal(view.discardTop, 'veto-1');
    assert.deepEqual(view.log.slice(-2), [
      { ...play, player: 1 },
      { type: 'play', card: 'veto-1', player: 0 },
    ]);
  }
});

test('Vetoes answer each other until one side declines or has none left: an odd number cancels the card', () => {
  // Seat 0 holds Egypt and two Vetoes; seat 1 plays a Seizure on it, with one Veto in hand.
  const deck = stack([
    ['cairo', 'alexandria', 'veto-1', 'veto-2'],
    ['seizure-1', 'veto-3'],
  ]);
  let game = createGame({ players: 2, countriesToWin: 3 }, 1, { deck });
  // In a player's own turn a Veto is not a play: it can only be banked.
  assert.deepEqual(
    legalActions(drawAll(game), 0).filter((action) => 'card' in action && action.card === 'veto-1'),
    [bank('veto-1')],
  );
  game = turn(game, lay('cairo'), lay('alexandria'));
  const seizure: Play = { type: 'play', card: 'seizure-1', target: 0, country: 'egypt' };
  game = act(drawAll(game), seizure);

  /** Who holds Egypt once the game is back in seat 1's turn, with the Seizure as their only play so far. */
  const holder = (state: GameState): number => {
    const view = viewFor(state, 0);
    assert.deepEqual(view.phase, { kind: 'play', player: 1 });
    assert.equal(view.turn.playsLeft, RULES.playsPerTurn - 1, 'a Veto is not one of the turn’s plays');
    const seat = view.players.findIndex((p) => p.table.length > 0);
    assert.deepEqual(view.players[seat]!.table, [egypt]);
    return seat;
  };
  const chain = { kind: 'veto', target: 0, effect: { take: seizure }, queue: [] };

  // No Veto: the Seizure goes through.
  const taken = act(game, decline);
  assert.equal(holder(taken), 1);
  assert.deepEqual(viewFor(taken, 0).log.slice(-2), [
    { ...seizure, player: 1 },
    { type: 'decline', player: 0 },
  ]);

  // One Veto: the player of the Seizure may answer it, and lets it stand.
  game = act(game, veto('veto-1'));
  assert.deepEqual(viewFor(game, 0).phase, { ...chain, player: 1, vetoes: 1 });
  assert.deepEqual(legalActions(game, 1), [veto('veto-3'), decline]);
  assert.equal(holder(act(game, decline)), 0);

  // Two: the Veto is vetoed, and the Seizure goes through unless seat 0 answers again.
  game = act(game, veto('veto-3'));
  assert.deepEqual(viewFor(game, 0).phase, { ...chain, player: 0, vetoes: 2 });
  assert.deepEqual(legalActions(game, 0), [veto('veto-2'), decline]);
  assert.equal(holder(act(game, decline)), 1);

  // Three: seat 1 has no Veto left, so is not asked, and the Seizure is cancelled.
  assert.equal(holder(act(game, veto('veto-2'))), 0);
});

test('a card that hits several opponents resolves one opponent at a time, each with their own answer', () => {
  // Seats 0 and 1 hold a Veto, seat 2 none. Seat 3 plays a Levy.
  const deck = stack([['coin-2-1', 'veto-1'], ['coin-3-1', 'veto-2'], ['coin-1-1', 'coin-2-2'], ['levy-1']]);
  let game = createGame({ players: 4, countriesToWin: 3 }, 1, { deck });
  game = turn(game, bank('coin-2-1'));
  game = turn(game, bank('coin-3-1'));
  game = turn(game, bank('coin-1-1'), bank('coin-2-2'));
  game = act(drawAll(game), { type: 'play', card: 'levy-1' });
  const levy = { kind: 'veto', vetoes: 0, effect: { amount: RULES.levyAmount } };

  // Seat 0 keeps their Veto and pays. Seat 1 is asked in turn, and plays theirs: seat 1 pays nothing.
  assert.deepEqual(viewFor(game, 0).phase, { ...levy, player: 0, target: 0, queue: [1, 2] });
  game = act(game, decline);
  assert.deepEqual(viewFor(game, 0).phase, { ...levy, player: 1, target: 1, queue: [2] });
  game = act(game, veto('veto-2'));

  // That Veto does not protect seat 2, who holds none: no question, they pay.
  assert.deepEqual(viewFor(game, 0).phase, { kind: 'pay', player: 2, receiver: 3, owed: 2, amount: 2, queue: [] });
  game = act(game, { type: 'pay', card: 'coin-2-2' });

  const view = viewFor(game, 0);
  assert.deepEqual(view.phase, { kind: 'play', player: 3 });
  assert.deepEqual(
    view.players.map((p) => p.bank),
    [[], ['coin-3-1'], ['coin-1-1'], ['coin-2-1', 'coin-2-2']],
  );
  assert.deepEqual(view.log.slice(-5), [
    { type: 'play', card: 'levy-1', player: 3 },
    { type: 'decline', player: 0 },
    { type: 'pay', card: 'coin-2-1', player: 0 },
    { type: 'play', card: 'veto-2', player: 1 },
    { type: 'pay', card: 'coin-2-2', player: 2 },
  ]);
});
