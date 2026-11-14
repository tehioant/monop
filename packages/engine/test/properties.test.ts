// Invariants over random legal play, observed through views and legal actions only.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import fc from 'fast-check';
import {
  applyAction,
  createGame,
  IllegalActionError,
  legalActions,
  RULES,
  viewFor,
  type Action,
  type CardId,
  type GameOptions,
  type GameState,
} from '../src/index.ts';
import { act, ALL_CARDS, completeCountries, playOut } from './helpers.ts';

// A fixed seed: every run plays the same games, so a failure is reproducible.
const RUNS = { seed: 1, numRuns: 40 };

const gameConfig = fc.record({
  players: fc.constantFrom(...RULES.playerCounts),
  countriesToWin: fc.constantFrom(...RULES.countriesToWin),
  seed: fc.integer(),
});
type GameConfig = GameOptions & { seed: number };

/**
 * Plays one game of random legal actions to its end. `visit` sees every state reached.
 * States are frozen, so an `applyAction` that mutated its input would throw.
 */
function randomGame(config: GameConfig, g: fc.GeneratorValue, visit: (state: GameState) => void = () => {}) {
  const { seed, ...options } = config;
  const actions: Action[] = [];
  const end = playOut(
    createGame(options, seed),
    (legal) => {
      const action = legal[g(fc.nat, legal.length - 1)]!; // an index is much cheaper to generate than constantFrom
      actions.push(action);
      return action;
    },
    (state) => visit(deepFreeze(state)),
  );
  return { options, seed, actions, end };
}

function forAllGames(run: (config: GameConfig, g: fc.GeneratorValue) => void): void {
  fc.assert(fc.property(gameConfig, fc.gen(), run), RUNS);
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

/** Where every card is, as far as the views tell: the deck is whatever is in none of these zones. */
function zones(state: GameState) {
  const view = viewFor(state, 0);
  // The discard pile is what was discarded since the last reshuffle.
  let discarded: CardId[] = [];
  for (const entry of view.log) {
    if (entry.type === 'reshuffle') discarded = [];
    else if (entry.type === 'discard' || entry.type === 'play') discarded.push(entry.card);
  }
  return {
    view,
    hands: view.players.map((_, player) => viewFor(state, player).hand),
    tables: view.players.flatMap((p) => [...p.bank, ...p.table.flatMap((stack) => stack.cities)]),
    discarded,
  };
}

const cardIds = new Set(ALL_CARDS);

/** Every card id found anywhere inside `value`. */
function cardsIn(value: unknown): CardId[] {
  if (typeof value === 'string') return cardIds.has(value) ? [value] : [];
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(cardsIn);
  return [];
}

test('every card is in exactly one zone', () => {
  forAllGames((config, g) => {
    randomGame(config, g, (state) => {
      const { view, hands, tables, discarded } = zones(state);
      const visible = [...hands.flat(), ...tables, ...view.market, ...discarded];
      assert.equal(new Set(visible).size, visible.length, 'a card is in two zones');
      assert.ok(visible.every((card) => cardIds.has(card)));
      assert.equal(visible.length + view.deckSize, ALL_CARDS.length, 'a card was lost or created');
      assert.deepEqual(
        view.players.map((p) => p.handSize),
        hands.map((hand) => hand.length),
      );
      assert.equal(view.discardTop, discarded.at(-1) ?? null);
    });
  });
});

test('every listed legal action applies, and only the awaited player has any', () => {
  forAllGames((config, g) => {
    randomGame(config, g, (state) => {
      const { phase } = viewFor(state, 0);
      for (let player = 0; player < config.players; player++) {
        const legal = legalActions(state, player);
        assert.equal(legal.length > 0, phase.kind !== 'over' && phase.player === player);
        for (const action of legal) applyAction(state, player, action);
      }
    });
  });
});

test('actions that are not listed are rejected', () => {
  const anyAction = fc.oneof(
    fc.constantFrom<Action>({ type: 'draw' }, { type: 'endTurn' }),
    fc.record(
      {
        type: fc.constantFrom('drawMarket', 'lay', 'play', 'pay', 'bank', 'discard'),
        card: fc.constantFrom(...ALL_CARDS),
        target: fc.nat(5),
      },
      { noNullPrototype: true, requiredKeys: ['type', 'card'] },
    ),
    fc.constantFrom<unknown>({ type: 'bank' }, { type: 'draw', card: 'paris' }, { type: 'seize' }, 'draw', null),
  ) as fc.Arbitrary<Action>;

  forAllGames((config, g) => {
    randomGame(config, g, (state) => {
      for (let i = 0; i < 3; i++) {
        const player = g(fc.integer, { min: -1, max: config.players });
        const action = g(() => anyAction);
        const listed = legalActions(state, player).some((legal) => isDeepStrictEqual(legal, action));
        if (!listed) assert.throws(() => applyAction(state, player, action), IllegalActionError);
      }
    });
  });
});

test('games terminate: won exactly when someone completes enough countries, else when the cards run out', () => {
  forAllGames((config, g) => {
    const { end } = randomGame(config, g, (state) => {
      const view = viewFor(state, 0);
      const leaders = view.players.flatMap((_, player) =>
        completeCountries(view, player) >= config.countriesToWin ? [player] : [],
      );
      assert.deepEqual(leaders, view.phase.kind === 'over' && view.phase.winner !== null ? [view.phase.winner] : []);
    });
    // Without a winner, the game only ends when nobody has a card left to draw or play.
    const view = viewFor(end, 0);
    if (view.phase.kind === 'over' && view.phase.winner === null) {
      assert.equal(view.deckSize, 0);
      assert.equal(view.discardTop, null);
      assert.deepEqual(view.market, []);
      assert.ok(view.players.every((p) => p.handSize === 0));
    }
  });
});

test('a view never shows a card from another hand or from the deck', () => {
  forAllGames((config, g) => {
    let logged = 0;
    let marketBefore: CardId[] = [];
    randomGame(config, g, (state) => {
      const { view, hands, tables, discarded } = zones(state);
      for (let viewer = 0; viewer < config.players; viewer++) {
        const known = new Set([...hands[viewer]!, ...tables, ...view.market, ...discarded]);
        const { log, ...table } = viewFor(state, viewer);
        assert.deepEqual(
          cardsIn(table).filter((card) => !known.has(card)),
          [],
        );
        // Log entries are checked when they appear: what they name was public at that time (a card taken
        // from the Market) or is public now.
        assert.deepEqual(
          cardsIn(log.slice(logged)).filter((card) => !known.has(card) && !marketBefore.includes(card)),
          [],
        );
      }
      logged = view.log.length;
      marketBefore = view.market;
    });
  });
});

test('the same seed and actions give the same game', () => {
  forAllGames((config, g) => {
    const { options, seed, actions, end } = randomGame(config, g);
    assert.deepEqual(act(createGame(options, seed), ...actions), end);
  });
});
