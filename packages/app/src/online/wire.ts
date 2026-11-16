// Validate the wire shapes the table consumes, not game legality. Catalog IDs and option ranges stay engine-owned.
import { CARDS, COUNTRIES, RULES } from '@atlas/engine';

const cards = new Map(CARDS.map(card => [card.id, card]));
const countries = new Map<string, string>(COUNTRIES.map(country => [country.id, country.perk]));
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const seat = (value: unknown, players: number) => count(value) && value < players;
const card = (value: unknown): value is string => typeof value === 'string' && cards.has(value);
const country = (value: unknown): value is string => typeof value === 'string' && countries.has(value);
const every = (value: unknown, check: (item: unknown) => boolean): boolean => Array.isArray(value) && value.every(check);
const keys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));
const goal = (value: unknown) => typeof value === 'number' && RULES.countriesToWin.includes(value);

export function validRoom(value: unknown): boolean {
  if (!record(value) || !Array.isArray(value.players)) return false;
  return typeof value.code === 'string' && goal(value.countriesToWin) &&
    value.players.length >= 1 && value.players.length <= Math.max(...RULES.playerCounts) &&
    seat(value.you, value.players.length) && value.players.every(player => record(player) &&
      typeof player.name === 'string' && typeof player.bot === 'boolean' &&
      (player.status === 'connected' || player.status === 'disconnected'));
}

function validAction(value: unknown, players: number): boolean {
  if (!record(value)) return false;
  switch (value.type) {
    case 'draw': case 'decline': case 'endTurn': return keys(value, ['type']);
    case 'drawMarket': case 'bank': case 'pay': case 'discard':
      return keys(value, ['type', 'card']) && card(value.card);
    case 'lay':
      return keys(value, ['type', 'card', 'country']) && card(value.card) &&
        (value.country === undefined || country(value.country));
    case 'reassign':
      return keys(value, ['type', 'card', 'country']) && card(value.card) && country(value.country);
    case 'play': {
      if (!card(value.card)) return false;
      const def = cards.get(value.card)!;
      if (def.kind !== 'action') return false;
      // Required targeting payloads, not whether the target is legal in this game.
      let fields: string[];
      switch (def.action) {
        case 'debt': fields = ['target']; break;
        case 'toll': case 'upgrade': fields = ['country']; break;
        case 'raid': fields = ['target', 'city']; break;
        case 'exchange': fields = ['target', 'give', 'take']; break;
        case 'seizure': fields = ['target', 'country']; break;
        default: fields = [];
      }
      return keys(value, ['type', 'card', ...fields]) && fields.every(field =>
        field === 'target' ? seat(value[field], players) : field === 'country' ? country(value[field]) : card(value[field]));
    }
    default: return false;
  }
}

function validPhase(value: unknown, players: number): boolean {
  if (!record(value)) return false;
  if (value.kind === 'over') return keys(value, ['kind', 'winner']) && (value.winner === null || seat(value.winner, players));
  if (!seat(value.player, players)) return false;
  switch (value.kind) {
    case 'draw': return keys(value, ['kind', 'player', 'remaining']) && count(value.remaining);
    case 'play': case 'discard': return keys(value, ['kind', 'player']);
    case 'pay': return keys(value, ['kind', 'player', 'receiver', 'owed', 'amount', 'queue']) &&
      seat(value.receiver, players) && count(value.owed) && count(value.amount) && every(value.queue, item => seat(item, players));
    case 'veto': {
      const effect = value.effect;
      return keys(value, ['kind', 'player', 'target', 'vetoes', 'effect', 'queue']) && seat(value.target, players) &&
        count(value.vetoes) && every(value.queue, item => seat(item, players)) && record(effect) &&
        ((keys(effect, ['amount']) && count(effect.amount)) ||
          (keys(effect, ['take']) && record(effect.take) && effect.take.type === 'play' && validAction(effect.take, players)));
    }
    default: return false;
  }
}

function validLog(value: unknown, players: number): boolean {
  if (!record(value)) return false;
  if (value.type === 'reshuffle') return keys(value, ['type']);
  if (value.type === 'gameOver') return keys(value, ['type', 'winner']) && (value.winner === null || seat(value.winner, players));
  if (!seat(value.player, players)) return false;
  if (value.type === 'return') return keys(value, ['type', 'card', 'player']) && card(value.card);
  const { player: _, ...action } = value;
  return validAction(action, players);
}

export function validState(value: unknown): boolean {
  if (!record(value) || !count(value.stateVersion) || !record(value.view)) return false;
  const view = value.view;
  if (!record(view.options) || !Array.isArray(view.players)) return false;
  const players = view.players.length;
  return RULES.playerCounts.includes(players) && view.options.players === players && goal(view.options.countriesToWin) &&
    seat(view.viewer, players) && every(view.hand, card) && count(view.deckSize) &&
    (view.discardTop === null || card(view.discardTop)) && every(view.market, card) &&
    view.players.every(player => record(player) && count(player.handSize) && every(player.bank, card) &&
      every(player.table, stack => record(stack) && country(stack.country) && every(stack.cities, card) &&
        every(stack.upgrades, card) && typeof stack.complete === 'boolean' && count(stack.toll))) &&
    every(view.perks, perk => record(perk) && country(perk.country) && countries.get(perk.country) === perk.perk &&
      every(perk.activeFor, item => seat(item, players))) &&
    record(view.turn) && seat(view.turn.player, players) && count(view.turn.playsLeft) && validPhase(view.phase, players) &&
    every(view.log, entry => validLog(entry, players)) && every(value.legalActions, action => validAction(action, players));
}
