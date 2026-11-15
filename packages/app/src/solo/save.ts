// The saved solo game: what is written on the device and what is accepted back. No React, no I/O.

import { createBot } from '@atlas/bots';
import { botToMove, playBot, soloLegal, type SoloGame } from './solo.ts';

/**
 * The version of the saved shape: a `SoloGame`, the engine's `GameState` included.
 * Raise it whenever that shape changes, so that a game saved before the change is discarded instead of resumed.
 */
export const SAVE_VERSION = 1;

export function serialize(game: SoloGame): string {
  return JSON.stringify({ version: SAVE_VERSION, game });
}

/**
 * The saved game, or null when `text` is not a game this version of the app can continue:
 * damaged, saved by another version, finished, or not playable any more.
 */
export function deserialize(text: string): SoloGame | null {
  try {
    const { version, game } = JSON.parse(text) as { version: unknown; game: SoloGame };
    return version === SAVE_VERSION && playable(game) ? game : null;
  } catch {
    return null;
  }
}

/** Tries the next step of the game. Throws, or says no, on a game the engine or the bots cannot take further. */
function playable(game: SoloGame): boolean {
  createBot(game.config.difficulty, game.seed);
  if (botToMove(game)) playBot(game);
  else if (soloLegal(game).length === 0) return false;
  return true;
}
