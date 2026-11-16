import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, COUNTRIES, createGame, legalActions, type GameState, type LogEntry } from '../src/index.ts';
import { drawAll } from './helpers.ts';

/** Prepare the preceding seat's play phase, without playing earlier turns. */
function beforeTurn(players: number, seat: number): GameState {
  const game = createGame({ players, countriesToWin: 5 }, 1);
  const previous = (seat + players - 1) % players;
  game.turn = { player: previous, played: 0 };
  game.phase = { kind: 'play', player: previous };
  return game;
}

function enter(game: GameState): GameState {
  return applyAction(game, game.turn.player, { type: 'endTurn' });
}

test('first-turn draws equal the seat for every supported player count; later turns draw two', () => {
  for (const players of [2, 3, 4, 5]) {
    const initial = createGame({ players, countriesToWin: 5 }, 1);
    assert.deepEqual(initial.phase, { kind: 'play', player: 0 });
    assert.ok(legalActions(initial, 0).some((action) => action.type === 'bank'));
    assert.ok(!legalActions(initial, 0).some((action) => action.type === 'draw'));
    for (let seat = 0; seat < players; seat++) {
      const game = beforeTurn(players, seat);
      const first = enter(game);
      assert.deepEqual(first.phase, seat === 0
        ? { kind: 'play', player: seat }
        : { kind: 'draw', player: seat, remaining: seat });
      const drawn = drawAll(first);
      assert.equal(drawn.players[seat]!.hand.length, 5 + seat);
      if (seat >= 3) {
        let ended = applyAction(drawn, seat, { type: 'endTurn' });
        assert.deepEqual(ended.phase, { kind: 'discard', player: seat });
        while (ended.players[seat]!.hand.length > 7) {
          ended = applyAction(ended, seat, { type: 'discard', card: ended.players[seat]!.hand[0]! });
        }
        assert.notEqual(ended.turn.player, seat);
        assert.equal(ended.players[seat]!.hand.length, 7);
      }
      game.log.push({ type: 'endTurn', player: seat });
      assert.deepEqual(enter(game).phase, { kind: 'draw', player: seat, remaining: 2 });
    }
  }
});

test('pre-turn Veto, decline and payment responses do not count as an own completed turn', () => {
  const responses: LogEntry[] = [
    { type: 'play', player: 4, card: 'veto-1' },
    { type: 'decline', player: 4 },
    { type: 'pay', player: 4, card: 'coin-1-1' },
  ];
  for (const response of responses) {
    const game = beforeTurn(5, 4);
    game.log.push({ type: 'endTurn', player: 1 }, response);
    assert.deepEqual(enter(game).phase, { kind: 'draw', player: 4, remaining: 4 });
  }
});

test('empty hand overrides first-turn compensation and extra draw; compensation overrides the perk', () => {
  const country = COUNTRIES.find((country) => country.perk === 'extraDraw')!;
  for (const seat of [0, 1, 4]) {
    for (const completed of [false, true]) {
      for (const empty of [false, true]) {
        const game = beforeTurn(5, seat);
        // Move the country's cards out of their original zones into this seat's table.
        const cities = new Set<string>(country.cities);
        game.deck = game.deck.filter((card) => !cities.has(card));
        game.market = game.market.filter((card) => !cities.has(card));
        for (const player of game.players) player.hand = player.hand.filter((card) => !cities.has(card));
        game.players[seat]!.table = [{ country: country.id, cities: [...cities], upgrades: [] }];
        if (empty) {
          game.discard.push(...game.players[seat]!.hand);
          game.players[seat]!.hand = [];
        }
        if (completed) game.log.push({ type: 'endTurn', player: seat });
        const remaining = empty ? 4 : completed ? 3 : seat;
        assert.deepEqual(enter(game).phase, remaining === 0
          ? { kind: 'play', player: seat }
          : { kind: 'draw', player: seat, remaining });
      }
    }
  }
});

test('first-turn draws are capped by availability and still allow Market choice', () => {
  const game = beforeTurn(5, 4);
  game.deck = [];
  game.discard = [];
  game.market = game.market.slice(0, 1);
  const first = enter(game);
  assert.deepEqual(first.phase, { kind: 'draw', player: 4, remaining: 1 });
  const card = game.market[0]!;
  assert.deepEqual(legalActions(first, 4), [{ type: 'drawMarket', card }]);
  const drawn = applyAction(first, 4, { type: 'drawMarket', card });
  assert.deepEqual(drawn.phase, { kind: 'play', player: 4 });
  assert.equal(drawn.players[4]!.hand.at(-1), card);
  game.market = [];
  assert.deepEqual(enter(game).phase, { kind: 'play', player: 4 });
});
