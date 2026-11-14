import {
  CARDS,
  countryPerk,
  countrySize,
  getCard,
  tollScale,
  type ActionId,
  type CardId,
  type CountryId,
  type PerkId,
} from './cards.ts';
import { COUNTRIES, RULES } from './data.ts';
import { shuffle } from './rng.ts';
import type {
  Action,
  CountryStack,
  Effect,
  GameOptions,
  GameSetup,
  GameState,
  Play,
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
    turn: { player: 0, played: 0 },
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
      if (playsLeft(state) > 0) {
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
    case 'veto':
      return [...hand.filter(isVeto).map((card): Action => ({ type: 'play', card })), { type: 'decline' }];
  }
}

/** Returns the next state. Throws `IllegalActionError` unless `action` is one of `legalActions(state, player)`. */
export function applyAction(state: GameState, player: PlayerId, action: Action): GameState {
  if (!legalActions(state, player).some((legal) => sameAction(legal, action))) {
    throw new IllegalActionError(`Illegal action for player ${player}: ${JSON.stringify(action)}`);
  }
  const next = clone(state);
  const me = next.players[player]!;
  /** What the action sets off. It runs once the action is logged, so that the payments it makes are logged after it. */
  let after = () => {};
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
      next.turn.played++;
      break;
    }
    case 'reassign':
      remove(me.table.find((stack) => stack.cities.includes(action.card))!.cities, action.card);
      me.table = me.table.filter((stack) => stack.cities.length > 0);
      addCity(me, action.card, action.country);
      break;
    case 'play': {
      const card = getCard(action.card);
      if (card.kind !== 'action') throw new Error(`Not an action card: ${card.id}`);
      remove(me.hand, card.id);
      // A Veto answers a card: it is not one of the turn's plays.
      if (card.action !== 'veto') next.turn.played++;
      switch (card.action) {
        case 'windfall':
          // Extra draws, from the deck only.
          for (let i = 0; i < RULES.windfallDraws; i++) {
            const drawn = drawCard(next);
            if (drawn) me.hand.push(drawn);
          }
          break;
        case 'levy':
          after = () => hit(next, { amount: RULES.levyAmount }, opponents(next, player));
          break;
        case 'debt':
          after = () => hit(next, { amount: RULES.debtAmount }, [action.target!]);
          break;
        case 'toll': {
          const amount = tollAmount(me.table.find((stack) => stack.country === action.country)!);
          after = () => hit(next, { amount }, opponents(next, player));
          break;
        }
        case 'raid':
        case 'exchange':
        case 'seizure':
          after = () => hit(next, { take: action }, [action.target!]);
          break;
        case 'veto': {
          // Perk: the first Veto a player plays in the game goes back to their hand.
          const returns =
            hasPerk(me, 'vetoReturn') &&
            !next.log.some((entry) => entry.type === 'play' && entry.player === player && isVeto(entry.card));
          after = () => {
            if (returns) {
              me.hand.push(next.discard.pop()!);
              next.log.push({ type: 'return', card: card.id, player });
            }
            answer(next, true);
          };
          break;
        }
      }
      next.discard.push(card.id); // after the effect: a Windfall cannot draw itself back
      break;
    }
    case 'decline':
      after = () => answer(next, false);
      break;
    case 'pay': {
      const { phase } = next;
      if (phase.kind !== 'pay') throw new Error('No payment in progress');
      transfer(next, player, phase.receiver, action.card);
      phase.owed -= getCard(action.card).value;
      // No change is given: the payment is settled as soon as the amount is covered.
      if (phase.owed <= 0) after = () => hit(next, { amount: phase.amount }, phase.queue);
      break;
    }
    case 'bank':
      remove(me.hand, action.card);
      me.bank.push(action.card);
      next.turn.played++;
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
  after();
  checkGameOver(next);
  return next;
}

export function viewFor(state: GameState, player: PlayerId): PlayerView {
  const me = state.players[player];
  if (!me) throw new RangeError(`No such player: ${player}`);
  const players = state.players.map((p) => ({
    handSize: p.hand.length,
    bank: p.bank,
    table: p.table.map((stack) => ({ ...stack, complete: isComplete(stack) })),
  }));
  // A perk is active for the players who hold its country complete.
  const perks = COUNTRIES.map(({ id, perk }) => ({ country: id, perk, activeFor: [] as PlayerId[] }));
  players.forEach((p, seat) => {
    for (const stack of p.table) {
      if (stack.complete) perks.find((entry) => entry.country === stack.country)!.activeFor.push(seat);
    }
  });
  return {
    viewer: player,
    options: state.options,
    hand: me.hand,
    players,
    deckSize: state.deck.length,
    discardTop: state.discard.at(-1) ?? null,
    market: state.market,
    perks,
    turn: { player: state.turn.player, playsLeft: playsLeft(state) },
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
    case 'veto':
      return []; // only ever an answer, in a `veto` phase
    default:
      return [{ type: 'play', card }];
  }
}

/** The cities a Raid or an Exchange may touch: those in incomplete countries. */
function looseCities(player: PlayerState): CardId[] {
  return player.table.flatMap((stack) => (isComplete(stack) ? [] : stack.cities));
}

function startTurn(state: GameState, player: PlayerId): void {
  state.turn = { player, played: 0 };
  const me = state.players[player]!;
  const usual = hasPerk(me, 'extraDraw') ? RULES.drawsWithPerk : RULES.drawsPerTurn;
  const wanted = me.hand.length === 0 ? RULES.drawsOnEmptyHand : usual;
  // Every draw takes one card out of these three zones, so the count stays right for the whole draw phase.
  const draws = Math.min(wanted, state.deck.length + state.discard.length + state.market.length);
  state.phase = draws > 0 ? { kind: 'draw', player, remaining: draws } : { kind: 'play', player };
}

/**
 * How many more cards the turn player may play. Worked out from the plays made, as the number allowed changes
 * as soon as the perk is gained or lost, in the middle of a turn too.
 */
function playsLeft(state: GameState): number {
  const { player, played } = state.turn;
  const allowed = hasPerk(state.players[player]!, 'extraPlay') ? RULES.playsWithPerk : RULES.playsPerTurn;
  return Math.max(0, allowed - played);
}

/** A perk is active for a player only while they hold a complete country that gives it. */
function hasPerk(player: PlayerState, perk: PerkId): boolean {
  return player.table.some((stack) => isComplete(stack) && countryPerk(stack.country) === perk);
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
 * Applies the effect of the turn player's action card to each of `targets`, one after the other, then hands the
 * game back to the turn player. A target who holds a Veto is first asked for it in a `veto` phase, unless
 * `answered` says that the first target has just been through that.
 *
 * A charged target whose table is worth more than the amount chooses what to pay with in a `pay` phase.
 * Any other has no choice to make: their whole table is paid at once, and they owe nothing more.
 */
function hit(state: GameState, effect: Effect, targets: readonly PlayerId[], answered = false): void {
  const receiver = state.turn.player;
  for (const [i, target] of targets.entries()) {
    if (findWinner(state) >= 0) return; // a received city ended the game: nobody else is hit
    const queue = targets.slice(i + 1);
    if (!(answered && i === 0) && state.players[target]!.hand.some(isVeto)) {
      state.phase = { kind: 'veto', player: target, target, vetoes: 0, effect, queue };
      return;
    }
    if ('take' in effect) {
      take(state, effect.take);
      continue;
    }
    const { amount } = effect;
    const cards = tableCards(state.players[target]!);
    if (cards.reduce((sum, card) => sum + getCard(card).value, 0) > amount) {
      state.phase = { kind: 'pay', player: target, receiver, owed: amount, amount, queue };
      return;
    }
    for (const card of cards) {
      state.log.push({ type: 'pay', card, player: target });
      transfer(state, target, receiver, card);
    }
  }
  state.phase = { kind: 'play', player: receiver };
}

/**
 * The awaited player has answered the card at stake in the `veto` phase: with a Veto, or by declining.
 * A Veto hands the question to the other side, if they hold one to answer with. Otherwise the chain ends,
 * and the card goes on to its next targets, after hitting this one unless the last word was a Veto against it.
 */
function answer(state: GameState, vetoed: boolean): void {
  const { phase } = state;
  if (phase.kind !== 'veto') throw new Error('No card to answer');
  const vetoes = phase.vetoes + Number(vetoed);
  const other = phase.player === phase.target ? state.turn.player : phase.target;
  if (vetoed && state.players[other]!.hand.some(isVeto)) {
    state.phase = { ...phase, player: other, vetoes };
    return;
  }
  // Each Veto cancels the one before it, so an odd number of them stops the card.
  const stopped = vetoes % 2 === 1;
  hit(state, phase.effect, stopped ? phase.queue : [phase.target, ...phase.queue], !stopped);
}

function isVeto(card: CardId): boolean {
  const def = getCard(card);
  return def.kind === 'action' && def.action === 'veto';
}

/** The turn player's Raid, Exchange or Seizure, played as `action`, takes what it names from its target. */
function take(state: GameState, action: Play): void {
  const card = getCard(action.card);
  const player = state.turn.player;
  const target = action.target!;
  switch (card.kind === 'action' && card.action) {
    case 'raid':
      transfer(state, target, player, action.city!);
      break;
    case 'exchange':
      transfer(state, target, player, action.take!);
      transfer(state, player, target, action.give!);
      break;
    case 'seizure': {
      // The country changes hands as one stack. It joins the cities the taker already has there, if any
      // (possible with wild cities only).
      const me = state.players[player]!;
      const { table } = state.players[target]!;
      const [seized] = table.splice(table.findIndex((stack) => stack.country === action.country), 1);
      const mine = me.table.find((stack) => stack.country === action.country);
      if (mine) mine.cities.push(...seized!.cities);
      else me.table.push(seized!);
      break;
    }
  }
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
  const stack = payer.table.find((s) => s.cities.includes(card))!;
  remove(stack.cities, card);
  if (stack.cities.length === 0) payer.table.splice(payer.table.indexOf(stack), 1);
  addCity(receiver, card, stack.country);
}

/** Lays a city on a player's table, in the given country: its own, or for a wild city one of those it allows. */
function addCity(player: PlayerState, city: CardId, country: CountryId): void {
  let stack = player.table.find((s) => s.country === country);
  if (!stack) player.table.push((stack = { country, cities: [] }));
  stack.cities.push(city);
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
 * What a Toll on this country charges each opponent, from the country's toll scale and the holder's progress
 * in it. The only place the amount is worked out.
 */
function tollAmount(stack: CountryStack): number {
  const scale = tollScale(stack.country);
  // The top of the scale is for a complete country only, however many cities the stack holds.
  const level = isComplete(stack) ? scale.length : Math.min(stack.cities.length, scale.length - 1);
  return scale[level - 1]!;
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
        table: p.table.map((stack) => ({ country: stack.country, cities: [...stack.cities] })),
      }),
    ),
    turn: { ...state.turn },
    phase: { ...state.phase },
    log: [...state.log],
  };
}
