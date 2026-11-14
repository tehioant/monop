import type { Action, PlayerView } from '@atlas/engine';

/**
 * Chooses one of `legal` for the player whose view this is. A bot only ever sees a player's view, never the
 * full state, and is a pure function: the same view and legal actions always give the same choice.
 */
export type Bot = (view: PlayerView, legal: readonly Action[]) => Action;

export const DIFFICULTIES = ['baseline'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/** `seed` is a uint32. One bot may play several seats of a game. */
export function createBot(difficulty: Difficulty, seed: number): Bot {
  if (!DIFFICULTIES.includes(difficulty)) throw new RangeError(`Unknown difficulty: ${difficulty}`);
  return (view, legal) => {
    if (legal.length === 0) throw new Error(`Player ${view.viewer} has no legal action`);
    // The log grows with every action, so each decision of a game gets its own random number.
    return baseline(legal, random(seed, view.log.length));
  };
}

/**
 * Lays a city whenever it can and otherwise picks at random. It knows no other action, so it stays legal
 * whatever the rules add, and it always has a chance of ending its turn.
 */
function baseline(legal: readonly Action[], random: number): Action {
  const lays = legal.filter((action) => action.type === 'lay');
  const choices = lays.length > 0 ? lays : legal;
  return choices[random % choices.length]!;
}

/** A uint32 that depends only on `seed` and `n` (murmur3 finaliser). */
function random(seed: number, n: number): number {
  let h = (seed ^ Math.imul(n + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
