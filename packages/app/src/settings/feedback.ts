// Sound and haptics for the events of a game, each only if the player's settings allow it.
// The sounds are our own: see scripts/make-sounds.ts.

import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import type { Cue } from '../table/moves.ts';
import { useSettings } from './store.ts';
import { warnOnce } from '../warnOnce.ts';

const card = require('../../assets/sounds/card.wav');

const SOUNDS: Record<Cue, number> = {
  win: require('../../assets/sounds/win.wav'),
  lose: require('../../assets/sounds/lose.wav'),
  turn: require('../../assets/sounds/turn.wav'),
  alert: require('../../assets/sounds/alert.wav'),
  complete: require('../../assets/sounds/complete.wav'),
  play: card,
  move: card,
};

const { NotificationFeedbackType: Notice, ImpactFeedbackStyle: Impact } = Haptics;

/** What the phone does in the hand. Nothing for a card somebody else moves: only the player's own are felt. */
const HAPTICS: Record<Cue, (() => Promise<void>) | null> = {
  win: () => Haptics.notificationAsync(Notice.Success),
  lose: () => Haptics.notificationAsync(Notice.Error),
  turn: () => Haptics.impactAsync(Impact.Medium),
  alert: () => Haptics.notificationAsync(Notice.Warning),
  complete: () => Haptics.impactAsync(Impact.Heavy),
  play: () => Haptics.impactAsync(Impact.Light),
  move: null,
};

/** One player per sound file, made the first time it is heard. */
const players = new Map<number, AudioPlayer>();

let audioMode: Promise<void> | undefined;

async function play(sound: number): Promise<void> {
  // A game's effects respect silent mode and the player's own music.
  audioMode ??= setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' });
  await audioMode;
  if (!useSettings.getState().settings.sound) return;
  const made = players.get(sound) ?? createAudioPlayer(sound);
  players.set(sound, made);
  await made.seekTo(0);
  if (useSettings.getState().settings.sound) made.play();
}

/** Plays the sound of `cue` and its haptic, as far as the settings allow. Never throws: a game goes on without them. */
export function signal(cue: Cue): void {
  const { sound, haptics } = useSettings.getState().settings;
  if (sound) void play(SOUNDS[cue]).catch(() => warnOnce('audio', 'Feedback unavailable; gameplay continues.'));
  if (haptics) {
    // A missing native module may throw synchronously as well as reject its promise.
    try {
      void HAPTICS[cue]?.().catch(() => warnOnce('haptics', 'Feedback unavailable; gameplay continues.'));
    } catch { warnOnce('haptics', 'Feedback unavailable; gameplay continues.'); }
  }
}
