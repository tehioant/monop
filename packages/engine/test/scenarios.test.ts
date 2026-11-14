import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CARDS, COUNTRIES, createGame, legalActions, viewFor, type CardId } from '../src/index.ts';
import { act, actor, ALL_CARDS, completeCountries, drawAll, playOut, stack } from './helpers.ts';

const coins = CARDS.filter((card) => card.kind === 'coin').map((card) => card.id);

test('card data: 10 countries of 2 to 4 cities, coin cards, unique ids', () => {
  assert.equal(COUNTRIES.length, 10);
  for (const country of COUNTRIES) {
    assert.ok(country.cities.length >= 2 && country.cities.length <= 4, country.id);
  }
  assert.ok(coins.length > 0);
  assert.ok(CARDS.every((card) => Number.isInteger(card.value) && card.value > 0));
  assert.equal(new Set(ALL_CARDS).size, ALL_CARDS.length);
});

test('a new game deals 5 cards to each player and waits for seat 0 to draw', () => {
  const options = { players: 3, countriesToWin: 5 };
  const game = createGame(options, 1);
  for (const player of [0, 1, 2]) {
    const view = viewFor(game, player);
    assert.equal(view.viewer, player);
    assert.deepEqual(view.options, options);
    assert.equal(view.hand.length, 5);
    assert.deepEqual(view.players, Array(3).fill({ handSize: 5, bank: [], table: [] }));
    assert.equal(view.deckSize, ALL_CARDS.length - 15);
    assert.equal(view.discardTop, null);
    assert.deepEqual(view.phase, { kind: 'draw', player: 0, remaining: 2 });
    assert.deepEqual(view.log, []);
  }
  assert.deepEqual(legalActions(game, 0), [{ type: 'draw' }]);
});

test('createGame rejects unsupported options', () => {
  assert.throws(() => createGame({ players: 1, countriesToWin: 3 }, 1), RangeError);
  assert.throws(() => createGame({ players: 6, countriesToWin: 3 }, 1), RangeError);
  assert.throws(() => createGame({ players: 2, countriesToWin: 4 }, 1), RangeError);
});

test('a turn draws 2 cards, then allows up to 3 plays: lay a city or bank any card', () => {
  const deck = stack([['paris', 'cairo', 'coin-2-1'], []], ['lyon', 'coin-1-1']);
  let game = createGame({ players: 2, countriesToWin: 3 }, 1, { deck });

  game = act(game, { type: 'draw' });
  assert.deepEqual(viewFor(game, 0).phase, { kind: 'draw', player: 0, remaining: 1 });
  game = act(game, { type: 'draw' });
  let view = viewFor(game, 0);
  assert.deepEqual(view.phase, { kind: 'play', player: 0 });
  assert.equal(view.turn.playsLeft, 3);
  assert.deepEqual(view.hand.slice(-2), ['lyon', 'coin-1-1']);
  assert.equal(view.deckSize, ALL_CARDS.length - 12);

  // Cities can be laid or banked, coins only banked; ending the turn is always possible.
  const legal = legalActions(game, 0);
  assert.ok(legal.some((a) => a.type === 'lay' && a.card === 'paris'));
  assert.ok(legal.some((a) => a.type === 'bank' && a.card === 'paris'));
  assert.ok(legal.some((a) => a.type === 'bank' && a.card === 'coin-2-1'));
  assert.ok(!legal.some((a) => a.type === 'lay' && a.card === 'coin-2-1'));
  assert.ok(legal.some((a) => a.type === 'endTurn'));

  game = act(game, { type: 'lay', card: 'paris' }, { type: 'bank', card: 'cairo' }, { type: 'bank', card: 'coin-2-1' });
  view = viewFor(game, 1); // the opponent sees the table and the bank
  assert.deepEqual(view.players[0], {
    handSize: 4,
    bank: ['cairo', 'coin-2-1'],
    table: [{ country: 'france', cities: ['paris'], complete: false }],
  });
  assert.equal(view.turn.playsLeft, 0);
  assert.deepEqual(legalActions(game, 0), [{ type: 'endTurn' }]);

  game = act(game, { type: 'endTurn' });
  assert.deepEqual(viewFor(game, 0).phase, { kind: 'draw', player: 1, remaining: 2 });
  assert.deepEqual(
    viewFor(game, 1).log.map((entry) => entry.type),
    ['draw', 'draw', 'lay', 'bank', 'bank', 'endTurn'],
  );
});

test('a turn can be ended without playing, and play passes around the table', () => {
  let game = createGame({ players: 3, countriesToWin: 3 }, 7);
  for (const player of [0, 1, 2, 0]) {
    assert.equal(actor(game), player);
    game = act(drawAll(game), { type: 'endTurn' });
  }
});

test('a player ending their turn with more than 7 cards must discard down to 7', () => {
  let game = createGame({ players: 2, countriesToWin: 3 }, 3);
  // Ending a turn with exactly 7 cards asks for no discard.
  game = act(drawAll(game), { type: 'endTurn' });
  game = act(drawAll(game), { type: 'endTurn' });
  game = act(drawAll(game), { type: 'endTurn' });

  const hand = viewFor(game, 0).hand;
  assert.equal(hand.length, 9);
  assert.deepEqual(viewFor(game, 1).phase, { kind: 'discard', player: 0 });
  assert.deepEqual(
    legalActions(game, 0),
    hand.map((card) => ({ type: 'discard', card })),
  );

  game = act(game, { type: 'discard', card: hand[0]! });
  assert.equal(viewFor(game, 0).phase.kind, 'discard');
  game = act(game, { type: 'discard', card: hand[8]! });

  const view = viewFor(game, 1);
  assert.deepEqual(viewFor(game, 0).hand, hand.slice(1, 8));
  assert.equal(view.discardTop, hand[8]);
  assert.deepEqual(view.phase, { kind: 'draw', player: 1, remaining: 2 });
});

for (const countriesToWin of [3, 5]) {
  test(`the game ends as soon as a player completes ${countriesToWin} countries`, () => {
    // Seat 0 is fed the cities of the smallest countries and lays them all; seat 1 only gets coins and passes.
    const cities: CardId[] = [...COUNTRIES]
      .sort((a, b) => a.cities.length - b.cities.length)
      .slice(0, countriesToWin)
      .flatMap((country) => country.cities);
    // Seat 0 starts with the first 5 cities; each round it draws the next 2, and seat 1 draws 2 coins.
    const spareCoins = [...coins];
    const draws: CardId[] = [];
    for (let i = 5; i < cities.length; i += 2) {
      const mine = cities.slice(i, i + 2);
      draws.push(...mine, ...spareCoins.splice(0, 4 - mine.length));
    }
    const deck = stack([cities.slice(0, 5), []], draws);

    const game = playOut(
      createGame({ players: 2, countriesToWin }, 1, { deck }),
      (legal) => legal.find((a) => a.type === 'lay') ?? legal.find((a) => a.type !== 'bank')!,
      (state) => {
        const view = viewFor(state, 1);
        assert.equal(view.phase.kind === 'over', completeCountries(view, 0) === countriesToWin);
      },
    );

    const view = viewFor(game, 1);
    assert.deepEqual(view.phase, { kind: 'over', winner: 0 });
    assert.deepEqual(view.log.slice(-2), [
      { type: 'lay', player: 0, card: cities.at(-1) },
      { type: 'gameOver', winner: 0 },
    ]);
  });
}

test('the game ends without a winner when no cards are left to play', () => {
  const start = createGame({ players: 2, countriesToWin: 3 }, 1, { deck: coins.slice(0, 10) });
  // The deck is empty from the start: turns skip the draw.
  assert.deepEqual(viewFor(start, 0).phase, { kind: 'play', player: 0 });

  const game = playOut(
    start,
    (legal) => legal[0]!, // bank while possible, then end the turn
    (state) => {
      const view = viewFor(state, 0);
      const cardsInHand = view.players.reduce((sum, player) => sum + player.handSize, 0);
      assert.equal(view.phase.kind === 'over', cardsInHand === 0);
    },
  );
  assert.deepEqual(viewFor(game, 0).phase, { kind: 'over', winner: null });
});

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
  assert.deepEqual(view.players[0]!.table, [
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
  assert.deepEqual(view.players[0]!.table, [
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
  const egypt = () => viewFor(game, 1).players[0]!.table.find((s) => s.country === 'egypt');

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
    ['wild-any-1', 'osaka'],
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
