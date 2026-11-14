import type { Action, PlayerView } from '@atlas/engine';
import { rate, type Depth } from './heuristics.ts';

/**
 * Chooses one of `legal` for the player whose view this is. A bot only ever sees a player's view, never the
 * full state, and is a pure function: the same view and legal actions always give the same choice.
 */
export type Bot = (view: PlayerView, legal: readonly Action[]) => Action;

export const DIFFICULTIES = ['easy', 'normal', 'hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/** `mistakes` is the share of decisions taken carelessly, at random. */
const LEVELS: Record<Difficulty, { depth: Depth; mistakes: number }> = {
  easy: { depth: 0, mistakes: 0.2 },
  normal: { depth: 1, mistakes: 0.08 },
  hard: { depth: 2, mistakes: 0 },
};

/** `seed` is a uint32. One bot may play several seats of a game. */
export function createBot(difficulty: Difficulty, seed: number): Bot {
  if (!DIFFICULTIES.includes(difficulty)) throw new RangeError(`Unknown difficulty: ${difficulty}`);
  const { depth, mistakes } = LEVELS[difficulty];
  return (view, legal) => {
    if (legal.length === 0) throw new Error(`Player ${view.viewer} has no legal action`);
    // The log grows with every action, so each decision of a game gets its own random numbers.
    const roll = random(seed, view.log.length);
    const pick = random(roll, view.log.length);
    if (roll < mistakes * 2 ** 32) return careless(legal, pick);
    const score = rate(view, depth);
    const scores = legal.map(score);
    const best = Math.max(...scores);
    const choices = legal.filter((_, i) => scores[i] === best);
    return choices[pick % choices.length]!;
  };
}

/**
 * A choice at random: first among the cards and what to do with each (lay, bank, play...), then among the
 * ways to do that, so that a card with many targets is not chosen more often. Never a wild city move: those
 * are free, and a bot that made them at random could go on for a whole turn.
 */
function careless(legal: readonly Action[], random: number): Action {
  const key = (action: Action) => `${action.type} ${'card' in action ? action.card : ''}`;
  const moves = legal.filter((action) => action.type !== 'reassign');
  const keys = [...new Set(moves.map(key))];
  const chosen = keys[random % keys.length];
  const choices = moves.filter((action) => key(action) === chosen);
  return choices[(random >>> 8) % choices.length]!;
}

/** A uint32 that depends only on `seed` and `n` (murmur3 finaliser). */
function random(seed: number, n: number): number {
  let h = (seed ^ Math.imul(n + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
