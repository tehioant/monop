// Sound and haptics for the events of a game, each only if the player's settings allow it.
// The sounds are our own: see scripts/make-sounds.ts.

import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import type { Cue } from '../table/moves.ts';
import { useSettings } from './store.ts';

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

function player(sound: number): AudioPlayer {
  // A game's sounds are effects: silent when the phone is, and never in the way of the player's own music.
  if (players.size === 0) void setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' });
  const made = players.get(sound) ?? createAudioPlayer(sound);
  players.set(sound, made);
  return made;
}

/** Plays the sound of `cue` and its haptic, as far as the settings allow. Never throws: a game goes on without them. */
export function signal(cue: Cue): void {
  const { sound, haptics } = useSettings.getState().settings;
  if (sound) {
    try {
      const playing = player(SOUNDS[cue]);
      void playing.seekTo(0).catch(() => {});
      playing.play();
    } catch {
      // No sound on this device.
    }
  }
  if (haptics) void HAPTICS[cue]?.().catch(() => {});
}
