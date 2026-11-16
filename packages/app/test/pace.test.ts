import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LogEntry } from '@atlas/engine';
import { advance, OVER_MS, push, QUICK_MS, settled, start, STEP_MS, timing, type Pace } from '../src/table/pace.ts';

const step = { hold: 700, urgent: false };
const quick = { hold: 350, urgent: false };
const own = { hold: 700, urgent: true };

/** What is on screen at each of `times`, the clock moved by hand. */
function watch(pace: Pace<string>, times: number[]): string[] {
  return times.map((now) => (pace = advance(pace, now)).shown);
}

test('a burst of states is shown one at a time, each for its own time, none skipped', () => {
  let pace = start('dealt');
  assert.equal(settled(pace, 0), true);

  // A bot's whole turn comes in at once, long after the first state was shown.
  pace = push(pace, 'drew', quick, 1000);
  pace = push(pace, 'laid', step, 1000);
  pace = push(pace, 'ended', quick, 1000);
  assert.equal(pace.shown, 'drew', 'the first is shown at once: the state before it had its time');

  assert.deepEqual(watch(pace, [1349, 1350, 2049, 2050, 2399]), ['drew', 'laid', 'laid', 'ended', 'ended']);
  pace = advance(advance(pace, 1350), 2050);
  assert.equal(settled(pace, 2399), false, 'the last state still has to be seen');
  assert.equal(settled(pace, 2400), true);
});

test('a clock read late shows the next state, not the one after it', () => {
  const pace = push(push(push(start('a'), 'b', step, 0), 'c', step, 0), 'd', step, 0);
  assert.equal(advance(pace, 60_000).shown, 'c');
  assert.equal(advance(advance(pace, 60_000), 60_699).shown, 'c');
  assert.equal(advance(advance(pace, 60_000), 60_700).shown, 'd');
});

test("the viewer's own move is shown at once, but never ahead of the states before it", () => {
  // A bot's move has just been shown; the viewer answers before its time is up.
  const answered = push(push(start('a'), 'bot played', step, 0), 'I paid', own, 100);
  assert.equal(answered.shown, 'I paid');
  assert.equal(answered.until, 800);

  const behind = push(push(push(start('a'), 'b', step, 0), 'c', step, 0), 'mine', own, 100);
  assert.deepEqual(watch(behind, [100, 700, 701]), ['b', 'mine', 'mine'], 'c is shown, then mine right behind it');
});

test('an oversized burst bounds catch-up time while retaining the latest state', () => {
  let pace = start('initial');
  for (let i = 0; i < 100; i++) pace = push(pace, String(i), step, 0);
  assert.ok(pace.waiting.length <= 8, 'a fast bot burst must not build an unbounded wait');
  for (let now = 700; now <= 6300; now += 700) pace = advance(pace, now);
  assert.equal(pace.shown, '99');
  assert.equal(settled(pace, 6300), true);
});

test('a step is timed by what happened in it', () => {
  const entry = (type: string, player?: number) => ({ type, player }) as LogEntry;
  assert.deepEqual(timing([entry('draw', 1)], 0), { hold: QUICK_MS, urgent: false });
  assert.deepEqual(timing([entry('endTurn', 1)], 0), { hold: QUICK_MS, urgent: false });
  assert.deepEqual(timing([entry('lay', 1)], 0), { hold: STEP_MS, urgent: false });
  assert.deepEqual(timing([{ type: 'reshuffle' }, entry('draw', 1)], 0), { hold: STEP_MS, urgent: false });
  assert.deepEqual(timing([entry('lay', 1)], 1), { hold: STEP_MS, urgent: true });
  assert.deepEqual(timing([entry('lay', 1), { type: 'gameOver', winner: 1 }], 0), { hold: OVER_MS, urgent: false });
});
