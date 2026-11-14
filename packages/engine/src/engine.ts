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
  const { hand } = state.players[player]!;
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
          const { kind } = getCard(card);
          if (kind === 'city') actions.push({ type: 'lay', card });
          if (kind === 'action') actions.push({ type: 'play', card });
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
      if (card.kind !== 'city') throw new Error(`Not a city: ${card.id}`);
      remove(me.hand, card.id);
      let stack = me.table.find((s) => s.country === card.country);
      if (!stack) me.table.push((stack = { country: card.country, cities: [] }));
      stack.cities.push(card.id);
      next.turn.playsLeft--;
      break;
    }
    case 'play':
      // Windfall, the only action card so far: extra draws, from the deck only.
      remove(me.hand, action.card);
      for (let i = 0; i < RULES.windfallDraws; i++) {
        const card = drawCard(next);
        if (card) me.hand.push(card);
      }
      next.discard.push(action.card);
      next.turn.playsLeft--;
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
    market: state.market,
    turn: state.turn,
    phase: state.phase,
    log: state.log,
  };
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

function isComplete(stack: CountryStack): boolean {
  return stack.cities.length === countrySize(stack.country);
}

/** Runs after every state change: a win ends the game at once; so does running out of cards to draw and play. */
function checkGameOver(state: GameState): void {
  const winner = state.players.findIndex(
    (p) => p.table.filter(isComplete).length >= state.options.countriesToWin,
  );
  if (winner >= 0) endGame(state, winner);
  else if (
    state.deck.length === 0 &&
    state.discard.length === 0 &&
    state.market.length === 0 &&
    state.players.every((p) => p.hand.length === 0)
  ) {
    endGame(state, null);
  }
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
