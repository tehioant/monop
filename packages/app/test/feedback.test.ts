import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadComponent } from './componentBoundary.ts';

const path = new URL('../src/settings/feedback.ts', import.meta.url).pathname;
const haptics = { NotificationFeedbackType: {}, ImpactFeedbackStyle: {}, notificationAsync: async () => {}, impactAsync: async () => {} };
const settings = { settings: { sound: true, haptics: false } };
const store = { useSettings: { getState: () => settings } };

test('sound waits for mode and seek before playback; disabling during seek suppresses playback', async () => {
  let finish!: () => void;
  const seeking = new Promise<void>((resolve) => { finish = resolve; });
  let plays = 0;
  const { signal } = loadComponent(path, { './store.ts': store, 'expo-haptics': haptics, 'expo-audio': {
    setAudioModeAsync: async () => {}, createAudioPlayer: () => ({ seekTo: () => seeking, play: () => plays++ }),
  } });
  signal('play');
  assert.equal(plays, 0, 'play must wait for seek completion');
  settings.settings.sound = false; finish(); await new Promise(setImmediate);
  assert.equal(plays, 0, 'pending sound must respect a newly disabled setting');
  settings.settings.sound = true;
});

test('unavailable audio mode, rejected seek and synchronous haptics never escape signal', async () => {
  settings.settings = { sound: true, haptics: true };
  const { signal } = loadComponent(path, { './store.ts': store,
    'expo-haptics': { ...haptics, impactAsync: () => { throw new Error('not supported'); } },
    'expo-audio': { setAudioModeAsync: async () => { throw new Error('no audio'); },
      createAudioPlayer: () => ({ seekTo: async () => { throw new Error('cannot seek'); }, play() { throw new Error('cannot play'); } }) },
  });
  assert.doesNotThrow(() => signal('play'));
  await new Promise(setImmediate);
  settings.settings = { sound: true, haptics: false };
});

test('settings store persists both toggles and reports storage refusal without crashing', () => {
  const saved = new Map<string, string>(); let fail = false;
  const storage = { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => {
    if (fail) throw new Error('locked'); saved.set(key, value);
  } };
  const load = () => loadComponent(new URL('../src/settings/store.ts', import.meta.url).pathname, { 'expo-secure-store': storage }).useSettings;
  const first = load(); first.getState().change({ sound: false }); first.getState().change({ haptics: false });
  assert.deepEqual(load().getState().settings, { sound: false, haptics: false });
  fail = true;
  assert.doesNotThrow(() => first.getState().change({ sound: true }));
  assert.equal(first.getState().saveError, true);
  fail = false; first.getState().change({ haptics: true });
  assert.equal(first.getState().saveError, false);
  assert.deepEqual(load().getState().settings, { sound: true, haptics: true });
});

for (const boundary of ['mode', 'create', 'seek', 'play', 'haptic-reject', 'haptic-throw']) {
  test(`${boundary} failure stays contained and warns once without raw details`, async () => {
    const warnings: unknown[][] = []; const warn = console.warn;
    console.warn = (...args) => { warnings.push(args); };
    const fail = () => { throw new Error('private hardware details'); };
    const reject = async () => fail();
    settings.settings = { sound: !boundary.startsWith('haptic'), haptics: boundary.startsWith('haptic') };
    try {
      const { signal } = loadComponent(path, { './store.ts': store,
        'expo-haptics': { ...haptics, impactAsync: boundary === 'haptic-throw' ? fail : reject },
        'expo-audio': {
          setAudioModeAsync: boundary === 'mode' ? reject : async () => {},
          createAudioPlayer: boundary === 'create' ? fail : () => ({
            seekTo: boundary === 'seek' ? reject : async () => {}, play: boundary === 'play' ? fail : () => {},
          }),
        },
      });
      for (let i = 0; i < 5; i++) { assert.doesNotThrow(() => signal('play')); await new Promise(setImmediate); }
      const scope = boundary.startsWith('haptic') ? 'haptics' : 'audio';
      assert.deepEqual(warnings, [[`[atlas:${scope}] Feedback unavailable; gameplay continues.`]]);
    } finally { console.warn = warn; settings.settings = { sound: true, haptics: false }; }
  });
}

test('repeated settings save failures warn once while retaining UI error and recovery', () => {
  const warnings: unknown[][] = []; const warn = console.warn; let fail = true;
  console.warn = (...args) => { warnings.push(args); };
  try {
    const storage = { getItem: () => null, setItem: () => { if (fail) throw new Error('private storage details'); } };
    const store = loadComponent(new URL('../src/settings/store.ts', import.meta.url).pathname, { 'expo-secure-store': storage }).useSettings;
    for (let i = 0; i < 5; i++) {
      assert.doesNotThrow(() => store.getState().change({ sound: false }));
      assert.equal(store.getState().saveError, true);
      assert.equal(store.getState().settings.sound, false);
    }
    assert.deepEqual(warnings, [['[atlas:settings-save] Settings could not be saved on this device.']]);
    fail = false; store.getState().change({ haptics: false });
    assert.equal(store.getState().saveError, false);
  } finally { console.warn = warn; }
});
