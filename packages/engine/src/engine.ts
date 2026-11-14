import { CARDS, countrySize, getCard, type CardId, type CountryId } from './cards.ts';
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
        for (const id of hand) {
          const card = getCard(id);
          if (card.kind === 'city') actions.push({ type: 'lay', card: id });
          if (card.kind === 'wild') {
            for (const country of card.countries) actions.push({ type: 'lay', card: id, country });
          }
          actions.push({ type: 'bank', card: id });
        }
      }
      // The owner's laid wild cities can move to any other country they allow, without using a play.
      for (const stack of state.players[player]!.table) {
        for (const id of stack.cities) {
          const card = getCard(id);
          if (card.kind !== 'wild') continue;
          for (const country of card.countries) {
            if (country !== stack.country) actions.push({ type: 'reassign', card: id, country });
          }
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
    case 'lay': {
      const card = getCard(action.card);
      const country = card.kind === 'city' ? card.country : action.country;
      if (!country) throw new Error(`No country to lay ${card.id} in`);
      remove(me.hand, card.id);
      layCity(me, card.id, country);
      next.turn.playsLeft--;
      break;
    }
    case 'reassign':
      for (const stack of me.table) {
        if (stack.cities.includes(action.card)) remove(stack.cities, action.card);
      }
      me.table = me.table.filter((stack) => stack.cities.length > 0);
      layCity(me, action.card, action.country);
      break;
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

function layCity(player: PlayerState, card: CardId, country: CountryId): void {
  let stack = player.table.find((s) => s.country === country);
  if (!stack) player.table.push((stack = { country, cities: [] }));
  stack.cities.push(card);
}

/** Wild cities count toward the size, but a country needs at least one city of its own. */
function isComplete(stack: CountryStack): boolean {
  return (
    stack.cities.length >= countrySize(stack.country) && stack.cities.some((card) => getCard(card).kind === 'city')
  );
}

/** Runs after every state change: a win ends the game at once; so does running out of cards to play. */
function checkGameOver(state: GameState): void {
  const winner = state.players.findIndex(
    (p) => p.table.filter(isComplete).length >= state.options.countriesToWin,
  );
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
