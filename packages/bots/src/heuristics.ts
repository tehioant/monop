// How a bot rates each legal action, from a player's view only. No randomness here.

import {
  COUNTRIES,
  getCard,
  RULES,
  type Action,
  type ActionId,
  type CardId,
  type CountryId,
  type Play,
  type PlayerId,
  type PlayerView,
} from '@atlas/engine';

/**
 * How much of the game a bot takes into account:
 * 0 — its own cities and cards only;
 * 1 — also what each opponent has on the table: what a charge would bring in, what a take costs them, and the
 *     cheapest way to pay;
 * 2 — also who is closest to winning (it goes after the leader), how safe its bank is, and keeping its last
 *     Veto for a Seizure.
 */
export type Depth = 0 | 1 | 2;

/** The cities laid in each country of one player. */
type Table = ReadonlyMap<CountryId, readonly CardId[]>;

// All in the same unit, the worth of a table.
const WIN = 1000;
const COMPLETE = 10;
/** An incomplete country is worth this times the square of the share of its cities laid: gathering pays. */
const PARTIAL = 6;
/** One coin in the bank. */
const COIN = 0.3;
/** One coin's worth of cities received as payment. */
const PAID_CITY = 0.8;
/** An unseen card from the deck: about what a card is worth on average. */
const DECK = 2.5;
/** Below this bank a single charge can cost cities (depth 2). */
const SAFE_BANK = RULES.debtAmount;
/** What an action card is worth in hand, whether or not it can be played now. */
const KEEP: Record<ActionId, number> = {
  seizure: 8,
  veto: 6,
  raid: 4,
  debt: 3,
  windfall: 3,
  levy: 2,
  exchange: 2,
  toll: 1,
  upgrade: 0.5,
};

const SIZES = new Map<CountryId, number>(COUNTRIES.map((country) => [country.id, country.cities.length]));

/** The rule: wild cities count toward the size, but a country needs one city of its own. */
function isComplete(country: CountryId, cities: readonly CardId[]): boolean {
  return cities.length >= SIZES.get(country)! && cities.some((card) => getCard(card).kind === 'city');
}

function worth(table: Table, countriesToWin: number): number {
  let total = 0;
  let complete = 0;
  for (const [country, cities] of table) {
    const size = SIZES.get(country)!;
    if (isComplete(country, cities)) {
      complete++;
      total += COMPLETE;
    } else total += PARTIAL * (Math.min(cities.length, size - 1) / size) ** 2;
  }
  return complete >= countriesToWin ? WIN : total;
}

/** The table once `card` has left it and, when `to` is given, is laid in that country. */
function moved(table: Table, card: CardId, to?: CountryId): Table {
  const next = new Map<CountryId, readonly CardId[]>();
  for (const [country, cities] of table) next.set(country, cities.filter((city) => city !== card));
  if (to) next.set(to, [...(next.get(to) ?? []), card]);
  return next;
}

function countryOf(table: Table, city: CardId): CountryId {
  for (const [country, cities] of table) if (cities.includes(city)) return country;
  throw new Error(`${city} is not on that table`);
}

function value(cards: readonly CardId[]): number {
  return cards.reduce((sum, card) => sum + getCard(card).value, 0);
}

function isVeto(card: CardId): boolean {
  const def = getCard(card);
  return def.kind === 'action' && def.action === 'veto';
}

/**
 * Rates the legal actions of the player whose view this is: the higher the better. Ending the turn and
 * declining are 0, so anything rated below is left undone. Moving a wild city is rated above 0 only when the
 * table is worth more after it, so a bot cannot move one back and forth.
 */
export function rate(view: PlayerView, depth: Depth): (action: Action) => number {
  const { viewer: me, phase, hand } = view;
  const tables = view.players.map((player): Table => new Map(player.table.map((s) => [s.country, s.cities])));
  const mine = tables[me]!;
  const worthOf = (table: Table) => worth(table, view.options.countriesToWin);
  const gain = (after: Table, before: Table = mine) => worthOf(after) - worthOf(before);
  const opponents = view.players.map((_, seat) => seat).filter((seat) => seat !== me);
  /** 0 to 1: how close an opponent is to winning. */
  const lead = (player: PlayerId) => Math.min(1, worthOf(tables[player]!) / (COMPLETE * view.options.countriesToWin));
  /** What a loss of an opponent's is worth to the bot, per unit of their table. */
  const denial = (player: PlayerId) => [0, 0.3, 0.3 + 2 * lead(player)][depth]!;

  /** What a Raid, an Exchange or a Seizure changes for the player of the card and for its target. */
  const take = (taker: PlayerId, action: Play): { taker: number; target: number } => {
    const before = tables[taker]!;
    const theirs = tables[action.target!]!;
    let after: Table;
    let left: Table;
    if (action.city) {
      after = moved(before, action.city, countryOf(theirs, action.city));
      left = moved(theirs, action.city);
    } else if (action.give && action.take) {
      after = moved(moved(before, action.give), action.take, countryOf(theirs, action.take));
      left = moved(moved(theirs, action.take), action.give, countryOf(before, action.give));
    } else {
      const country = action.country!;
      after = new Map(before).set(country, [...(before.get(country) ?? []), ...theirs.get(country)!]);
      left = new Map([...theirs].filter(([theirCountry]) => theirCountry !== country));
    }
    return { taker: gain(after, before), target: gain(left, theirs) };
  };

  /** What charging an opponent brings in: coin while their bank lasts, then cities. */
  const charge = (target: PlayerId, amount: number): number => {
    if (depth === 0) return COIN * amount; // counts on being paid in full
    const { bank, table } = view.players[target]!;
    const coin = Math.min(amount, value(bank));
    const cities = Math.min(amount - coin, value(table.flatMap((stack) => stack.cities)));
    return (COIN * coin + PAID_CITY * cities) * (depth === 2 ? 1 + lead(target) : 1);
  };
  const chargeAll = (amount: number) => opponents.reduce((sum, target) => sum + charge(target, amount), 0);

  const myStacks = view.players[me]!.table;
  const myBank = view.players[me]!.bank;
  /** What giving up a banked card or a laid city costs. */
  const cost = (card: CardId) =>
    COIN * getCard(card).value + (myBank.includes(card) ? 0 : 1 - gain(moved(mine, card)));
  const payable = [...myBank, ...myStacks.flatMap((stack) => stack.cities)];
  /** The cheapest cards worth `amount` together, or everything payable when that is not enough. */
  const payment = (amount: number): { cost: number; cards: CardId[] } => {
    // best[v]: the cheapest cards worth at least v.
    const best: ({ cost: number; cards: CardId[] } | undefined)[] = [{ cost: 0, cards: [] }];
    for (const card of payable) {
      for (let v = amount; v >= 1; v--) {
        const rest = best[Math.max(0, v - getCard(card).value)];
        const known = best[v];
        if (rest && !(known && known.cost <= rest.cost + cost(card))) {
          best[v] = { cost: rest.cost + cost(card), cards: [...rest.cards, card] };
        }
      }
    }
    return best[amount] ?? { cost: payable.reduce((sum, card) => sum + cost(card), 0), cards: payable };
  };

  /** What a card is worth in hand. Cities are rated with those already in hand laid. */
  const planned = hand.reduce((table, card) => {
    const def = getCard(card);
    return def.kind === 'city' ? moved(table, card, def.country) : table;
  }, mine);
  const want = (id: CardId): number => {
    const card = getCard(id);
    switch (card.kind) {
      case 'coin':
        return COIN * card.value;
      case 'city':
        return 1 + gain(moved(planned, id, card.country), moved(planned, id));
      case 'wild':
        return 1.5 + Math.max(...card.countries.map((c) => gain(moved(planned, id, c), moved(planned, id))));
      case 'action':
        switch (card.action) {
          case 'toll':
            return KEEP.toll + 0.4 * Math.max(0, ...myStacks.map((stack) => stack.toll));
          case 'upgrade':
            return KEEP.upgrade + (myStacks.some((stack) => stack.complete) ? 1.5 : 0);
          case 'veto':
            return KEEP.veto + (depth === 2 ? 3 : 0);
          default:
            return KEEP[card.action];
        }
    }
  };

  const played = (action: Play): number => {
    const card = getCard(action.card);
    switch (card.kind === 'action' && card.action) {
      case 'windfall':
        // First, so that the rest of the turn is chosen with the new cards in hand.
        return view.deckSize > 0 || view.discardTop !== null ? 6 : -1;
      case 'levy':
        return chargeAll(RULES.levyAmount) - 0.5;
      case 'debt':
        return charge(action.target!, RULES.debtAmount) - 0.5;
      case 'toll':
        return chargeAll(myStacks.find((stack) => stack.country === action.country)!.toll) - 0.5;
      case 'upgrade':
        return 1.5 + 0.1 * myStacks.find((stack) => stack.country === action.country)!.toll;
      case 'raid':
      case 'exchange':
      case 'seizure': {
        const change = take(me, action);
        // An Exchange gives a city away: it has to be worth it.
        return change.taker - denial(action.target!) * change.target + (action.give ? -0.5 : 1);
      }
      default:
        return 0;
    }
  };

  /** In a `veto` phase: what the card at stake is worth stopping, or forcing through, less what a Veto is kept for. */
  const veto = (): number => {
    if (phase.kind !== 'veto') return 0;
    const { effect, target } = phase;
    let stake: number;
    if ('take' in effect) {
      const change = take(view.turn.player, effect.take);
      if (target !== me) stake = change.taker - denial(target) * change.target;
      else stake = change.taker >= WIN / 2 && depth > 0 ? WIN : 1 - change.target;
    } else stake = target === me ? payment(effect.amount).cost : charge(target, effect.amount);
    if (depth === 0) return stake - 0.1; // spends its Veto on whatever comes first
    // The first Veto a player plays comes back to them while they hold a country with that perk.
    const free =
      view.perks.some((entry) => entry.perk === 'vetoReturn' && entry.activeFor.includes(me)) &&
      !view.log.some((entry) => entry.type === 'play' && entry.player === me && isVeto(entry.card));
    if (depth === 1 || free || hand.filter(isVeto).length > 1) return stake - 1.2;
    // The last one is kept for a Seizure while there is a complete country to lose.
    return stake - (myStacks.some((stack) => stack.complete) ? 6 : 2.5);
  };

  // A card over the hand limit is better banked than discarded. And once no card is left to draw, a card kept
  // in hand is kept for ever: if every player did that, the game would never end.
  const drawsLeft = view.deckSize > 0 || view.discardTop !== null || view.market.length > 0;
  const mustPlay = view.turn.playsLeft > 0 && (hand.length > RULES.handLimit || (!drawsLeft && hand.length > 0));
  const unsafe = depth === 2 && value(myBank) < SAFE_BANK;
  const paying = phase.kind === 'pay' && depth > 0 ? payment(phase.owed).cards : [];

  return (action) => {
    switch (action.type) {
      case 'draw':
        return DECK;
      case 'drawMarket':
        return want(action.card);
      case 'lay': {
        const card = getCard(action.card);
        return 1 + gain(moved(mine, card.id, card.kind === 'city' ? card.country : action.country));
      }
      case 'reassign':
        // A move that changes nothing must rate below ending the turn.
        return gain(moved(mine, action.card, action.country)) - 0.01;
      case 'bank': {
        const card = getCard(action.card);
        const coin = COIN * card.value + (unsafe ? 2 : 0);
        if (card.kind === 'coin') return 0.5 + coin;
        // A city is laid, never banked; an action card is banked only when it is worth more as coin.
        return card.kind === 'action' ? coin - want(card.id) : -WIN / 2;
      }
      case 'play':
        return phase.kind === 'veto' ? veto() : played(action);
      case 'pay':
        return paying.includes(action.card) ? 1 : -cost(action.card);
      case 'discard':
        return -want(action.card);
      case 'endTurn':
        return mustPlay ? -WIN : 0;
      default:
        return 0;
    }
  };
}
