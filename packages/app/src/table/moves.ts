// What changed between two views of a game, for the table to animate and to signal: the cards that changed
// place, and the event worth a sound. Worked out from where the cards are, never from the rules: a card or an
// action the table has never heard of still moves from where it was to where it is.

import type { CardId, PlayerId, PlayerView } from '@atlas/engine';
import { completeCount } from './actions.ts';

/** A place cards are in. A hand is a place even when its cards are hidden. */
export type Zone = 'deck' | 'market' | 'discard' | `${'hand' | 'bank' | 'table'}:${PlayerId}`;

export interface Move {
  /** Null for a card the viewer may not see. */
  card: CardId | null;
  from: Zone;
  to: Zone;
}

/** Where every card the viewer can see is. */
function places(view: PlayerView): Map<CardId, Zone> {
  const at = new Map<CardId, Zone>();
  for (const card of view.hand) at.set(card, `hand:${view.viewer}`);
  for (const card of view.market) at.set(card, 'market');
  if (view.discardTop !== null) at.set(view.discardTop, 'discard');
  view.players.forEach(({ bank, table }, seat) => {
    for (const card of bank) at.set(card, `bank:${seat}`);
    for (const stack of table) for (const card of [...stack.cities, ...stack.upgrades]) at.set(card, `table:${seat}`);
  });
  return at;
}

/** The player whose action led from `before` to `after`, if the log names one. */
function actor(before: PlayerView, after: PlayerView): PlayerId | undefined {
  for (const entry of after.log.slice(before.log.length)) if ('player' in entry) return entry.player;
  return undefined;
}

/** The cards that changed place from `before` to `after`, two views of the same game for the same player. */
export function movesBetween(before: PlayerView, after: PlayerView): Move[] {
  const was = places(before);
  const now = places(after);
  const by = actor(before, after);
  const hand = (seat: PlayerId | undefined): Zone | undefined => (seat === undefined ? undefined : `hand:${seat}`);
  const moves: Move[] = [];
  const move = (card: CardId | null, from: Zone | undefined, to: Zone | undefined) => {
    if (from !== undefined && to !== undefined && from !== to) moves.push({ card, from, to });
  };

  for (const [card, to] of now) {
    // A card that comes into sight was in the deck, or in the hand of the player who laid, banked or played it.
    const [place, seat] = to.split(':');
    const hidden = seat !== undefined && place !== 'hand' ? hand(Number(seat)) : to === 'discard' ? hand(by) : 'deck';
    move(card, was.get(card) ?? hidden, to);
  }
  // A Market card that goes out of sight is in the hand of the player who took it.
  for (const [card, from] of was) if (from === 'market' && !now.has(card)) move(card, from, hand(by));

  // A hand that holds more cards than the moves above account for drew them from the deck, face down.
  after.players.forEach((player, seat) => {
    if (seat === after.viewer) return;
    const zone = hand(seat);
    const count = (side: 'from' | 'to') => moves.filter((other) => other[side] === zone).length;
    const drawn = player.handSize - before.players[seat]!.handSize + count('from') - count('to');
    for (let i = 0; i < drawn; i++) move(null, 'deck', zone);
  });
  return moves;
}

/** An event worth a sound or a buzz. `play` is a card the viewer moved, `move` one anybody else did. */
export type Cue = 'win' | 'lose' | 'turn' | 'alert' | 'complete' | 'play' | 'move';

/** The event that led from `before` to `after`, the most notable one if several did; null if nothing shows. */
export function cueBetween(before: PlayerView, after: PlayerView): Cue | null {
  const { viewer } = after;
  if (after.phase.kind === 'over') {
    if (before.phase.kind === 'over') return null;
    return after.phase.winner === viewer ? 'win' : 'lose';
  }
  if (after.turn.player === viewer && before.turn.player !== viewer) return 'turn';
  // In someone else's turn, the game now waits on the viewer: they are charged, or a card is aimed at them.
  const waited = before.phase.kind !== 'over' && before.phase.player === viewer;
  if (after.phase.player === viewer && after.turn.player !== viewer && !waited) return 'alert';
  const complete = (view: PlayerView) => view.players.reduce((count, player) => count + completeCount(player.table), 0);
  if (complete(after) > complete(before)) return 'complete';
  if (movesBetween(before, after).length === 0) return null;
  return actor(before, after) === viewer ? 'play' : 'move';
}
