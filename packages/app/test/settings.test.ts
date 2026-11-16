import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULTS, loadSettings, saveSettings, type Storage } from '../src/settings/settings.ts';

/** A device's storage, in memory. */
function device(saved?: string): Storage & { items: Map<string, string> } {
  const items = new Map<string, string>(saved === undefined ? [] : [['atlas.settings', saved]]);
  return { items, getItem: (key) => items.get(key) ?? null, setItem: (key, value) => void items.set(key, value) };
}

test('sound and haptics are on until the player says otherwise', () => {
  assert.deepEqual(loadSettings(device()), { sound: true, haptics: true });
  assert.deepEqual(DEFAULTS, { sound: true, haptics: true });
});

test('what was saved is what the next launch loads', () => {
  const storage = device();
  saveSettings(storage, { sound: false, haptics: true });
  assert.deepEqual(loadSettings(storage), { sound: false, haptics: true });
  saveSettings(storage, { sound: false, haptics: false });
  assert.deepEqual(loadSettings(storage), { sound: false, haptics: false });
  assert.deepEqual([...storage.items.keys()], ['atlas.settings']);
});

test('a setting that is missing or unreadable gets its default, the others are kept', () => {
  assert.deepEqual(loadSettings(device('{"haptics":false}')), { sound: true, haptics: false });
  assert.deepEqual(loadSettings(device('{"sound":"loud","haptics":false,"language":"fr"}')), { sound: true, haptics: false });
  assert.deepEqual(loadSettings(device('not json')), DEFAULTS);
  assert.deepEqual(loadSettings(device('null')), DEFAULTS);
  const broken: Storage = { getItem: () => { throw new Error('locked'); }, setItem: () => {} };
  assert.deepEqual(loadSettings(broken), DEFAULTS);
});
