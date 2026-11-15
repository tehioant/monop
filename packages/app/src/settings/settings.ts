// The player's settings, kept on the device. Pure: the storage is passed in.

export interface Settings {
  sound: boolean;
  haptics: boolean;
}

/** What a player has until they choose. A new setting (the language, say) is a new field here. */
export const DEFAULTS: Settings = { sound: true, haptics: true };

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
  const settings = { ...DEFAULTS };
  for (const name of Object.keys(DEFAULTS) as (keyof Settings)[]) {
    const value = saved[name];
    if (typeof value === typeof DEFAULTS[name]) settings[name] = value as Settings[typeof name];
  }
  return settings;
}

export function saveSettings(storage: Storage, settings: Settings): void {
  storage.setItem(KEY, JSON.stringify(settings));
}
