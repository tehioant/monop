// Shared test helpers. Tests drive the engine through its public interface only.

import {
  applyAction,
  CARDS,
  legalActions,
  RULES,
  viewFor,
  type Action,
  type CardId,
  type GameState,
  type PlayerId,
  type PlayerView,
} from '../src/index.ts';

export const ALL_CARDS: readonly CardId[] = CARDS.map((card) => card.id);

/** The player the game is waiting on. */
export function actor(state: GameState): PlayerId {
  const { phase } = viewFor(state, 0);
  if (phase.kind === 'over') throw new Error('The game is over');
  return phase.player;
}

/** Applies actions in sequence, each as the player the game is waiting on. */
export function act(state: GameState, ...actions: Action[]): GameState {
  return actions.reduce((s, action) => applyAction(s, actor(s), action), state);
}

/** Draws until the draw phase ends: from the deck while it has cards, else from the Market. */
export function drawAll(state: GameState): GameState {
  while (viewFor(state, 0).phase.kind === 'draw') state = act(state, legalActions(state, actor(state))[0]!);
  return state;
}

export function completeCountries(view: PlayerView, player: PlayerId): number {
  return view.players[player]!.table.filter((stack) => stack.complete).length;
}

/**
 * Plays until the game is over, asking `choose` for each action of the player the game is waiting on.
 * `visit` sees every state reached, the first and the last included. Fails if the game runs too long.
 */
export function playOut(
  state: GameState,
  choose: (legal: Action[]) => Action,
  visit: (state: GameState) => void = () => {},
): GameState {
  for (let step = 0; step < 1000; step++) {
    visit(state);
    if (viewFor(state, 0).phase.kind === 'over') return state;
    state = act(state, choose(legalActions(state, actor(state))));
  }
  throw new Error('The game did not end within 1000 actions');
}

/**
 * A deck order for `createGame`'s setup. `hands` has one entry per seat: the cards that seat starts with
 * (padded to a full hand). `market` is the starting Market (padded too). Then `draws` are drawn from the deck
 * in order, then the rest of the deck. Padding prefers coins.
 */
export function stack(hands: CardId[][], draws: CardId[] = [], market: CardId[] = []): CardId[] {
  const named = new Set([...hands.flat(), ...draws, ...market]);
  const spare = ALL_CARDS.filter((card) => !named.has(card)).reverse();
  const dealt = hands.flatMap((hand) => [...hand, ...spare.splice(0, RULES.startingHand - hand.length)]);
  return [...dealt, ...market, ...spare.splice(0, RULES.marketSize - market.length), ...draws, ...spare];
}
