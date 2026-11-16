// What the action log shows first: what happened since the viewer last played.

import type { LogEntry, PlayerId } from '@atlas/engine';

/**
 * The entries since the viewer's last turn ended: the other players' turns, what the viewer answered during
 * them, and their own turn so far. The whole log until they have ended a turn.
 */
export function sinceLastTurn(log: readonly LogEntry[], viewer: PlayerId): LogEntry[] {
  const mine = (entry: LogEntry | undefined) => entry !== undefined && 'player' in entry && entry.player === viewer;
  const ended = log.findLastIndex((entry) => entry.type === 'endTurn' && mine(entry));
  if (ended < 0) return [...log];
  let start = ended + 1;
  // What the viewer did right after ending their turn still belongs to it (discarding down to the hand limit).
  while (mine(log[start])) start++;
  return log.slice(start);
}
