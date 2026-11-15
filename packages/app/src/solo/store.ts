// The solo game in progress, shared by the solo screens and kept on the device.

import type { Action } from '@atlas/engine';
import { File, Paths } from 'expo-file-system';
import { create } from 'zustand';
import { deserialize, serialize } from './save.ts';
import { botToMove, inProgress, playBot, playHuman, rematch, startSolo, type SoloConfig, type SoloGame } from './solo.ts';

interface SoloStore {
  /** Starts as the game saved on the device, if there is one to resume. */
  game: SoloGame | null;
  start: (config: SoloConfig) => void;
  /** A new game with the settings of the current one. */
  rematch: () => void;
  /** Forgets the current game, and with it the saved one. */
  abandon: () => void;
  play: (action: Action) => void;
  /** One bot action, if the game is waiting on a bot. */
  stepBot: () => void;
}

/** Where the game in progress is kept, so that it survives closing the app. */
const SAVE = new File(Paths.document, 'solo-game.json');

const newSeed = () => Math.floor(Math.random() * 2 ** 32);

/** The saved game. A save that cannot be continued is discarded: the player starts fresh. */
function load(): SoloGame | null {
  try {
    if (!SAVE.exists) return null;
    const game = deserialize(SAVE.textSync());
    if (!game) SAVE.delete();
    return game;
  } catch {
    return null;
  }
}

/** Writes the game in progress; without one, removes what was saved. */
function save(game: SoloGame | null) {
  try {
    if (game && inProgress(game)) SAVE.writeSync(serialize(game));
    else if (SAVE.exists) SAVE.delete();
  } catch (error) {
    // Playing goes on without the save.
    console.warn('Could not save the solo game', error);
  }
}

export const useSolo = create<SoloStore>((set) => ({
  game: load(),
  start: (config) => set({ game: startSolo(config, newSeed()) }),
  rematch: () => set(({ game }) => ({ game: game && rematch(game, newSeed()) })),
  abandon: () => set({ game: null }),
  play: (action) => set(({ game }) => ({ game: game && playHuman(game, action) })),
  stepBot: () => set(({ game }) => ({ game: game && botToMove(game) ? playBot(game) : game })),
}));

useSolo.subscribe(({ game }, previous) => {
  if (game !== previous.game) save(game);
});
