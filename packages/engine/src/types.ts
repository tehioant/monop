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
  /**
   * `player` still owes `owed` coin to `receiver` and pays it card by card from their bank and laid cities.
   * `queue` lists the players charged next, in order; each will owe `amount`.
   */
  | { kind: 'pay'; player: PlayerId; receiver: PlayerId; owed: number; amount: number; queue: PlayerId[] }
  | { kind: 'over'; winner: PlayerId | null };

/** Plain JSON data. Treat as immutable: `applyAction` returns a new state. */
export interface GameState {
  options: GameOptions;
  rng: number;
  /** Next card to draw first. */
  deck: CardId[];
  /** Top card last. */
  discard: CardId[];
  /** Face-up cards a turn's draws may be taken from. Refilled from the deck; short only when the cards run out. */
  market: CardId[];
  players: PlayerState[];
  /** Whose turn it is; survives interrupts, unlike `phase.player`. */
  turn: { player: PlayerId; playsLeft: number };
  phase: Phase;
  log: LogEntry[];
}

export type Action =
  /** Take the top card of the deck. */
  | { type: 'draw' }
  /** Take a face-up Market card instead; the Market is refilled from the deck at once. */
  | { type: 'drawMarket'; card: CardId }
  /** `country` is given for a wild city, and only then: the country it is laid as. */
  | { type: 'lay'; card: CardId; country?: CountryId }
  /** Moves one of the player's laid wild cities to another of its countries. Free: uses no play. */
  | { type: 'reassign'; card: CardId; country: CountryId }
  /**
   * Play an action card for its effect; the card then goes to the discard pile.
   * `target` is the chosen opponent, for the cards that need one (Debt).
   * `country` is the chosen country of the player's own, for the cards that need one (Toll).
   */
  | { type: 'play'; card: CardId; target?: PlayerId; country?: CountryId }
  | { type: 'bank'; card: CardId }
  /** Hands one banked card or laid city to the receiver of the payment in progress. */
  | { type: 'pay'; card: CardId }
  | { type: 'endTurn' }
  | { type: 'discard'; card: CardId };

/**
 * What happened, in terms every player may see: an entry never names a card that is hidden from someone.
 * So far every action is public as it is; one that carries a hidden choice needs its own entry.
 */
export type LogEntry =
  | (Action & { player: PlayerId })
  /** The deck ran out: the discard pile was shuffled into a new deck. Logged before the action that needed a card. */
  | { type: 'reshuffle' }
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
  market: CardId[];
  turn: GameState['turn'];
  /** The pending prompt: who must act, and how. */
  phase: Phase;
  log: LogEntry[];
}
