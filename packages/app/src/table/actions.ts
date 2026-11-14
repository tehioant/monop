// How the table reads a view and its legal actions: which control offers each action, and the words for
// actions, log entries and prompts. Everything here works on the shape of the data, never on the rules, so
// an action type or a phase the table has never heard of still gets a control and a readable label.

import { CARDS, COUNTRIES, RULES, type Action, type CardId, type LogEntry, type PlayerView } from '@atlas/engine';

/** What the table needs to draw a card, whatever its kind. */
export interface CardInfo {
  name: string;
  kind: string;
  value: number;
  /** Cities only. */
  country?: string;
}

const cards = new Map<CardId, CardInfo>(
  CARDS.map((card) => {
    const { id, kind, value } = card;
    if (kind === 'city') return [id, { name: title(id), kind, value, country: card.country }];
    if (kind === 'coin') return [id, { name: `Coin ${value}`, kind, value }];
    return [id, { name: title('action' in card ? card.action : kind), kind, value }];
  }),
);

export function cardInfo(id: CardId): CardInfo {
  return cards.get(id) ?? { name: title(id), kind: 'unknown', value: 0 };
}

export function bankTotal(bank: readonly CardId[]): number {
  return bank.reduce((total, id) => total + cardInfo(id).value, 0);
}

const countrySizes = new Map<string, number>(COUNTRIES.map((country) => [country.id, country.cities.length]));

/** Number of cities that complete a country; 0 if unknown. */
export function countrySize(country: string): number {
  return countrySizes.get(country) ?? 0;
}

/** A display name for an id: 'rio-de-janeiro' -> 'Rio De Janeiro', 'uk' -> 'UK'. */
export function title(id: string): string {
  if (id.length <= 3) return id.toUpperCase();
  return id.replace(/(^|-)(\w)/g, (_, dash: string, letter: string) => (dash ? ' ' : '') + letter.toUpperCase());
}

/** Words for a camelCase name: 'endTurn' -> 'End turn'. */
function words(name: string): string {
  const spaced = name.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`);
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const VERBS: Record<string, string> = { draw: 'Draw from the deck', drawMarket: 'Take' };

/** Fields that hold a seat, shown as the player's name. */
const SEAT_FIELDS = ['player', 'target', 'winner', 'receiver', 'queue'];

function show(field: string, value: unknown, names: readonly string[]): string {
  if (Array.isArray(value)) return value.map((item) => show(field, item, names)).join(' + ') || 'none';
  if (typeof value === 'number' && SEAT_FIELDS.includes(field)) return names[value] ?? String(value);
  if (typeof value === 'string') return cards.get(value)?.name ?? title(value);
  return value === null ? 'none' : String(value);
}

function details(fields: Record<string, unknown>, names: readonly string[]): string {
  const parts = Object.entries(fields).map(([field, value]) => `${words(field).toLowerCase()}: ${show(field, value, names)}`);
  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}

/**
 * The words for an action: its type, the card it uses and every other field it carries, for example
 * 'Lay Paris', 'End turn' or, for a type with no wording of its own, 'Raid (target: Bot 2, city: Lyon)'.
 */
export function actionLabel(action: Action, names: readonly string[]): string {
  const { type, card, ...rest } = action as { type: string; card?: CardId } & Record<string, unknown>;
  const verb = VERBS[type] ?? words(type);
  const subject = card === undefined ? '' : cardInfo(card).name;
  return (subject && subject !== verb ? `${verb} ${subject}` : verb) + details(rest, names);
}

export function logLine(entry: LogEntry, names: readonly string[]): string {
  const { player, ...action } = entry as Action & { player?: number };
  const label = actionLabel(action, names);
  return player === undefined ? label : `${names[player] ?? player}: ${label}`;
}

/** What the game is waiting for, from the viewer's side. */
export function promptText(view: PlayerView, names: readonly string[]): string {
  const { kind, player, ...rest } = view.phase as { kind: string; player?: number } & Record<string, unknown>;
  if (kind === 'over') return 'Game over';
  if (player !== view.viewer) return `${names[player ?? -1] ?? 'Another player'} is playing…`;
  if (kind === 'draw') return `Your turn: draw ${rest.remaining} from the deck or the Market`;
  if (kind === 'play') return `Your turn: ${view.turn.playsLeft} of ${RULES.playsPerTurn} plays left`;
  if (kind === 'discard') return `Discard down to ${RULES.handLimit} cards`;
  return `Your move: ${words(kind).toLowerCase()}${details(rest, names)}`;
}

export interface ActionGroups {
  /** Actions that use a card the viewer can tap: one in their hand or in the Market. */
  byCard: Map<CardId, Action[]>;
  /** Every other action, offered as a plain button. */
  general: Action[];
}

/** Splits the legal actions by the control that offers them. Every action lands in exactly one place. */
export function groupActions(view: PlayerView, legal: readonly Action[]): ActionGroups {
  const tappable = new Set([...view.hand, ...view.market]);
  const groups: ActionGroups = { byCard: new Map(), general: [] };
  for (const action of legal) {
    const card = 'card' in action && tappable.has(action.card) ? action.card : undefined;
    if (card === undefined) groups.general.push(action);
    else groups.byCard.set(card, [...(groups.byCard.get(card) ?? []), action]);
  }
  return groups;
}
