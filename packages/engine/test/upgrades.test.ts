// Upgrades: attached to a complete country to raise its toll, seized with it, lost to the bank when it breaks.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COUNTRIES, createGame, legalActions, RULES, viewFor, type Action, type GameState } from '../src/index.ts';
import { act, actor, drawAll, stack, turn } from './helpers.ts';

const lay = (card: string): Action => ({ type: 'lay', card });
const layAs = (card: string, country: string): Action => ({ type: 'lay', card, country });
const move = (card: string, country: string): Action => ({ type: 'reassign', card, country });
const pay = (card: string): Action => ({ type: 'pay', card });
const upgrade = (country: string, card = 'upgrade-1'): Action => ({ type: 'play', card, country });

/** Egypt's toll scale: one city, then the complete country. */
const [oneCity, complete] = COUNTRIES.find((country) => country.id === 'egypt')!.toll;

/** Egypt as the view shows it, with the given cities and upgrades. */
const egypt = (cities: string[], upgrades: string[], toll: number) => ({
  country: 'egypt',
  cities,
  upgrades,
  complete: cities.length > 1,
  toll,
});

/** The ways the awaited player can play `card` for its effect. */
function plays(game: GameState, card: string): Action[] {
  return legalActions(game, actor(game)).filter((action) => action.type === 'play' && action.card === card);
}

/** Seat 0 has laid Egypt and upgraded it; seat 1 is about to play, with `hand`. */
function upgradedEgypt(...hand: string[]): GameState {
  const deck = stack([['cairo', 'alexandria', 'upgrade-1'], hand]);
  const game = createGame({ players: 2, countriesToWin: 3 }, 1, { deck });
  return drawAll(turn(game, lay('cairo'), lay('alexandria'), upgrade('egypt')));
}

test('an upgrade is attached to a complete country of the player, and raises its toll by the amount in card data', () => {
  const deck = stack([
    ['cairo', 'alexandria', 'upgrade-1', 'upgrade-2', 'toll-1'],
    ['sydney', 'melbourne', 'coin-10-1'],
  ]);
  let game = act(drawAll(createGame({ players: 2, countriesToWin: 3 }, 1, { deck })), lay('cairo'));

  // Egypt is one city short: there is no country to upgrade.
  assert.deepEqual(plays(game, 'upgrade-1'), []);

  game = act(game, lay('alexandria'), { type: 'endTurn' });
  game = drawAll(turn(game, lay('sydney'), lay('melbourne'), { type: 'bank', card: 'coin-10-1' }));
  // Australia is complete as well, but it is the opponent's.
  assert.deepEqual(plays(game, 'upgrade-1'), [upgrade('egypt')]);

  // The upgrade costs a play and stays on the country instead of going to the discard pile.
  game = act(game, upgrade('egypt'));
  const view = viewFor(game, 1);
  assert.deepEqual(view.players[0]!.table, [
    egypt(['cairo', 'alexandria'], ['upgrade-1'], complete + RULES.upgradeToll),
  ]);
  assert.equal(view.turn.playsLeft, 2);
  assert.equal(view.discardTop, null);

  // A second upgrade adds as much again, and a Toll charges the raised amount.
  game = act(game, upgrade('egypt', 'upgrade-2'), { type: 'play', card: 'toll-1', country: 'egypt' });
  const amount = complete + 2 * RULES.upgradeToll;
  assert.deepEqual(viewFor(game, 0).phase, { kind: 'pay', player: 1, receiver: 0, owed: amount, amount, queue: [] });
});

test('a Seizure takes the upgrades along with the country', () => {
  const seize: Action = { type: 'play', card: 'seizure-1', target: 0, country: 'egypt' };
  let view = viewFor(act(upgradedEgypt('seizure-1'), seize), 0);
  assert.deepEqual(view.players[0], { handSize: 2, bank: [], table: [] });
  assert.deepEqual(view.players[1]!.table, [
    egypt(['cairo', 'alexandria'], ['upgrade-1'], complete + RULES.upgradeToll),
  ]);

  // Also when the country joins a city the taker already has in it.
  const game = upgradedEgypt('seizure-1', 'wild-egypt-italy');
  view = viewFor(act(game, layAs('wild-egypt-italy', 'egypt'), seize), 0);
  assert.deepEqual(view.players[1]!.table, [
    egypt(['wild-egypt-italy', 'cairo', 'alexandria'], ['upgrade-1'], complete + RULES.upgradeToll),
  ]);
});

test("when a city of an upgraded country is paid away, its upgrades move to the owner's bank as coin", () => {
  // Egypt's cities alone would not cover a Levy; with the upgrade, the table is worth more: the owner chooses.
  let game = act(upgradedEgypt('levy-1'), { type: 'play', card: 'levy-1' });
  assert.deepEqual(legalActions(game, 0), [pay('cairo'), pay('alexandria')]);

  // Paying a city breaks the country: the upgrade is now coin in the bank, and can pay the rest.
  game = act(game, pay('cairo'));
  assert.deepEqual(viewFor(game, 1).players[0], {
    handSize: 2,
    bank: ['upgrade-1'],
    table: [egypt(['alexandria'], [], oneCity)],
  });
  assert.deepEqual(legalActions(game, 0), [pay('upgrade-1'), pay('alexandria')]);
});

test('a player who cannot cover the amount pays their upgrades too, as coin', () => {
  // A Debt is worth all of seat 0's table: two cities and the upgrade.
  const view = viewFor(act(upgradedEgypt('debt-1'), { type: 'play', card: 'debt-1', target: 0 }), 0);
  assert.deepEqual(view.phase, { kind: 'play', player: 1 });
  assert.deepEqual(view.players[0], { handSize: 2, bank: [], table: [] });
  // The receiver gets Egypt without its upgrade, which is in their bank.
  assert.deepEqual(view.players[1]!.bank, ['upgrade-1']);
  assert.deepEqual(view.players[1]!.table, [egypt(['cairo', 'alexandria'], [], complete)]);
  assert.deepEqual(
    view.log.slice(-3).map((entry) => 'card' in entry && entry.card),
    ['cairo', 'alexandria', 'upgrade-1'],
  );
});

test("when a wild city is moved out of an upgraded country, its upgrades move to the owner's bank", () => {
  const deck = stack([['cairo', 'wild-egypt-italy', 'wild-any-1', 'upgrade-1'], []]);
  let game = createGame({ players: 2, countriesToWin: 3 }, 1, { deck });
  game = turn(game, lay('cairo'), layAs('wild-egypt-italy', 'egypt'), layAs('wild-any-1', 'egypt'));
  game = act(drawAll(turn(game)), upgrade('egypt'));
  const seat0 = () => viewFor(game, 1).players[0]!;

  // Egypt has a city to spare: without it the country is still complete and keeps its upgrade.
  game = act(game, move('wild-any-1', 'france'));
  assert.deepEqual(seat0().table[0], egypt(['cairo', 'wild-egypt-italy'], ['upgrade-1'], complete + RULES.upgradeToll));

  game = act(game, move('wild-egypt-italy', 'italy'));
  assert.deepEqual(seat0().table[0], egypt(['cairo'], [], oneCity));
  assert.deepEqual(seat0().bank, ['upgrade-1']);
});
