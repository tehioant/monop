import { CARDS, countrySize, getCard, tollScale, type ActionId, type CardId, type CountryId } from './cards.ts';
import { RULES } from './data.ts';
import { shuffle } from './rng.ts';
import type {
  Action,
  CountryStack,
  GameOptions,
  GameSetup,
  GameState,
  PlayerId,
  PlayerState,
  PlayerView,
} from './types.ts';

export class IllegalActionError extends Error {
  override name = 'IllegalActionError';
}

export function createGame(options: GameOptions, seed: number, setup: GameSetup = {}): GameState {
  const { players, countriesToWin } = options;
  if (!RULES.playerCounts.includes(players)) throw new RangeError(`Unsupported number of players: ${players}`);
  if (!RULES.countriesToWin.includes(countriesToWin)) {
    throw new RangeError(`Unsupported countries to win: ${countriesToWin}`);
  }

  let rng = seed >>> 0;
  let deck: CardId[];
  if (setup.deck) {
    deck = [...setup.deck];
    deck.forEach(getCard); // throws on an unknown card
    if (new Set(deck).size !== deck.length) throw new Error('Setup deck has duplicate cards');
    if (deck.length < players * RULES.startingHand) throw new Error('Setup deck is too small to deal');
  } else {
    ({ items: deck, rng } = shuffle(CARDS.map((card) => card.id), rng));
  }

  const state: GameState = {
    options: { players, countriesToWin },
    rng,
    deck,
    discard: [],
    players: Array.from({ length: players }, () => ({
      hand: deck.splice(0, RULES.startingHand),
      bank: [],
      table: [],
    })),
    market: deck.splice(0, RULES.marketSize), // dealt after the hands
    turn: { player: 0, playsLeft: 0 },
    phase: { kind: 'play', player: 0 },
    log: [],
  };
  startTurn(state, 0);
  return state;
}

export function legalActions(state: GameState, player: PlayerId): Action[] {
  const { phase } = state;
  if (phase.kind === 'over' || phase.player !== player) return [];
  const { hand, table } = state.players[player]!;
  switch (phase.kind) {
    case 'draw': {
      const actions: Action[] = state.deck.length + state.discard.length > 0 ? [{ type: 'draw' }] : [];
      for (const card of state.market) actions.push({ type: 'drawMarket', card });
      return actions;
    }
    case 'play': {
      const actions: Action[] = [];
      if (state.turn.playsLeft > 0) {
        for (const card of hand) {
          const def = getCard(card);
          if (def.kind === 'city') actions.push({ type: 'lay', card });
          if (def.kind === 'wild') {
            for (const country of def.countries) actions.push({ type: 'lay', card, country });
          }
          if (def.kind === 'action') actions.push(...plays(state, player, card, def.action));
          actions.push({ type: 'bank', card });
        }
      }
      // The owner's laid wild cities can move to any other country they allow, without using a play.
      for (const stack of table) {
        for (const card of stack.cities) {
          const def = getCard(card);
          if (def.kind !== 'wild') continue;
          for (const country of def.countries) {
            if (country !== stack.country) actions.push({ type: 'reassign', card, country });
          }
        }
      }
      actions.push({ type: 'endTurn' });
      return actions;
    }
    case 'discard':
      return hand.map((card) => ({ type: 'discard', card }));
    case 'pay':
      return tableCards(state.players[player]!).map((card) => ({ type: 'pay', card }));
  }
}

/** Returns the next state. Throws `IllegalActionError` unless `action` is one of `legalActions(state, player)`. */
export function applyAction(state: GameState, player: PlayerId, action: Action): GameState {
  if (!legalActions(state, player).some((legal) => sameAction(legal, action))) {
    throw new IllegalActionError(`Illegal action for player ${player}: ${JSON.stringify(action)}`);
  }
  const next = clone(state);
  const me = next.players[player]!;
  /** A charge set off by the action. It resolves once the action is logged, so that its payments are logged after it. */
  let due: { receiver: PlayerId; debtors: readonly PlayerId[]; amount: number } | undefined;
  switch (action.type) {
    case 'draw':
      me.hand.push(drawCard(next)!);
      countDraw(next);
      break;
    case 'drawMarket': {
      remove(next.market, action.card);
      me.hand.push(action.card);
      const refill = drawCard(next);
      if (refill) next.market.push(refill);
      countDraw(next);
      break;
    }
    case 'lay': {
      const card = getCard(action.card);
      const country = card.kind === 'city' ? card.country : action.country;
      if (!country) throw new Error(`No country to lay ${card.id} in`);
      remove(me.hand, card.id);
      addCity(me, card.id, country);
      next.turn.playsLeft--;
      break;
    }
    case 'reassign':
      removeCity(me, action.card);
      addCity(me, action.card, action.country);
      break;
    case 'play': {
      const card = getCard(action.card);
      if (card.kind !== 'action') throw new Error(`Not an action card: ${card.id}`);
      remove(me.hand, card.id);
      next.turn.playsLeft--;
      switch (card.action) {
        case 'windfall':
          // Extra draws, from the deck only.
          for (let i = 0; i < RULES.windfallDraws; i++) {
            const drawn = drawCard(next);
            if (drawn) me.hand.push(drawn);
          }
          break;
        case 'levy':
          due = { receiver: player, debtors: opponents(next, player), amount: RULES.levyAmount };
          break;
        case 'debt':
          due = { receiver: player, debtors: [action.target!], amount: RULES.debtAmount };
          break;
        case 'toll': {
          const amount = tollAmount(me.table.find((stack) => stack.country === action.country)!);
          due = { receiver: player, debtors: opponents(next, player), amount };
          break;
        }
        case 'raid':
          transfer(next, action.target!, player, action.city!);
          break;
        case 'exchange':
          transfer(next, action.target!, player, action.take!);
          transfer(next, player, action.target!, action.give!);
          break;
        case 'seizure': {
          // The country changes hands as one stack, upgrades included. It joins the cities the taker already
          // has there, if any (possible with wild cities only).
          const { table } = next.players[action.target!]!;
          const [seized] = table.splice(table.findIndex((stack) => stack.country === action.country), 1);
          const mine = me.table.find((stack) => stack.country === action.country);
          if (mine) {
            mine.cities.push(...seized!.cities);
            mine.upgrades.push(...seized!.upgrades);
          } else me.table.push(seized!);
          break;
        }
        case 'upgrade':
          me.table.find((stack) => stack.country === action.country)!.upgrades.push(card.id);
          break;
      }
      // After the effect: a Windfall cannot draw itself back. An upgrade stays on the table instead.
      if (card.action !== 'upgrade') next.discard.push(card.id);
      break;
    }
    case 'pay': {
      const { phase } = next;
      if (phase.kind !== 'pay') throw new Error('No payment in progress');
      transfer(next, player, phase.receiver, action.card);
      phase.owed -= getCard(action.card).value;
      // No change is given: the payment is settled as soon as the amount is covered.
      if (phase.owed <= 0) due = { receiver: phase.receiver, debtors: phase.queue, amount: phase.amount };
      break;
    }
    case 'bank':
      remove(me.hand, action.card);
      me.bank.push(action.card);
      next.turn.playsLeft--;
      break;
    case 'endTurn':
      finishTurn(next);
      break;
    case 'discard':
      remove(me.hand, action.card);
      next.discard.push(action.card);
      finishTurn(next);
      break;
  }
  next.log.push({ ...action, player });
  if (due) charge(next, due.receiver, due.debtors, due.amount);
  checkGameOver(next);
  return next;
}

export function viewFor(state: GameState, player: PlayerId): PlayerView {
  const me = state.players[player];
  if (!me) throw new RangeError(`No such player: ${player}`);
  return {
    viewer: player,
    options: state.options,
    hand: me.hand,
    players: state.players.map((p) => ({
      handSize: p.hand.length,
      bank: p.bank,
      table: p.table.map((stack) => ({ ...stack, complete: isComplete(stack), toll: tollAmount(stack) })),
    })),
    deckSize: state.deck.length,
    discardTop: state.discard.at(-1) ?? null,
    market: state.market,
    turn: state.turn,
    phase: state.phase,
    log: state.log,
  };
}

/**
 * The ways to play one action card: a single action for a card that needs no target, else one action per
 * valid target, so none at all when there is nothing to aim it at.
 */
function plays(state: GameState, player: PlayerId, card: CardId, action: ActionId): Action[] {
  const others = opponents(state, player).map((target) => ({ target, them: state.players[target]! }));
  switch (action) {
    case 'debt':
      return others.map(({ target }) => ({ type: 'play', card, target }));
    case 'toll':
      // Played on a country the player holds a city in.
      return state.players[player]!.table.map(({ country }) => ({ type: 'play', card, country }));
    case 'raid':
      return others.flatMap(({ target, them }) =>
        looseCities(them).map((city): Action => ({ type: 'play', card, target, city })),
      );
    case 'exchange': {
      const mine = looseCities(state.players[player]!);
      return others.flatMap(({ target, them }) =>
        mine.flatMap((give) => looseCities(them).map((take): Action => ({ type: 'play', card, target, give, take }))),
      );
    }
    case 'seizure':
      return others.flatMap(({ target, them }) =>
        them.table.filter(isComplete).map((stack): Action => ({ type: 'play', card, target, country: stack.country })),
      );
    case 'upgrade':
      // Attached to a complete country of the player's own.
      return state.players[player]!.table
        .filter(isComplete)
        .map(({ country }): Action => ({ type: 'play', card, country }));
    default:
      return [{ type: 'play', card }];
  }
}

/** The cities a Raid or an Exchange may touch: those in incomplete countries. */
function looseCities(player: PlayerState): CardId[] {
  return player.table.flatMap((stack) => (isComplete(stack) ? [] : stack.cities));
}

function startTurn(state: GameState, player: PlayerId): void {
  state.turn = { player, playsLeft: RULES.playsPerTurn };
  const wanted = state.players[player]!.hand.length === 0 ? RULES.drawsOnEmptyHand : RULES.drawsPerTurn;
  // Every draw takes one card out of these three zones, so the count stays right for the whole draw phase.
  const draws = Math.min(wanted, state.deck.length + state.discard.length + state.market.length);
  state.phase = draws > 0 ? { kind: 'draw', player, remaining: draws } : { kind: 'play', player };
}

/** The turn passes to the next seat once its player is down to the hand limit. */
function finishTurn(state: GameState): void {
  const { player } = state.turn;
  if (state.players[player]!.hand.length > RULES.handLimit) state.phase = { kind: 'discard', player };
  else startTurn(state, (player + 1) % state.players.length);
}

/** The other players, in turn order starting after `player`. */
function opponents(state: GameState, player: PlayerId): PlayerId[] {
  const seats = state.players.length;
  return Array.from({ length: seats - 1 }, (_, i) => (player + 1 + i) % seats);
}

/**
 * Makes each of `debtors` pay `amount` to `receiver`, one after the other, then hands the game back to the
 * turn player. A debtor whose table is worth more than the amount chooses what to pay with in a `pay` phase.
 * Any other has no choice to make: their whole table is paid at once, and they owe nothing more.
 */
function charge(state: GameState, receiver: PlayerId, debtors: readonly PlayerId[], amount: number): void {
  for (const [i, debtor] of debtors.entries()) {
    if (findWinner(state) >= 0) return; // a received city ended the game: nobody else pays
    const player = state.players[debtor]!;
    // Attached upgrades count, after the cities: they are in the bank once their country has lost a city.
    const cards = [...tableCards(player), ...player.table.flatMap((stack) => stack.upgrades)];
    if (cards.reduce((sum, card) => sum + getCard(card).value, 0) > amount) {
      state.phase = { kind: 'pay', player: debtor, receiver, owed: amount, amount, queue: debtors.slice(i + 1) };
      return;
    }
    for (const card of cards) {
      state.log.push({ type: 'pay', card, player: debtor });
      transfer(state, debtor, receiver, card);
    }
  }
  state.phase = { kind: 'play', player: state.turn.player };
}

/** What a player can pay with: their banked cards and laid cities, never their hand. */
function tableCards(player: PlayerState): CardId[] {
  return [...player.bank, ...player.table.flatMap((stack) => stack.cities)];
}

/**
 * Moves a card between two tables: a banked card to the bank, a laid city to its country. A wild city stays in
 * the country it was laid as; its new owner is free to move it in their own play phase: at once for the player
 * whose turn it is (a payment received, a Raid, an Exchange), on their next turn for the target of an Exchange.
 */
function transfer(state: GameState, from: PlayerId, to: PlayerId, card: CardId): void {
  const payer = state.players[from]!;
  const receiver = state.players[to]!;
  if (payer.bank.includes(card)) {
    remove(payer.bank, card);
    receiver.bank.push(card);
    return;
  }
  addCity(receiver, card, removeCity(payer, card));
}

/** Lays a city on a player's table, in the given country: its own, or for a wild city one of those it allows. */
function addCity(player: PlayerState, city: CardId, country: CountryId): void {
  let stack = player.table.find((s) => s.country === country);
  if (!stack) player.table.push((stack = { country, cities: [], upgrades: [] }));
  stack.cities.push(city);
}

/**
 * Takes a laid city off a player's table and returns the country it was in. A country that is no longer
 * complete loses its upgrades: they move to the player's bank, as coin.
 */
function removeCity(player: PlayerState, city: CardId): CountryId {
  const stack = player.table.find((s) => s.cities.includes(city))!;
  remove(stack.cities, city);
  if (!isComplete(stack)) player.bank.push(...stack.upgrades.splice(0));
  if (stack.cities.length === 0) player.table.splice(player.table.indexOf(stack), 1);
  return stack.country;
}

/** One of the turn's draws is done; after the last one the plays begin. */
function countDraw(state: GameState): void {
  const { phase } = state;
  if (phase.kind === 'draw' && --phase.remaining === 0) state.phase = { kind: 'play', player: phase.player };
}

/** Takes the top card of the deck. An empty deck is first rebuilt by shuffling the discard pile. */
function drawCard(state: GameState): CardId | undefined {
  if (state.deck.length === 0 && state.discard.length > 0) {
    ({ items: state.deck, rng: state.rng } = shuffle(state.discard, state.rng));
    state.discard = [];
    state.log.push({ type: 'reshuffle' });
  }
  return state.deck.shift();
}

/** Wild cities count toward the size, but a country needs at least one city of its own. */
function isComplete(stack: CountryStack): boolean {
  return (
    stack.cities.length >= countrySize(stack.country) && stack.cities.some((card) => getCard(card).kind === 'city')
  );
}

/**
 * What a Toll on this country charges each opponent: the amount on the country's toll scale for the holder's
 * progress in it, plus its upgrades. The only place the amount is worked out.
 */
function tollAmount(stack: CountryStack): number {
  const scale = tollScale(stack.country);
  // The top of the scale is for a complete country only, however many cities the stack holds.
  const level = isComplete(stack) ? scale.length : Math.min(stack.cities.length, scale.length - 1);
  return scale[level - 1]! + stack.upgrades.length * RULES.upgradeToll;
}

/** Runs after every state change: a win ends the game at once; so does running out of cards to draw and play. */
function checkGameOver(state: GameState): void {
  const winner = findWinner(state);
  if (winner >= 0) endGame(state, winner);
  // Only between plays: an interrupt in progress (a payment) is settled first, as it can still produce a winner.
  else if (
    state.phase.kind === 'play' &&
    state.deck.length === 0 &&
    state.discard.length === 0 &&
    state.market.length === 0 &&
    state.players.every((p) => p.hand.length === 0)
  ) {
    endGame(state, null);
  }
}

/**
 * The player who controls enough complete countries, or -1. When one action gets two players there
 * (an Exchange), the one whose turn it is wins.
 */
function findWinner(state: GameState): PlayerId {
  const wins = (p: PlayerState) => p.table.filter(isComplete).length >= state.options.countriesToWin;
  const { player } = state.turn;
  return wins(state.players[player]!) ? player : state.players.findIndex(wins);
}

function endGame(state: GameState, winner: PlayerId | null): void {
  state.phase = { kind: 'over', winner };
  state.log.push({ type: 'gameOver', winner });
}

function sameAction(legal: Action, action: unknown): boolean {
  if (typeof action !== 'object' || action === null) return false;
  const keys = Object.keys(legal);
  return (
    keys.length === Object.keys(action).length &&
    keys.every((key) => (legal as Record<string, unknown>)[key] === (action as Record<string, unknown>)[key])
  );
}

function remove(cards: CardId[], card: CardId): void {
  cards.splice(cards.indexOf(card), 1);
}

/** A copy that `applyAction` may mutate: everything is copied except log entries, which never change. */
function clone(state: GameState): GameState {
  return {
    options: state.options,
    rng: state.rng,
    deck: [...state.deck],
    discard: [...state.discard],
    market: [...state.market],
    players: state.players.map(
      (p): PlayerState => ({
        hand: [...p.hand],
        bank: [...p.bank],
        table: p.table.map((stack) => ({
          country: stack.country,
          cities: [...stack.cities],
          upgrades: [...stack.upgrades],
        })),
      }),
    ),
    turn: { ...state.turn },
    phase: { ...state.phase },
    log: [...state.log],
  };
}
