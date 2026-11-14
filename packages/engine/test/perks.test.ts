// Country perks: each one switching on when its country is completed or seized, and off when it is lost or broken.

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
  type GameState,
  type PerkId,
  type PlayerId,
} from '../src/index.ts';
import { act, actor, drawAll, stack, turn } from './helpers.ts';

const lay = (card: CardId): Action => ({ type: 'lay', card });
const bank = (card: CardId): Action => ({ type: 'bank', card });
const veto = (card: CardId): Action => ({ type: 'play', card });
const endTurn: Action = { type: 'endTurn' };

/** The smallest country with the perk. The scenarios lay it in one turn, with a hand of its cities and two more cards. */
const countryWith = (perk: PerkId) => COUNTRIES.find((country) => country.perk === perk)!;

/** The players a country's perk is active for. */
const activeFor = (game: GameState, country: string): PlayerId[] =>
  viewFor(game, 0).perks.find((entry) => entry.country === country)!.activeFor;

/** The awaited player ends their turn, first banking cards down to the hand limit. */
function finish(game: GameState): GameState {
  const player = actor(game);
  while (viewFor(game, player).hand.length > RULES.handLimit) {
    game = act(game, legalActions(game, player).find((action) => action.type === 'bank')!);
  }
  return act(game, endTurn);
}

test('card data: one perk per country, the three perks spread evenly, all shown in every view from the start', () => {
  const counts = [...Map.groupBy(COUNTRIES, (country) => country.perk)].map(([perk, countries]) => [
    perk,
    countries.length,
  ]);
  assert.deepEqual(counts, [
    ['extraDraw', 4],
    ['extraPlay', 3],
    ['vetoReturn', 3],
  ]);

  const game = createGame({ players: 3, countriesToWin: 3 }, 1);
  const perks = COUNTRIES.map(({ id, perk }) => ({ country: id, perk, activeFor: [] }));
  for (const viewer of [0, 1, 2]) assert.deepEqual(viewFor(game, viewer).perks, perks);
});

test('extra draw: 3 cards at the start of each turn of the player who holds the country complete', () => {
  const country = countryWith('extraDraw');
  const deck = stack([[...country.cities], ['seizure-1']]);
  let game = createGame({ players: 2, countriesToWin: 3 }, 1, { deck });
  const draws = (player: PlayerId, remaining: number) =>
    assert.deepEqual(viewFor(game, 0).phase, { kind: 'draw', player, remaining });

  // Seat 0 completes the country: from their next turn they draw 3 cards, and seat 1 still 2.
  game = turn(game, ...country.cities.map(lay));
  assert.deepEqual(activeFor(game, country.id), [0]);
  draws(1, RULES.drawsPerTurn);
  game = finish(drawAll(game));
  draws(0, RULES.drawsWithPerk);

  // Seat 1 seizes it: the perk goes with the country.
  game = finish(drawAll(game));
  game = act(drawAll(game), { type: 'play', card: 'seizure-1', target: 0, country: country.id });
  assert.deepEqual(activeFor(game, country.id), [1]);
  game = finish(game);
  draws(0, RULES.drawsPerTurn);
  game = finish(drawAll(game));
  draws(1, RULES.drawsWithPerk);
});

test('extra play: a 4th card as soon as the country is complete, and no more as soon as it is broken', () => {
  const country = countryWith('extraPlay');
  const [, ...cities] = country.cities; // with the wild city, all the country needs
  const size = country.cities.length;
  const coins = ['coin-1-1', 'coin-1-2', 'coin-1-3'];
  const deck = stack([[...cities, 'wild-any-1', ...coins].slice(0, RULES.startingHand), ['seizure-1']]);
  let game = drawAll(createGame({ players: 2, countriesToWin: 3 }, 1, { deck }));
  const playsLeft = () => viewFor(game, 0).turn.playsLeft;
  const plays = () => legalActions(game, actor(game)).filter((action) => action.type !== 'reassign');

  // Completing the country raises the plays left at once.
  game = act(game, ...cities.map(lay), { type: 'lay', card: 'wild-any-1', country: country.id });
  assert.equal(playsLeft(), RULES.playsWithPerk - size);

  // With 3 cards played, one more is allowed...
  game = act(game, ...coins.slice(0, RULES.playsPerTurn - size).map(bank));
  assert.equal(playsLeft(), RULES.playsWithPerk - RULES.playsPerTurn);
  // ...but not once the wild city has moved away, which breaks the country...
  const elsewhere = COUNTRIES.find(({ id }) => id !== country.id)!.id;
  game = act(game, { type: 'reassign', card: 'wild-any-1', country: elsewhere });
  assert.deepEqual(activeFor(game, country.id), []);
  assert.equal(playsLeft(), 0);
  assert.deepEqual(plays(), [endTurn]);
  // ...and again when it is moved back. The 4th card is the last.
  game = act(game, { type: 'reassign', card: 'wild-any-1', country: country.id });
  assert.equal(playsLeft(), RULES.playsWithPerk - RULES.playsPerTurn);
  game = act(game, bank(coins[RULES.playsPerTurn - size]!));
  assert.equal(playsLeft(), 0);
  assert.deepEqual(plays(), [endTurn]);

  // Seat 1 seizes the country: the extra play is theirs in the middle of their turn, and no longer seat 0's.
  game = act(drawAll(act(game, endTurn)), { type: 'play', card: 'seizure-1', target: 0, country: country.id });
  assert.deepEqual(viewFor(game, 0).turn, { player: 1, playsLeft: RULES.playsWithPerk - 1 });
  game = act(game, endTurn);
  assert.deepEqual(viewFor(game, 0).turn, { player: 0, playsLeft: RULES.playsPerTurn });
});

test('veto return: the first Veto a player plays in the game goes back to their hand, their next one does not', () => {
  const country = countryWith('vetoReturn');
  const deck = stack([
    [...country.cities, 'veto-1'],
    ['levy-1', 'levy-2'],
  ]);
  let game = createGame({ players: 2, countriesToWin: 3 }, 1, { deck });
  game = turn(game, ...country.cities.map(lay));
  const before = viewFor(game, 0);

  // Seat 0 answers a Levy with their Veto: it cancels the Levy and comes back, for everyone to see.
  game = act(drawAll(game), { type: 'play', card: 'levy-1' }, veto('veto-1'));
  let view = viewFor(game, 0);
  assert.deepEqual(view.phase, { kind: 'play', player: 1 });
  assert.ok(view.hand.includes('veto-1'));
  assert.deepEqual(view.players[0], before.players[0]);
  assert.equal(view.discardTop, 'levy-1');
  assert.deepEqual(view.log.slice(-3), [
    { type: 'play', card: 'levy-1', player: 1 },
    { type: 'play', card: 'veto-1', player: 0 },
    { type: 'return', card: 'veto-1', player: 0 },
  ]);

  // They hold it again, so they are asked again. This time it is spent.
  game = act(game, { type: 'play', card: 'levy-2' }, veto('veto-1'));
  view = viewFor(game, 0);
  assert.ok(!view.hand.includes('veto-1'));
  assert.equal(view.discardTop, 'veto-1');
  assert.deepEqual(view.log.at(-1), { type: 'play', card: 'veto-1', player: 0 });
});

test('veto return: a Veto played once the country is lost is spent', () => {
  const country = countryWith('vetoReturn');
  const deck = stack([
    [...country.cities, 'veto-1'],
    ['seizure-1', 'levy-1'],
  ]);
  let game = createGame({ players: 2, countriesToWin: 3 }, 1, { deck });
  game = turn(game, ...country.cities.map(lay));

  // Seat 0 lets the Seizure through, then answers the Levy.
  game = act(
    drawAll(game),
    { type: 'play', card: 'seizure-1', target: 0, country: country.id },
    { type: 'decline' },
    { type: 'play', card: 'levy-1' },
    veto('veto-1'),
  );
  const view = viewFor(game, 0);
  assert.ok(!view.hand.includes('veto-1'));
  assert.equal(view.discardTop, 'veto-1');
});

test('veto return: only the first Veto of the game, even when it was played before the country was complete', () => {
  const country = countryWith('vetoReturn');
  const cities = country.cities.map(lay);
  const deck = stack([
    [...country.cities, 'veto-1', 'veto-2'],
    ['levy-1', 'levy-2'],
  ]);
  let game = createGame({ players: 2, countriesToWin: 3 }, 1, { deck });

  // Seat 0's first Veto is played one city short of the country: it is spent.
  game = turn(game, ...cities.slice(1));
  game = act(drawAll(game), { type: 'play', card: 'levy-1' }, veto('veto-1'), endTurn);
  assert.equal(viewFor(game, 0).discardTop, 'veto-1');

  // The country is now complete, but their second Veto is not their first.
  game = turn(game, cities[0]!);
  assert.deepEqual(activeFor(game, country.id), [0]);
  game = act(drawAll(game), { type: 'play', card: 'levy-2' }, veto('veto-2'));
  const view = viewFor(game, 0);
  assert.ok(!view.hand.includes('veto-2'));
  assert.equal(view.discardTop, 'veto-2');
});
