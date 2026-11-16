// What a screen gives the table: the states of its game one at a time (see `pace.ts`), on the device's clock.

import type { Action, PlayerView } from '@atlas/engine';
import { useEffect, useState } from 'react';
import { advance, push, settled, start, timing } from './pace.ts';

const NONE: readonly Action[] = [];

export interface Paced {
  /** The state to show: `view` itself once every state before it has been shown. */
  view: PlayerView;
  /** The legal actions to offer: `legal` once `view` is the state shown, none before. */
  legal: readonly Action[];
  /** True once the latest state has had its time on screen: a finished game can give way to its results. */
  settled: boolean;
}

/**
 * Paces a game for the table. `view` and `legal` are the latest state of the game and the viewer's legal actions
 * in it, as they come from the engine or the server; a state is told from the one before by the length of its log.
 */
export function usePaced(view: PlayerView, legal: readonly Action[]): Paced {
  const [{ pace, now }, setState] = useState(() => ({ pace: start(view), now: Date.now() }));
  const length = view.log.length;

  useEffect(() => {
    setState((state) => {
      const latest = state.pace.waiting.at(-1)?.state ?? state.pace.shown;
      const known = latest.log.length;
      if (view === latest) return state;
      const now = Date.now();
      // A shorter log is another game, or a server that restarted from an earlier state: nothing to catch up on.
      if (length <= known || view.viewer !== latest.viewer) return { pace: start(view), now };
      return { pace: push(state.pace, view, timing(view.log.slice(known), view.viewer), now), now };
    });
  }, [view]);

  useEffect(() => {
    if (settled(pace, now)) return;
    // The timer going off is the time having come, even if the clock reads a hair less.
    const tick = () =>
      setState(({ pace }) => {
        const now = Math.max(Date.now(), pace.until);
        return { pace: advance(pace, now), now };
      });
    const timer = setTimeout(tick, Math.max(0, pace.until - Date.now()));
    return () => clearTimeout(timer);
  }, [pace, now]);

  return {
    view: pace.shown,
    legal: pace.shown === view ? legal : NONE,
    settled: settled(pace, now) && pace.shown === view,
  };
}
