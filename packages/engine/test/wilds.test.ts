// Wild cities: laid as any country they allow, moved for free by their owner, received as payment.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CARDS, COUNTRIES, createGame, legalActions, viewFor, type CardId } from '../src/index.ts';
import { act, actor, completeCountries, drawAll, seat, stack, turn } from './helpers.ts';

test('card data: wild cities for two countries and for any country', () => {
  const countries = COUNTRIES.map((country) => country.id as string);
  const wilds = CARDS.filter((card) => card.kind === 'wild');
  assert.ok(wilds.some((wild) => wild.countries.length === 2));
  assert.ok(wilds.some((wild) => wild.countries.length === countries.length));
  for (const wild of wilds) {
    assert.ok(wild.countries.length >= 2, wild.id);
    assert.equal(new Set(wild.countries).size, wild.countries.length, wild.id);
    assert.ok(wild.countries.every((country) => countries.includes(country)), wild.id);
  }
});

test('a wild city is laid as any one of the countries it allows', () => {
  const deck = stack([['wild-egypt-italy', 'wild-any-1', 'paris'], []]);
  let game = drawAll(createGame({ players: 2, countriesToWin: 3 }, 1, { deck }));

  const lays = (card: CardId) => legalActions(game, 0).filter((a) => a.type === 'lay' && a.card === card);
  assert.deepEqual(
    lays('wild-egypt-italy'),
    ['egypt', 'italy'].map((country) => ({ type: 'lay', card: 'wild-egypt-italy', country })),
  );
  assert.deepEqual(
    lays('wild-any-1'),
    COUNTRIES.map((country) => ({ type: 'lay', card: 'wild-any-1', country: country.id })),
  );
  assert.deepEqual(lays('paris'), [{ type: 'lay', card: 'paris' }]); // a plain city has no choice of country

  game = act(
    game,
    { type: 'lay', card: 'wild-egypt-italy', country: 'italy' },
    { type: 'lay', card: 'wild-any-1', country: 'usa' },
  );
  const view = viewFor(game, 1);
  assert.deepEqual(seat(view, 0).table, [
    { country: 'italy', cities: ['wild-egypt-italy'], complete: false },
    { country: 'usa', cities: ['wild-any-1'], complete: false },
  ]);
  assert.equal(view.turn.playsLeft, 1);
});

test('the owner moves laid wild cities between their countries on their own turn, without using a play', () => {
  const deck = stack([['wild-egypt-italy', 'wild-any-1', 'paris'], []]);
  let game = drawAll(createGame({ players: 2, countriesToWin: 3 }, 1, { deck }));
  game = act(
    game,
    { type: 'lay', card: 'wild-egypt-italy', country: 'italy' },
    { type: 'lay', card: 'wild-any-1', country: 'italy' },
    { type: 'lay', card: 'paris' },
  );

  // No play is left: all that remains is ending the turn or moving a wild city to another country it allows.
  assert.deepEqual(legalActions(game, 0), [
    { type: 'reassign', card: 'wild-egypt-italy', country: 'egypt' },
    ...COUNTRIES.filter((country) => country.id !== 'italy').map((country) => ({
      type: 'reassign',
      card: 'wild-any-1',
      country: country.id,
    })),
    { type: 'endTurn' },
  ]);

  game = act(
    game,
    { type: 'reassign', card: 'wild-any-1', country: 'france' },
    { type: 'reassign', card: 'wild-egypt-italy', country: 'egypt' },
  );
  const view = viewFor(game, 1);
  assert.deepEqual(seat(view, 0).table, [
    { country: 'france', cities: ['paris', 'wild-any-1'], complete: false },
    { country: 'egypt', cities: ['wild-egypt-italy'], complete: false },
  ]);
  assert.deepEqual(view.turn, { player: 0, playsLeft: 0 });

  // On the opponent's turn the wild cities stay where they are: the opponent cannot move them.
  game = drawAll(act(game, { type: 'endTurn' }));
  assert.ok(!legalActions(game, 1).some((a) => a.type === 'reassign'));
});

test('wild cities count toward completing a country, but a country of wild cities only is not complete', () => {
  const deck = stack([['wild-egypt-italy', 'wild-any-1', 'cairo'], []]);
  let game = drawAll(createGame({ players: 2, countriesToWin: 3 }, 1, { deck }));
  const egypt = () => seat(viewFor(game, 1), 0).table.find((s) => s.country === 'egypt');

  // Egypt needs 2 cities.
  game = act(
    game,
    { type: 'lay', card: 'wild-egypt-italy', country: 'egypt' },
    { type: 'lay', card: 'wild-any-1', country: 'egypt' },
  );
  assert.deepEqual(egypt(), { country: 'egypt', cities: ['wild-egypt-italy', 'wild-any-1'], complete: false });

  game = act(game, { type: 'lay', card: 'cairo' });
  assert.deepEqual(egypt(), { country: 'egypt', cities: ['wild-egypt-italy', 'wild-any-1', 'cairo'], complete: true });
});

test('moving a wild city to complete the last country needed wins at once', () => {
  const deck = stack(
    [['cairo', 'alexandria', 'sydney', 'wild-australia-japan', 'tokyo'], []],
    ['coin-1-1', 'wild-any-1', 'osaka'],
  );
  let game = drawAll(createGame({ players: 2, countriesToWin: 3 }, 1, { deck }));
  // Seat 1 only draws and passes, discarding when over the hand limit.
  const opponentPasses = () => {
    game = act(drawAll(game), { type: 'endTurn' });
    while (viewFor(game, 0).phase.kind === 'discard') game = act(game, legalActions(game, actor(game))[0]!);
    game = drawAll(game);
  };

  game = act(
    game,
    { type: 'lay', card: 'cairo' },
    { type: 'lay', card: 'alexandria' },
    { type: 'lay', card: 'sydney' },
    { type: 'endTurn' },
  );
  opponentPasses();
  game = act(
    game,
    { type: 'lay', card: 'wild-australia-japan', country: 'australia' },
    { type: 'lay', card: 'tokyo' },
    { type: 'lay', card: 'wild-any-1', country: 'france' },
    { type: 'endTurn' },
  );
  opponentPasses();
  game = act(game, { type: 'lay', card: 'osaka' });
  assert.equal(completeCountries(viewFor(game, 1), 0), 2);

  game = act(game, { type: 'reassign', card: 'wild-any-1', country: 'japan' });
  const view = viewFor(game, 1);
  assert.deepEqual(view.phase, { kind: 'over', winner: 0 });
  assert.deepEqual(view.log.slice(-2), [
    { type: 'reassign', player: 0, card: 'wild-any-1', country: 'japan' },
    { type: 'gameOver', winner: 0 },
  ]);
});

test('a wild city paid to a player keeps its country, and its new owner is free to move it once paid', () => {
  const deck = stack([['wild-egypt-italy', 'coin-5-1'], ['cairo', 'debt-1']]);
  let game = createGame({ players: 2, countriesToWin: 3 }, 1, { deck });
  game = turn(game, { type: 'lay', card: 'wild-egypt-italy', country: 'italy' }, { type: 'bank', card: 'coin-5-1' });
  game = act(drawAll(game), { type: 'lay', card: 'cairo' }, { type: 'play', card: 'debt-1', target: 0 });

  game = act(game, { type: 'pay', card: 'wild-egypt-italy' }, { type: 'pay', card: 'coin-5-1' });
  let view = viewFor(game, 0);
  assert.deepEqual(view.phase, { kind: 'play', player: 1 });
  assert.deepEqual(seat(view, 1).table, [
    { country: 'egypt', cities: ['cairo'], complete: false },
    { country: 'italy', cities: ['wild-egypt-italy'], complete: false },
  ]);

  game = act(game, { type: 'reassign', card: 'wild-egypt-italy', country: 'egypt' });
  view = viewFor(game, 0);
  assert.deepEqual(seat(view, 1).table, [
    { country: 'egypt', cities: ['cairo', 'wild-egypt-italy'], complete: true },
  ]);
  assert.equal(view.turn.playsLeft, 1);
});
