// Toll: every opponent pays for a country the player holds cities in.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COUNTRIES, createGame, legalActions, viewFor, type Action, type PlayerId } from '../src/index.ts';
import { act, drawAll, stack, turn } from './helpers.ts';

const bank = (card: string): Action => ({ type: 'bank', card });
const lay = (card: string): Action => ({ type: 'lay', card });
const layAs = (card: string, country: string): Action => ({ type: 'lay', card, country });
const pay = (card: string): Action => ({ type: 'pay', card });
const toll = (country: string, card = 'toll-1'): Action => ({ type: 'play', card, country });

/** The amount on a country's toll scale for holding `held` of its cities. */
const scaleOf = (country: string, held: number) => COUNTRIES.find((c) => c.id === country)!.toll[held - 1];

/** The phase in which `player` is asked to pay `amount` to `receiver`, the players in `queue` being charged next. */
const owes = (player: PlayerId, receiver: PlayerId, amount: number | undefined, queue: PlayerId[] = []) => ({
  kind: 'pay',
  player,
  receiver,
  owed: amount,
  amount,
  queue,
});

test('card data: every country has a rising toll scale with one amount per city', () => {
  for (const { id, cities, toll: scale } of COUNTRIES) {
    assert.equal(scale.length, cities.length, id);
    assert.ok(
      scale.every((amount, i) => Number.isInteger(amount) && amount > (scale[i - 1] ?? 0)),
      id,
    );
  }
});

test('a Toll can only be played on a country the player has laid a city in', () => {
  const deck = stack([['toll-1', 'paris', 'cairo', 'london'], []]);
  let game = drawAll(createGame({ players: 2, countriesToWin: 3 }, 1, { deck }));
  const plays = () => legalActions(game, 0).filter((a) => a.type === 'play');

  // With no city laid there is no country to choose: the card can only be banked.
  assert.deepEqual(plays(), []);
  assert.ok(legalActions(game, 0).some((a) => a.type === 'bank' && a.card === 'toll-1'));

  // One action per country held; a city still in hand (London) does not count.
  game = act(game, lay('paris'), lay('cairo'));
  assert.deepEqual(plays(), [toll('france'), toll('egypt')]);
});

test("a Toll charges the amount on the country's toll scale for the player's progress in it", () => {
  for (const country of COUNTRIES) {
    // Every level of progress, the last one being the complete country.
    for (let held = 1; held <= country.cities.length; held++) {
      const cities = country.cities.slice(0, held);
      const deck = stack([
        ['toll-1', ...cities],
        ['coin-10-1', 'coin-5-1', 'coin-5-2'],
      ]);
      let game = createGame({ players: 2, countriesToWin: 3 }, 1, { deck });
      game = turn(game, ...cities.slice(0, 3).map(lay));
      // The opponent banks more than any toll, so that they are asked what to pay with.
      game = turn(game, bank('coin-10-1'), bank('coin-5-1'), bank('coin-5-2'));
      game = act(drawAll(game), ...cities.slice(3).map(lay), toll(country.id));

      const view = viewFor(game, 1);
      assert.equal(view.players[0]!.table[0]!.complete, held === country.cities.length);
      assert.deepEqual(view.phase, owes(1, 0, country.toll[held - 1]), `${held} of ${country.id}`);
    }
  }
});

test('wild cities count toward the toll of the country they are laid in; the top of the scale needs it complete', () => {
  const deck = stack(
    [
      ['toll-1', 'toll-2', 'wild-egypt-italy', 'wild-any-1', 'wild-any-2'],
      ['coin-10-1', 'coin-5-1', 'coin-5-2'],
    ],
    ['rome'],
  );
  let game = createGame({ players: 2, countriesToWin: 3 }, 1, { deck });
  game = turn(game, layAs('wild-egypt-italy', 'italy'), layAs('wild-any-1', 'italy'), layAs('wild-any-2', 'italy'));
  game = drawAll(turn(game, bank('coin-10-1'), bank('coin-5-1'), bank('coin-5-2')));

  // Italy needs three cities and has three, but all wild: it is not complete, so one step short of the top.
  game = act(game, toll('italy'));
  assert.deepEqual(viewFor(game, 0).phase, owes(1, 0, scaleOf('italy', 2)));

  // A city of its own completes it; the cities beyond its size add nothing.
  game = act(game, pay('coin-10-1'), lay('rome'), toll('italy', 'toll-2'));
  assert.deepEqual(viewFor(game, 0).phase, owes(1, 0, scaleOf('italy', 3)));
});

test('a Toll makes every opponent pay through the payment phase, in turn order starting after the player', () => {
  const deck = stack([
    ['coin-5-1', 'coin-5-2'],
    ['toll-1', 'paris', 'lyon'],
    ['coin-10-1', 'coin-1-1'],
  ]);
  let game = createGame({ players: 3, countriesToWin: 3 }, 1, { deck });
  game = turn(game, bank('coin-5-1'), bank('coin-5-2'));
  game = turn(game, lay('paris'), lay('lyon'));
  game = turn(game, bank('coin-10-1'), bank('coin-1-1'));
  game = drawAll(turn(game));
  const amount = scaleOf('france', 2);

  // Seat 1 plays the Toll: seat 2 is asked first, then seat 0.
  game = act(game, toll('france'));
  assert.deepEqual(viewFor(game, 0).phase, owes(2, 1, amount, [0]));
  game = act(game, pay('coin-10-1'));
  assert.deepEqual(viewFor(game, 0).phase, owes(0, 1, amount));
  game = act(game, pay('coin-5-1'));

  // The turn resumes with one play spent and the Toll on the discard pile.
  const view = viewFor(game, 0);
  assert.deepEqual(view.phase, { kind: 'play', player: 1 });
  assert.equal(view.turn.playsLeft, 2);
  assert.equal(view.discardTop, 'toll-1');
  assert.deepEqual(
    view.players.map((p) => p.bank),
    [['coin-5-2'], ['coin-10-1', 'coin-5-1'], ['coin-1-1']],
  );
  assert.deepEqual(view.log.slice(-3), [
    { type: 'play', card: 'toll-1', country: 'france', player: 1 },
    { type: 'pay', card: 'coin-10-1', player: 2 },
    { type: 'pay', card: 'coin-5-1', player: 0 },
  ]);
});
