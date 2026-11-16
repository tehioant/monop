// Writes the app's sounds: short synthesised tones, so that every sound file in the repository is our own.
// Run from packages/app after changing a sound: `node scripts/make-sounds.ts`. The files it writes are committed.

import { mkdirSync, writeFileSync } from 'node:fs';

const RATE = 22050;

interface Note {
  /** Hz. */
  pitch: number;
  /** Seconds from the start of the sound. */
  at: number;
  /** Seconds the note takes to die away. */
  length: number;
}

/** A plucked tone: a short attack, then a decay, with two overtones for body. */
function tone({ pitch, at, length }: Note, time: number): number {
  const t = time - at;
  if (t < 0 || t > length) return 0;
  const envelope = Math.min(1, t / 0.004) * Math.exp((-5 * t) / length);
  const wave = (harmonic: number) => Math.sin(2 * Math.PI * pitch * harmonic * t);
  return envelope * (wave(1) + 0.3 * wave(2) + 0.1 * wave(3));
}

/** One tune after another on a row of notes, `step` seconds apart, each ringing for `length`. */
function tune(pitches: number[], step: number, length: number): Note[] {
  return pitches.map((pitch, i) => ({ pitch, at: i * step, length }));
}

const [C4, E4, G4, A4, C5, E5, G5, A5, C6] = [261.63, 329.63, 392.0, 440.0, 523.25, 659.25, 783.99, 880.0, 1046.5];

const SOUNDS: Record<string, Note[]> = {
  // A card put down: one short, dry knock.
  card: [{ pitch: 180, at: 0, length: 0.07 }, { pitch: 1400, at: 0, length: 0.02 }],
  turn: tune([E5, A5], 0.09, 0.3),
  alert: tune([A4, E4], 0.12, 0.35),
  complete: tune([C5, E5, G5], 0.08, 0.4),
  win: tune([C5, E5, G5, C6, G5, C6], 0.11, 0.5),
  lose: tune([G4, E4, C4], 0.18, 0.6),
};

/** 16-bit mono PCM in a WAV container. */
function wav(notes: Note[]): Buffer {
  const seconds = Math.max(...notes.map((note) => note.at + note.length));
  const samples = Math.ceil(seconds * RATE);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + samples * 2, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(samples * 2, 40);
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const level = notes.reduce((sum, note) => sum + tone(note, i / RATE), 0);
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, 0.4 * level)) * 32767), i * 2);
  }
  return Buffer.concat([header, data]);
}

const folder = new URL('../assets/sounds/', import.meta.url);
mkdirSync(folder, { recursive: true });
for (const [name, notes] of Object.entries(SOUNDS)) writeFileSync(new URL(`${name}.wav`, folder), wav(notes));
