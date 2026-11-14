// The solo game in progress, shared by the solo screens.

import type { Action } from '@atlas/engine';
import { create } from 'zustand';
import { botToMove, playBot, playHuman, startSolo, type SoloConfig, type SoloGame } from './solo.ts';

interface SoloStore {
  game: SoloGame | null;
  start: (config: SoloConfig) => void;
  play: (action: Action) => void;
  /** One bot action, if the game is waiting on a bot. */
  stepBot: () => void;
}

export const useSolo = create<SoloStore>((set) => ({
  game: null,
  start: (config) => set({ game: startSolo(config, Math.floor(Math.random() * 2 ** 32)) }),
  play: (action) => set(({ game }) => ({ game: game && playHuman(game, action) })),
  stepBot: () => set(({ game }) => ({ game: game && botToMove(game) ? playBot(game) : game })),
}));
