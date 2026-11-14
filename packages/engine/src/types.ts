import type { CardId, CountryId } from './cards.ts';

/** A player is identified by their seat: 0 to players - 1. Seat 0 plays first. */
export type PlayerId = number;

export interface GameOptions {
  /** 2 to 5. */
  players: number;
  /** 3 or 5. */
  countriesToWin: number;
}

export interface GameSetup {
  /**
   * Exact draw order (first card is drawn first), used instead of shuffling the standard deck.
   * For scripted games. Seat 0 is dealt the first cards, then seat 1, and so on.
   */
  deck?: readonly CardId[];
}

/** The cities a player has laid in one country. */
export interface CountryStack {
  country: CountryId;
  cities: CardId[];
}

export interface PlayerState {
  hand: CardId[];
  bank: CardId[];
  /** Only countries with at least one city. */
  table: CountryStack[];
}

/**
 * What the game is waiting for. In every phase but `over`, `player` is the only one with legal actions.
 * Interrupts added by later rules (payment, veto, target) are further kinds of phase.
 */
export type Phase =
  | { kind: 'draw'; player: PlayerId; remaining: number }
  | { kind: 'play'; player: PlayerId }
  | { kind: 'discard'; player: PlayerId }
  | { kind: 'over'; winner: PlayerId | null };

/** Plain JSON data. Treat as immutable: `applyAction` returns a new state. */
export interface GameState {
  options: GameOptions;
  rng: number;
  /** Next card to draw first. */
  deck: CardId[];
  /** Top card last. */
  discard: CardId[];
  players: PlayerState[];
  /** Whose turn it is; survives interrupts, unlike `phase.player`. */
  turn: { player: PlayerId; playsLeft: number };
  phase: Phase;
  log: LogEntry[];
}

export type Action =
  | { type: 'draw' }
  | { type: 'lay'; card: CardId }
  | { type: 'bank'; card: CardId }
  | { type: 'endTurn' }
  | { type: 'discard'; card: CardId };

/** What happened, in terms every player may see: an entry never names a card that is hidden from someone. */
export type LogEntry =
  | { type: 'draw'; player: PlayerId }
  | { type: 'lay'; player: PlayerId; card: CardId }
  | { type: 'bank'; player: PlayerId; card: CardId }
  | { type: 'endTurn'; player: PlayerId }
  | { type: 'discard'; player: PlayerId; card: CardId }
  | { type: 'gameOver'; winner: PlayerId | null };

/** Everything one player may know, and nothing else. Safe to send to that player. */
export interface PlayerView {
  viewer: PlayerId;
  options: GameOptions;
  hand: CardId[];
  /** By seat, the viewer included. */
  players: {
    handSize: number;
    bank: CardId[];
    table: (CountryStack & { complete: boolean })[];
  }[];
  deckSize: number;
  discardTop: CardId | null;
  turn: GameState['turn'];
  /** The pending prompt: who must act, and how. */
  phase: Phase;
  log: LogEntry[];
}
