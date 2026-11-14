// Raid, Exchange and Seizure: taking cities and countries from opponents' tables.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { CARDS, createGame, legalActions, viewFor, type Action, type GameState } from '../src/index.ts';
import { act, actor, completeCountries, drawAll, playOut, stack } from './helpers.ts';

/**
 * Seat 0 holds Egypt (complete) and Paris, seat 1 holds Rome. Seat 2 is about to play,
 * with one card of each kind and both cities of Australia in hand.
 */
function position(): GameState {
  const deck = stack([
    ['cairo', 'alexandria', 'paris'],
    ['rome'],
    ['raid-1', 'exchange-1', 'seizure-1', 'sydney', 'melbourne'],
  ]);
  let game = drawAll(createGame({ players: 3, countriesToWin: 3 }, 1, { deck }));
  game = act(game, lay('cairo'), lay('alexandria'), lay('paris'), { type: 'endTurn' });
  game = act(drawAll(game), lay('rome'), { type: 'endTurn' });
  return drawAll(game);
}

const lay = (card: string): Action => ({ type: 'lay', card });

/** The legal actions of one type for the player the game is waiting on. */
function plays(game: GameState, type: Action['type']): Action[] {
  return legalActions(game, actor(game)).filter((action) => action.type === type);
}

const egypt = { country: 'egypt', cities: ['cairo', 'alexandria'], complete: true };

test('the deck holds 2 Seizure cards; a Raid, Exchange or Seizure with no valid target can only be banked', () => {
  assert.equal(CARDS.filter((card) => card.kind === 'action' && card.action === 'seizure').length, 2);

  // Nobody has laid a city yet.
  const hand = ['raid-1', 'exchange-1', 'seizure-1'];
  const game = drawAll(createGame({ players: 2, countriesToWin: 3 }, 1, { deck: stack([hand, []]) }));
  assert.deepEqual(
    legalActions(game, 0).filter((action) => 'card' in action && hand.includes(action.card)),
    hand.map((card) => ({ type: 'bank', card })),
  );
});

test('Raid takes one chosen city from an incomplete country of any opponent', () => {
  let game = act(position(), lay('sydney'));
  // Not the cities of complete Egypt, nor the raider's own.
  assert.deepEqual(plays(game, 'raid'), [
    { type: 'raid', card: 'raid-1', target: 0, city: 'paris' },
    { type: 'raid', card: 'raid-1', target: 1, city: 'rome' },
  ]);

  game = act(game, { type: 'raid', card: 'raid-1', target: 0, city: 'paris' });
  const view = viewFor(game, 0);
  assert.deepEqual(view.players[0]!.table, [egypt]);
  assert.deepEqual(view.players[2], {
    handSize: 5,
    bank: [],
    table: [
      { country: 'australia', cities: ['sydney'], complete: false },
      { country: 'france', cities: ['paris'], complete: false },
    ],
  });
  // The card is spent: one play used, and it lies on the discard pile.
  assert.equal(view.turn.playsLeft, 1);
  assert.equal(view.discardTop, 'raid-1');
  assert.deepEqual(view.log.at(-1), { type: 'raid', player: 2, card: 'raid-1', target: 0, city: 'paris' });
});

test('Exchange swaps one city each, both from incomplete countries', () => {
  let game = position();
  assert.deepEqual(plays(game, 'exchange'), [], 'no city to give');

  game = act(game, lay('sydney'));
  assert.deepEqual(plays(game, 'exchange'), [
    { type: 'exchange', card: 'exchange-1', target: 0, give: 'sydney', take: 'paris' },
    { type: 'exchange', card: 'exchange-1', target: 1, give: 'sydney', take: 'rome' },
  ]);

  const view = viewFor(act(game, { type: 'exchange', card: 'exchange-1', target: 0, give: 'sydney', take: 'paris' }), 1);
  assert.deepEqual(view.players[0]!.table, [egypt, { country: 'australia', cities: ['sydney'], complete: false }]);
  assert.deepEqual(view.players[2]!.table, [{ country: 'france', cities: ['paris'], complete: false }]);

  // Once Australia is complete its cities cannot be given away.
  assert.deepEqual(plays(act(game, lay('melbourne')), 'exchange'), []);
});

test('Seizure takes a complete country whole', () => {
  let game = position();
  // Incomplete France and Italy cannot be seized.
  assert.deepEqual(plays(game, 'seizure'), [{ type: 'seizure', card: 'seizure-1', target: 0, country: 'egypt' }]);

  game = act(game, { type: 'seizure', card: 'seizure-1', target: 0, country: 'egypt' });
  const view = viewFor(game, 0);
  assert.deepEqual(view.players[0]!.table, [{ country: 'france', cities: ['paris'], complete: false }]);
  assert.deepEqual(view.players[2]!.table, [egypt]);
});

test('a take that completes the last country needed wins at once, for the player who made it', () => {
  // After three turns each, seat 0 holds Egypt, the UK, Paris, Lyon and Kyoto;
  // seat 1 holds Australia, Italy, Tokyo, Osaka and Marseille, and plays the Exchange last.
  const deck = stack(
    [
      ['cairo', 'alexandria', 'london', 'manchester', 'edinburgh'],
      ['sydney', 'melbourne', 'rome', 'milan', 'naples'],
    ],
    ['paris', 'lyon', 'tokyo', 'osaka', 'kyoto', 'coin-1-1', 'marseille', 'exchange-1'],
  );
  // Marseille for Kyoto completes a third country on both sides.
  const swap: Action = { type: 'exchange', card: 'exchange-1', target: 0, give: 'marseille', take: 'kyoto' };
  const game = playOut(
    createGame({ players: 2, countriesToWin: 3 }, 1, { deck }),
    (legal) =>
      legal.find((a) => a.type === 'lay') ??
      legal.find((a) => isDeepStrictEqual(a, swap)) ??
      legal.find((a) => a.type === 'draw' || a.type === 'endTurn')!,
  );

  const view = viewFor(game, 0);
  assert.deepEqual([completeCountries(view, 0), completeCountries(view, 1)], [3, 3]);
  assert.deepEqual(view.phase, { kind: 'over', winner: 1 });
  assert.deepEqual(view.log.slice(-2), [
    { ...swap, player: 1 },
    { type: 'gameOver', winner: 1 },
  ]);
});
