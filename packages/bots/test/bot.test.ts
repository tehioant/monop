import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyAction,
  CARDS,
  createGame,
  legalActions,
  RULES,
  viewFor,
  type Action,
  type CardId,
  type GameState,
  type LogEntry,
} from '@atlas/engine';
import { createBot, DIFFICULTIES, type Difficulty } from '../src/index.ts';

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);

/**
 * Plays a game to its end, seat `i` by a bot of level `levels[i]`, checking every choice: it is legal, and a
 * wild city just moved is not moved again.
 */
function playGame(
  levels: Difficulty[],
  countriesToWin: number,
  seed: number,
  cards?: CardId[],
): { winner: number | null; log: LogEntry[] } {
  const bots = levels.map((level) => createBot(level, seed));
  let state = createGame({ players: levels.length, countriesToWin }, seed, { deck: cards });
  let moved: CardId | undefined;
  for (let step = 0; step < 2000; step++) {
    const { phase, log } = viewFor(state, 0);
    if (phase.kind === 'over') return { winner: phase.winner, log };
    const legal = legalActions(state, phase.player);
    const action = bots[phase.player]!(viewFor(state, phase.player), legal);
    assert.ok(legal.includes(action), `not a legal action: ${JSON.stringify(action)}`);
    if (action.type === 'reassign') assert.notEqual(action.card, moved, `${action.card} moved twice in a row`);
    moved = action.type === 'reassign' ? action.card : undefined;
    state = applyAction(state, phase.player, action);
  }
  throw new Error('The game did not end');
}

/** A deck that deals each seat the given cards, filled up with coins; the Market and the first draws are coins too. */
function deck(...hands: CardId[][]): CardId[] {
  const spare = CARDS.map((card) => card.id).filter((id) => !hands.flat().includes(id));
  const coins = spare.filter((id) => id.startsWith('coin'));
  const dealt = hands.flatMap((hand) => [...hand, ...coins.splice(0, RULES.startingHand - hand.length)]);
  return [...dealt, ...coins, ...spare.filter((id) => !id.startsWith('coin'))];
}

/** The player the game is waiting on. */
function actor(state: GameState): number {
  const { phase } = viewFor(state, 0);
  if (phase.kind === 'over') throw new Error('The game is over');
  return phase.player;
}

/** Applies actions in sequence, each as the player the game is waiting on. */
function act(state: GameState, ...actions: Action[]): GameState {
  return actions.reduce((s, action) => applyAction(s, actor(s), action), state);
}

/** What a bot of that level, made with each of the seeds, chooses for the player the game is waiting on. */
function choices(state: GameState, level: Difficulty, among = (_: Action) => true): Action[] {
  const view = viewFor(state, actor(state));
  const legal = legalActions(state, view.viewer).filter(among);
  return SEEDS.map((seed) => createBot(level, seed)(view, legal));
}

const all = (action: Action) => SEEDS.map(() => action);
const DRAW: Action = { type: 'draw' };
const END: Action = { type: 'endTurn' };

test('the difficulty levels are listed, easiest first, and each gives a bot', () => {
  assert.deepEqual(DIFFICULTIES, ['easy', 'normal', 'hard']);
  for (const difficulty of DIFFICULTIES) assert.equal(typeof createBot(difficulty, 1), 'function');
  assert.throws(() => createBot('grandmaster' as never, 1), RangeError);
});

test('at every level a bot returns one of the legal actions, in every phase, until the game is over', () => {
  for (const level of DIFFICULTIES) {
    const seen = new Set<string>();
    // As many seeds as it takes for every kind of choice to come up with the current card data.
    for (let seed = 1; seed <= 8; seed++) {
      const { log } = playGame(Array.from({ length: 2 + (seed % 4) }, () => level), seed % 2 ? 3 : 5, seed);
      for (const entry of log) seen.add(entry.type);
    }
    // Draw source, plays, payment, veto responses, wild city moves and discard all came up.
    for (const type of ['draw', 'drawMarket', 'lay', 'bank', 'play', 'pay', 'decline', 'reassign', 'discard']) {
      assert.ok(seen.has(type), `${level}: no ${type}`);
    }
  }
});

test('a bot is deterministic for a given seed', () => {
  const levels = [...DIFFICULTIES];
  assert.deepEqual(playGame(levels, 3, 7), playGame(levels, 3, 7));
  assert.notDeepEqual(playGame(levels, 3, 7).log, playGame(levels, 3, 8).log);
});

test('over a fixed set of seeds, hard wins more often than normal, and normal more often than easy', () => {
  const wins = { easy: 0, normal: 0, hard: 0 };
  // Three-player games with one bot of each level; every deal is played with each level in each seat.
  for (const seed of SEEDS) {
    for (let shift = 0; shift < 3; shift++) {
      const levels = DIFFICULTIES.map((_, seat) => DIFFICULTIES[(seat + shift) % 3]!);
      const { winner } = playGame(levels, 5, seed);
      if (winner !== null) wins[levels[winner]!]++;
    }
  }
  assert.ok(wins.hard > wins.normal && wins.normal > wins.easy, JSON.stringify(wins));
});

test('a bot moves a wild city only where it completes more; an easy bot is sometimes careless, a hard one never', () => {
  let state = createGame({ players: 2, countriesToWin: 3 }, 1, { deck: deck(['wild-any-1', 'cairo']) });
  const coin = viewFor(state, 0).hand.find((card) => card.startsWith('coin'))!;
  state = act(
    state,
    DRAW,
    DRAW,
    { type: 'lay', card: 'wild-any-1', country: 'france' },
    { type: 'lay', card: 'cairo' },
    { type: 'bank', card: coin },
  );
  // No play left: the wild city can move to any country, or the turn can end.
  const toEgypt: Action = { type: 'reassign', card: 'wild-any-1', country: 'egypt' };
  assert.deepEqual(choices(state, 'hard'), all(toEgypt));
  const easy = choices(state, 'easy');
  const careless = easy.filter((action) => action.type === 'endTurn').length;
  assert.ok(0 < careless && careless < SEEDS.length / 2, `${careless} careless choices`);
  assert.deepEqual(easy.filter((action) => action.type !== 'endTurn'), all(toEgypt).slice(careless));

  // Egypt is complete: moving the wild city again would gain nothing.
  assert.deepEqual(choices(act(state, toEgypt), 'hard'), all(END));
});

test('a hard bot looks after its bank, keeps its Veto for a Seizure and pays in coin', () => {
  let state = createGame(
    { players: 2, countriesToWin: 3 },
    1,
    { deck: deck(['levy-1', 'seizure-1'], ['cairo', 'alexandria', 'veto-1', 'coin-2-1', 'coin-5-1']) },
  );
  state = act(state, DRAW, DRAW, END, DRAW, DRAW);
  // With nothing banked, coin comes before cities for a hard bot. A normal bot lays first.
  assert.deepEqual(choices(state, 'hard'), all({ type: 'bank', card: 'coin-5-1' }));
  assert.ok(choices(state, 'normal').filter((action) => action.type === 'lay').length > SEEDS.length / 2);
  state = act(
    state,
    { type: 'lay', card: 'cairo' },
    { type: 'lay', card: 'alexandria' },
    { type: 'bank', card: 'coin-2-1' },
    END,
    DRAW,
    DRAW,
    { type: 'play', card: 'levy-1' },
  );

  // A Levy is not worth the Veto. An easy bot spends it on whatever comes first.
  assert.deepEqual(choices(state, 'hard'), all({ type: 'decline' }));
  assert.ok(choices(state, 'easy').filter((action) => action.type === 'play').length > SEEDS.length / 2);
  state = act(state, { type: 'decline' });
  // The Levy can be paid with the coin or with a city of the complete country.
  assert.deepEqual(choices(state, 'hard'), all({ type: 'pay', card: 'coin-2-1' }));
  state = act(state, { type: 'pay', card: 'coin-2-1' }, { type: 'play', card: 'seizure-1', target: 1, country: 'egypt' });
  assert.deepEqual(choices(state, 'hard'), all({ type: 'play', card: 'veto-1' }));
});

test('a hard bot aims at the leader; a normal bot does not tell two opponents who can pay apart', () => {
  let state = createGame(
    { players: 3, countriesToWin: 3 },
    1,
    { deck: deck(['debt-1'], ['coin-5-1'], ['cairo', 'alexandria', 'coin-5-2']) },
  );
  state = act(state, DRAW, DRAW, END, DRAW, DRAW, { type: 'bank', card: 'coin-5-1' }, END);
  // Seat 2 completes a country; both opponents of seat 0 can pay a Debt in full.
  state = act(state, DRAW, DRAW, { type: 'lay', card: 'cairo' }, { type: 'lay', card: 'alexandria' });
  state = act(state, { type: 'bank', card: 'coin-5-2' }, END, DRAW, DRAW);
  const debt = (action: Action) => action.type === 'play' && action.card === 'debt-1';
  assert.deepEqual(choices(state, 'hard', debt), all({ type: 'play', card: 'debt-1', target: 2 }));
  const targets = new Set(choices(state, 'normal', debt).map((action) => action.type === 'play' && action.target));
  assert.deepEqual(targets, new Set([1, 2]));
});

test('with no card left to draw, bots play out the cards they would otherwise keep, and the game ends', () => {
  const cards = ['veto-1', 'veto-2', 'seizure-1', 'raid-1', 'wild-any-1', 'veto-3', 'seizure-2', 'raid-2', 'toll-1', 'paris'];
  for (const level of DIFFICULTIES) assert.equal(playGame([level, level], 3, 1, cards).winner, null);
});

test('a bot chooses among actions it does not know, and fails when asked out of turn', () => {
  const state = createGame({ players: 2, countriesToWin: 3 }, 1);
  const unknown = [{ type: 'someLaterRule', target: 1 }, { type: 'another' }] as unknown as Action[];
  const chosen = SEEDS.map((seed) => createBot('hard', seed)(viewFor(state, 0), unknown));
  assert.deepEqual(new Set(chosen), new Set(unknown));
  assert.throws(() => createBot('hard', 1)(viewFor(state, 1), legalActions(state, 1)));
});
