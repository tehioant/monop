// The solo game in progress, shared by the solo screens and kept on the device.
import type { Action } from '@atlas/engine';
import { File, Paths } from 'expo-file-system';
import { create } from 'zustand';
import { trackGame } from '../telemetry/analytics.ts';
import { deserialize, serialize } from './save.ts';
import { botToMove, inProgress, playBot, playHuman, rematch, startSolo, type SoloConfig, type SoloGame } from './solo.ts';

export type SaveError = 'save_unavailable';

interface SoloStore {
  game: SoloGame | null;
  saveError: SaveError | null;
  start: (config: SoloConfig) => boolean;
  rematch: () => boolean;
  abandon: () => boolean;
  play: (action: Action) => boolean;
  stepBot: () => void;
  retrySave: () => void;
}

type Saved = { kind: 'missing' | 'invalid' } | { kind: 'valid'; game: SoloGame };
const file = (name = 'solo-game.json') => new File(Paths.document, name);
let warned = false;
function failure(): SaveError {
  if (!warned) {
    warned = true;
    console.warn('[atlas:solo-save] Device save unavailable; previous save retained where possible.');
  }
  return 'save_unavailable';
}

// File.exists can report false for denied access. info() checks read permission;
// a textSync failure must stop every mutation, not be classified as corruption.
function read(save: File): Saved {
  if (!save.info().exists) return { kind: 'missing' };
  const game = deserialize(save.textSync());
  return game ? { kind: 'valid', game } : { kind: 'invalid' };
}
function load(): SoloGame | null {
  const primary = read(file());
  if (primary.kind === 'valid') return primary.game;
  const backup = read(file('solo-game.backup.json'));
  if (backup.kind === 'valid') return backup.game;
  return null;
}

// Expo overwrite moves delete the destination first. Keep one last-good copy
// before installing the complete temporary file, never writing over valid bytes.
function save(game: SoloGame | null) {
  const primary = file();
  const backup = file('solo-game.backup.json');
  const current = read(primary);
  read(backup);
  if (game && inProgress(game)) {
    const temporary = file('solo-game.tmp.json');
    temporary.writeSync(serialize(game));
    if (current.kind === 'valid') primary.copySync(backup, { overwrite: true });
    temporary.moveSync(primary, { overwrite: true });
  } else {
    // A failed backup deletion must not discard the latest save.
    if (backup.info().exists) backup.delete();
    if (primary.info().exists) primary.delete();
  }
}

let initial: SoloGame | null = null;
let blocked = false;
let initialError: SaveError | null = null;
try { initial = load(); } catch { blocked = true; initialError = failure(); }
const newSeed = (previous?: number) => {
  const seed = Math.floor(Math.random() * 2 ** 32);
  return seed === previous ? (seed + 1) >>> 0 : seed;
};

export const useSolo = create<SoloStore>((set, get) => {
  // Persist before publishing state: a refused action stays available to retry.
  function update(game: SoloGame | null, started = false): boolean {
    if (blocked) { set({ saveError: failure() }); return false; }
    const previous = get().game;
    try {
      save(game);
      set({ game, saveError: null });
    } catch { set({ saveError: failure() }); return false; }
    if (game && started) trackGame('game started', 'solo', game.state.options);
    if (game && previous && inProgress(previous) && !inProgress(game)) {
      trackGame('game finished', 'solo', game.state.options);
    }
    return true;
  }
  return {
    game: initial,
    saveError: initialError,
    start: (config) => update(startSolo(config, newSeed()), true),
    rematch: () => {
      const { game } = get();
      return game ? update(rematch(game, newSeed(game.seed)), true) : false;
    },
    abandon: () => update(null),
    play: (action) => { const { game } = get(); return game ? update(playHuman(game, action)) : false; },
    stepBot: () => { const { game } = get(); if (game && botToMove(game)) update(playBot(game)); },
    retrySave: () => {
      if (!blocked) { update(get().game); return; }
      try {
        const game = load();
        blocked = false;
        set({ game, saveError: null });
      } catch { set({ saveError: failure() }); }
    },
  };
});
