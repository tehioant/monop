import { CARDS, countrySize, getCard, type ActionKind, type CardId } from './cards.ts';
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
  const { hand } = state.players[player]!;
  switch (phase.kind) {
    case 'draw':
      return [{ type: 'draw' }];
    case 'play': {
      const actions: Action[] = [];
      if (state.turn.playsLeft > 0) {
        for (const card of hand) {
          const def = getCard(card);
          if (def.kind === 'city') actions.push({ type: 'lay', card });
          if (def.kind === 'action') actions.push(...takes(state, player, card, def.action));
          actions.push({ type: 'bank', card });
        }
      }
      actions.push({ type: 'endTurn' });
      return actions;
    }
    case 'discard':
      return hand.map((card) => ({ type: 'discard', card }));
  }
}

/** Returns the next state. Throws `IllegalActionError` unless `action` is one of `legalActions(state, player)`. */
export function applyAction(state: GameState, player: PlayerId, action: Action): GameState {
  if (!legalActions(state, player).some((legal) => sameAction(legal, action))) {
    throw new IllegalActionError(`Illegal action for player ${player}: ${JSON.stringify(action)}`);
  }
  const next = clone(state);
  const me = next.players[player]!;
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
    case 'raid':
      playCard(next, me, action.card);
      moveCity(next.players[action.target]!, me, action.city);
      break;
    case 'exchange': {
      const them = next.players[action.target]!;
      playCard(next, me, action.card);
      moveCity(them, me, action.take);
      moveCity(me, them, action.give);
      break;
    }
    case 'seizure': {
      const them = next.players[action.target]!;
      playCard(next, me, action.card);
      // The country changes hands as one stack, not city by city.
      const stack = them.table.find((s) => s.country === action.country)!;
      remove(them.table, stack);
      me.table.push(stack);
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

/** The plays of one Raid, Exchange or Seizure card: one action per valid target, none if there is no target. */
function takes(state: GameState, player: PlayerId, card: CardId, kind: ActionKind): Action[] {
  const actions: Action[] = [];
  const mine = looseCities(state.players[player]!);
  state.players.forEach((them, target) => {
    if (target === player) return;
    switch (kind) {
      case 'raid':
        for (const city of looseCities(them)) actions.push({ type: 'raid', card, target, city });
        break;
      case 'exchange':
        for (const give of mine) {
          for (const take of looseCities(them)) actions.push({ type: 'exchange', card, target, give, take });
        }
        break;
      case 'seizure':
        for (const stack of them.table) {
          if (isComplete(stack)) actions.push({ type: 'seizure', card, target, country: stack.country });
        }
        break;
    }
  });
  return actions;
}

/** The cities a Raid or an Exchange may touch: those in incomplete countries. */
function looseCities(player: PlayerState): CardId[] {
  return player.table.flatMap((stack) => (isComplete(stack) ? [] : stack.cities));
}

/** An action card played from hand costs a play and goes to the discard pile. */
function playCard(state: GameState, player: PlayerState, card: CardId): void {
  remove(player.hand, card);
  state.discard.push(card);
  state.turn.playsLeft--;
}

/** Puts a city into its country on the player's table. */
function addCity(player: PlayerState, city: CardId): void {
  const card = getCard(city);
  if (card.kind !== 'city') throw new Error(`Not a city: ${city}`);
  let stack = player.table.find((s) => s.country === card.country);
  if (!stack) player.table.push((stack = { country: card.country, cities: [] }));
  stack.cities.push(city);
}

/** Moves a laid city from one player's table into the other's countries. */
function moveCity(from: PlayerState, to: PlayerState, city: CardId): void {
  const stack = from.table.find((s) => s.cities.includes(city))!;
  remove(stack.cities, city);
  if (stack.cities.length === 0) remove(from.table, stack);
  addCity(to, city);
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

function isComplete(stack: CountryStack): boolean {
  return stack.cities.length === countrySize(stack.country);
}

/**
 * Runs after every state change: a win ends the game at once; so does running out of cards to play.
 * When one action completes enough countries for two players, the one whose turn it is wins.
 */
function checkGameOver(state: GameState): void {
  const wins = (p: PlayerState) => p.table.filter(isComplete).length >= state.options.countriesToWin;
  const { player } = state.turn;
  const winner = wins(state.players[player]!) ? player : state.players.findIndex(wins);
  if (winner >= 0) endGame(state, winner);
  else if (state.deck.length === 0 && state.players.every((p) => p.hand.length === 0)) endGame(state, null);
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

function remove<T>(items: T[], item: T): void {
  items.splice(items.indexOf(item), 1);
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
