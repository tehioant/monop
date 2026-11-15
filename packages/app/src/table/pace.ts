// Pacing: the states of a game shown one at a time, each long enough to be followed, however fast they come in
// (bots answer at once, and online a bot's whole turn arrives as a burst). Pure: the clock is always passed in.

import type { LogEntry, PlayerId } from '@atlas/engine';

export interface Pace<T> {
  /** The state on screen. */
  shown: T;
  /** When it has had its time on screen and the next one may replace it. */
  until: number;
  /** The states that came in since, oldest first. */
  waiting: readonly Step<T>[];
}

export interface Timing {
  /** How long the state stays on screen before the next one, in ms. */
  hold: number;
  /** It does not wait for the state on screen to have had its time: the result of the viewer's own move. */
  urgent: boolean;
}

interface Step<T> extends Timing {
  state: T;
}

export function start<T>(state: T): Pace<T> {
  return { shown: state, until: 0, waiting: [] };
}

/** A state comes in at `now`: shown at once if nothing is in its way, after the ones before it otherwise. */
export function push<T>(pace: Pace<T>, state: T, timing: Timing, now: number): Pace<T> {
  return advance({ ...pace, waiting: [...pace.waiting, { state, ...timing }] }, now);
}

/** The pace at `now`: the next state is on screen if its time has come. To call again at `until`. */
export function advance<T>(pace: Pace<T>, now: number): Pace<T> {
  const [next, ...waiting] = pace.waiting;
  if (!next || (now < pace.until && !next.urgent)) return pace;
  return advance({ shown: next.state, until: now + next.hold, waiting }, now);
}

/** True once the latest state is on screen and has had its time there. */
export function settled<T>(pace: Pace<T>, now: number): boolean {
  return pace.waiting.length === 0 && now >= pace.until;
}

/** Steps with nothing to look at: a card drawn face down, a turn ended, an answer declined. */
const QUICK: readonly LogEntry['type'][] = ['draw', 'endTurn', 'decline'];
export const QUICK_MS = 350;
export const STEP_MS = 700;
/** The last state of a game stays up before the results. */
export const OVER_MS = 1500;

/** How to pace the state that `entries` led to, for the player at seat `viewer`: the log entries added since the state before. */
export function timing(entries: readonly LogEntry[], viewer: PlayerId): Timing {
  const urgent = entries.some((entry) => 'player' in entry && entry.player === viewer);
  if (entries.some((entry) => entry.type === 'gameOver')) return { hold: OVER_MS, urgent };
  return { hold: entries.every((entry) => QUICK.includes(entry.type)) ? QUICK_MS : STEP_MS, urgent };
}
