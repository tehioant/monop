// The player's settings, shared by the settings screen and by whatever they switch on and off. Read from the
// device when the app starts, written back at every change.

import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';
import { loadSettings, saveSettings, type Settings } from './settings.ts';

interface SettingsStore {
  settings: Settings;
  change: (change: Partial<Settings>) => void;
}

export const useSettings = create<SettingsStore>((set, get) => ({
  settings: loadSettings(SecureStore),
  change: (change) => {
    const settings = { ...get().settings, ...change };
    set({ settings });
    saveSettings(SecureStore, settings);
  },
}));
