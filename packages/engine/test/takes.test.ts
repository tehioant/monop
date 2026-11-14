// Raid, Exchange and Seizure: taking cities and countries from opponents' tables.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { CARDS, createGame, legalActions, viewFor, type Action, type CardId, type GameState } from '../src/index.ts';
import { act, actor, completeCountries, drawAll, playOut, seat, stack, turn } from './helpers.ts';

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
  let game = createGame({ players: 3, countriesToWin: 3 }, 1, { deck });
  game = turn(game, lay('cairo'), lay('alexandria'), lay('paris'));
  game = turn(game, lay('rome'));
  return drawAll(game);
}

const lay = (card: CardId): Action => ({ type: 'lay', card });

/** The ways the awaited player can play `card` for its effect. */
function plays(game: GameState, card: CardId): Action[] {
  return legalActions(game, actor(game)).filter((action) => action.type === 'play' && action.card === card);
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
  assert.deepEqual(plays(game, 'raid-1'), [
    { type: 'play', card: 'raid-1', target: 0, city: 'paris' },
    { type: 'play', card: 'raid-1', target: 1, city: 'rome' },
  ]);

  game = act(game, { type: 'play', card: 'raid-1', target: 0, city: 'paris' });
  const view = viewFor(game, 0);
  assert.deepEqual(seat(view, 0).table, [egypt]);
  assert.deepEqual(seat(view, 2), {
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
  assert.deepEqual(view.log.at(-1), { type: 'play', player: 2, card: 'raid-1', target: 0, city: 'paris' });
});

test('Exchange swaps one city each, both from incomplete countries', () => {
  let game = position();
  assert.deepEqual(plays(game, 'exchange-1'), [], 'no city to give');

  game = act(game, lay('sydney'));
  assert.deepEqual(plays(game, 'exchange-1'), [
    { type: 'play', card: 'exchange-1', target: 0, give: 'sydney', take: 'paris' },
    { type: 'play', card: 'exchange-1', target: 1, give: 'sydney', take: 'rome' },
  ]);

  const swap: Action = { type: 'play', card: 'exchange-1', target: 0, give: 'sydney', take: 'paris' };
  const view = viewFor(act(game, swap), 1);
  assert.deepEqual(seat(view, 0).table, [egypt, { country: 'australia', cities: ['sydney'], complete: false }]);
  assert.deepEqual(seat(view, 2).table, [{ country: 'france', cities: ['paris'], complete: false }]);

  // Once Australia is complete its cities cannot be given away.
  assert.deepEqual(plays(act(game, lay('melbourne')), 'exchange-1'), []);
});

test('Seizure takes a complete country whole', () => {
  const game = position();
  // Incomplete France and Italy cannot be seized.
  assert.deepEqual(plays(game, 'seizure-1'), [{ type: 'play', card: 'seizure-1', target: 0, country: 'egypt' }]);

  const view = viewFor(act(game, { type: 'play', card: 'seizure-1', target: 0, country: 'egypt' }), 0);
  assert.deepEqual(seat(view, 0).table, [{ country: 'france', cities: ['paris'], complete: false }]);
  assert.deepEqual(seat(view, 2).table, [egypt]);
});

test('a wild city that changes hands arrives in the country it was laid as, where its new owner may move it', () => {
  const deck = stack([
    ['cairo', 'alexandria', 'wild-france-usa'],
    ['wild-egypt-italy', 'exchange-1', 'raid-1'],
  ]);
  let game = createGame({ players: 2, countriesToWin: 3 }, 1, { deck });
  game = turn(game, lay('cairo'), lay('alexandria'), { type: 'lay', card: 'wild-france-usa', country: 'france' });
  game = act(
    drawAll(game),
    { type: 'lay', card: 'wild-egypt-italy', country: 'italy' },
    { type: 'play', card: 'exchange-1', target: 0, give: 'wild-egypt-italy', take: 'wild-france-usa' },
  );
  assert.deepEqual(seat(viewFor(game, 0), 0).table, [
    egypt,
    { country: 'italy', cities: ['wild-egypt-italy'], complete: false },
  ]);
  assert.deepEqual(seat(viewFor(game, 0), 1).table, [
    { country: 'france', cities: ['wild-france-usa'], complete: false },
  ]);
  // The taker's turn goes on, so they choose its country at once; the other player will on their own turn.
  assert.deepEqual(
    legalActions(game, 1).filter((action) => action.type === 'reassign'),
    [{ type: 'reassign', card: 'wild-france-usa', country: 'usa' }],
  );

  game = act(game, { type: 'play', card: 'raid-1', target: 0, city: 'wild-egypt-italy' });
  assert.deepEqual(seat(viewFor(game, 0), 1).table, [
    { country: 'france', cities: ['wild-france-usa'], complete: false },
    { country: 'italy', cities: ['wild-egypt-italy'], complete: false },
  ]);
});

test('a seized country joins the cities the taker already has in it', () => {
  const deck = stack([
    ['cairo', 'alexandria'],
    ['wild-egypt-italy', 'seizure-1'],
  ]);
  let game = turn(createGame({ players: 2, countriesToWin: 3 }, 1, { deck }), lay('cairo'), lay('alexandria'));
  game = act(
    drawAll(game),
    { type: 'lay', card: 'wild-egypt-italy', country: 'egypt' },
    { type: 'play', card: 'seizure-1', target: 0, country: 'egypt' },
  );
  const view = viewFor(game, 0);
  assert.deepEqual(seat(view, 0).table, []);
  assert.deepEqual(seat(view, 1).table, [
    { country: 'egypt', cities: ['wild-egypt-italy', 'cairo', 'alexandria'], complete: true },
  ]);
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
  const swap: Action = { type: 'play', card: 'exchange-1', target: 0, give: 'marseille', take: 'kyoto' };
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
