import { CARDS, countrySize, getCard, type CardId } from './cards.ts';
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
  const { hand, bank, table } = state.players[player]!;
  switch (phase.kind) {
    case 'draw':
      return [{ type: 'draw' }];
    case 'play': {
      const actions: Action[] = [];
      if (state.turn.playsLeft > 0) {
        for (const card of hand) {
          const { kind } = getCard(card);
          if (kind === 'city') actions.push({ type: 'lay', card });
          if (kind === 'levy') actions.push({ type: 'play', card });
          if (kind === 'debt') {
            for (const target of opponents(state, player)) actions.push({ type: 'play', card, target });
          }
          actions.push({ type: 'bank', card });
        }
      }
      actions.push({ type: 'endTurn' });
      return actions;
    }
    case 'discard':
      return hand.map((card) => ({ type: 'discard', card }));
    case 'pay':
      return [...bank, ...table.flatMap((stack) => stack.cities)].map((card) => ({ type: 'pay', card }));
  }
}

/** Returns the next state. Throws `IllegalActionError` unless `action` is one of `legalActions(state, player)`. */
export function applyAction(state: GameState, player: PlayerId, action: Action): GameState {
  if (!legalActions(state, player).some((legal) => sameAction(legal, action))) {
    throw new IllegalActionError(`Illegal action for player ${player}: ${JSON.stringify(action)}`);
  }
  const next = clone(state);
  const me = next.players[player]!;
  next.log.push({ ...action, player });
  switch (action.type) {
    case 'draw': {
      me.hand.push(next.deck.shift()!);
      const { phase } = next;
      if (phase.kind === 'draw' && --phase.remaining === 0) next.phase = { kind: 'play', player };
      break;
    }
    case 'lay':
      remove(me.hand, action.card);
      addCity(me, action.card);
      next.turn.playsLeft--;
      break;
    case 'play': {
      const card = getCard(action.card);
      if (card.kind !== 'levy' && card.kind !== 'debt') throw new Error(`Not an action card: ${card.id}`);
      remove(me.hand, card.id);
      next.discard.push(card.id);
      next.turn.playsLeft--;
      charge(next, player, card.kind === 'levy' ? opponents(next, player) : [action.target!], card.amount);
      break;
    }
    case 'pay': {
      const { phase } = next;
      if (phase.kind !== 'pay') throw new Error('No payment in progress');
      transfer(next, player, phase.receiver, action.card);
      phase.owed -= getCard(action.card).value;
      // No change is given: the payment is settled as soon as the amount is covered.
      if (phase.owed <= 0) charge(next, phase.receiver, phase.queue, phase.amount);
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
      table: p.table.map((stack) => ({ ...stack, complete: isComplete(stack) })),
    })),
    deckSize: state.deck.length,
    discardTop: state.discard.at(-1) ?? null,
    turn: state.turn,
    phase: state.phase,
    log: state.log,
  };
}

function startTurn(state: GameState, player: PlayerId): void {
  state.turn = { player, playsLeft: RULES.playsPerTurn };
  const draws = Math.min(RULES.drawsPerTurn, state.deck.length);
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
    const { bank, table } = state.players[debtor]!;
    const cards = [...bank, ...table.flatMap((stack) => stack.cities)];
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

/** Moves a card between two tables: a banked card to the bank, a laid city to its country. */
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
  addCity(receiver, card);
}

/** Lays a city on a player's table, in its country. */
function addCity(player: PlayerState, city: CardId): void {
  const card = getCard(city);
  if (card.kind !== 'city') throw new Error(`Not a city: ${city}`);
  let stack = player.table.find((s) => s.country === card.country);
  if (!stack) player.table.push((stack = { country: card.country, cities: [] }));
  stack.cities.push(city);
}

function isComplete(stack: CountryStack): boolean {
  return stack.cities.length === countrySize(stack.country);
}

/** Runs after every state change: a win ends the game at once; so does running out of cards to play. */
function checkGameOver(state: GameState): void {
  const winner = findWinner(state);
  if (winner >= 0) endGame(state, winner);
  // A payment in progress is settled first: it can still produce a winner.
  else if (state.phase.kind !== 'pay' && state.deck.length === 0 && state.players.every((p) => p.hand.length === 0)) {
    endGame(state, null);
  }
}

/** The player who controls enough complete countries, or -1. */
function findWinner(state: GameState): PlayerId {
  return state.players.findIndex((p) => p.table.filter(isComplete).length >= state.options.countriesToWin);
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
