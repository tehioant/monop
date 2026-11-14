import type { CardId, CountryId, PerkId } from './cards.ts';

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
  /** The upgrades attached to the country, each raising its toll. Only a complete country has any. */
  upgrades: CardId[];
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
  /**
   * An action card of the turn player is about to hit `target`, and `player` may answer with a Veto or decline.
   * `target` is asked first, then the turn player and `target` by turns, each only while they hold a Veto.
   * `vetoes` counts the Vetoes played so far: an odd number cancels the card for `target`, and for nobody else.
   * `queue` lists the opponents the card hits next, in order.
   */
  | { kind: 'veto'; player: PlayerId; target: PlayerId; vetoes: number; effect: Effect; queue: PlayerId[] }
  | { kind: 'over'; winner: PlayerId | null };

/**
 * What an action card does to one opponent it hits: charges them `amount`, or takes from them what the Raid,
 * Exchange or Seizure played as `take` names.
 */
export type Effect = { amount: number } | { take: Play };

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
  /**
   * Whose turn it is, and the plays they have made in it; survives interrupts, unlike `phase.player`.
   * The plays left are not kept: the number allowed can change during the turn (the `extraPlay` perk).
   */
  turn: { player: PlayerId; played: number };
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
   * Play an action card for its effect; the card then goes to the discard pile, except an upgrade, which stays
   * attached to its country.
   * A Veto is played with no other field, and only in answer to a card: in a `veto` phase, never as a turn's play.
   * The other fields say what the card is aimed at, and are present only for the cards that need them:
   * `target` is the chosen opponent (Debt, Raid, Exchange, Seizure);
   * `country` is the chosen country: one of the player's own for a Toll or an upgrade, the one a Seizure takes
   * from `target`;
   * `city` is the city a Raid takes from `target`;
   * `give` and `take` are the cities an Exchange swaps, the player's own for one of `target`'s.
   */
  | {
      type: 'play';
      card: CardId;
      target?: PlayerId;
      country?: CountryId;
      city?: CardId;
      give?: CardId;
      take?: CardId;
    }
  | { type: 'bank'; card: CardId }
  /** Hands one banked card or laid city to the receiver of the payment in progress. */
  | { type: 'pay'; card: CardId }
  /** Lets the card at stake in a `veto` phase go on, rather than answer it with a Veto. */
  | { type: 'decline' }
  | { type: 'endTurn' }
  | { type: 'discard'; card: CardId };

export type Play = Extract<Action, { type: 'play' }>;

/**
 * What happened, in terms every player may see: an entry never names a card that is hidden from someone.
 * So far every action is public as it is; one that carries a hidden choice needs its own entry.
 */
export type LogEntry =
  | (Action & { player: PlayerId })
  /** The deck ran out: the discard pile was shuffled into a new deck. Logged before the action that needed a card. */
  | { type: 'reshuffle' }
  /** The Veto `player` has just played went back to their hand, not to the discard pile (the `vetoReturn` perk). */
  | { type: 'return'; card: CardId; player: PlayerId }
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
    /** `toll` is what a Toll played on the country would charge each opponent now, upgrades included. */
    table: (CountryStack & { complete: boolean; toll: number })[];
  }[];
  deckSize: number;
  discardTop: CardId | null;
  market: CardId[];
  /**
   * Every country's perk, in card data order, and the players it is active for: those who hold the country
   * complete, for as long as they do. (Two players can, with wild cities.)
   */
  perks: { country: CountryId; perk: PerkId; activeFor: PlayerId[] }[];
  /** Whose turn it is, and how many more cards they may play in it. */
  turn: { player: PlayerId; playsLeft: number };
  /** The pending prompt: who must act, and how. */
  phase: Phase;
  log: LogEntry[];
}
