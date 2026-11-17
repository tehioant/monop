// The player's settings, kept on the device. Pure: the storage is passed in.

import { isLanguageChoice, type LanguageChoice } from '../i18n/strings.ts';

export interface Settings {
  sound: boolean;
  haptics: boolean;
  language: LanguageChoice;
}

/** What a player has until they choose. */
export const DEFAULTS: Settings = { sound: true, haptics: true, language: 'system' };

/** Where the settings are kept: the synchronous part of the device's key-value storage. */
export interface Storage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const KEY = 'atlas.settings';

/** The saved settings; the default for each one that was never saved, or that cannot be read. */
export function loadSettings(storage: Storage): Settings {
  let saved: Partial<Record<keyof Settings, unknown>> = {};
  try {
    saved = JSON.parse(storage.getItem(KEY) ?? '{}') ?? {};
  } catch {
    // Unreadable: as if nothing had been saved.
  }
  return {
    sound: typeof saved.sound === 'boolean' ? saved.sound : DEFAULTS.sound,
    haptics: typeof saved.haptics === 'boolean' ? saved.haptics : DEFAULTS.haptics,
    language: isLanguageChoice(saved.language) ? saved.language : DEFAULTS.language,
  };
}

export function saveSettings(storage: Storage, settings: Settings): void {
  storage.setItem(KEY, JSON.stringify(settings));
}
