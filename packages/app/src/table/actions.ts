// How the table reads a view and its legal actions: which control offers each action, and the words for
// actions, log entries and prompts. Everything here works on the shape of the data, never on the rules, so
// an action type or a phase the table has never heard of still gets a control and a readable label.

import {
  CARDS,
  COUNTRIES,
  RULES,
  type Action,
  type ActionId,
  type CardId,
  type LogEntry,
  type PerkId,
  type PlayerView,
} from '@atlas/engine';

/** What the table needs to draw a card, whatever its kind. */
export interface CardInfo {
  name: string;
  kind: string;
  value: number;
  /** Cities only. */
  country?: string;
  /** Action cards only. */
  action?: ActionId;
}

const cards = new Map<CardId, CardInfo>(
  CARDS.map((card) => {
    const { id, kind, value } = card;
    if (kind === 'city') return [id, { name: title(id), kind, value, country: card.country }];
    if (kind === 'coin') return [id, { name: `Coin ${value}`, kind, value }];
    if (kind === 'wild') {
      const any = card.countries.length === COUNTRIES.length;
      return [id, { name: `Wild ${any ? 'Any' : card.countries.map(title).join('/')}`, kind, value }];
    }
    return [id, { name: title(card.action), kind, value, action: card.action }];
  }),
);

export function cardInfo(id: CardId): CardInfo {
  return cards.get(id) ?? { name: title(id), kind: 'unknown', value: 0 };
}

export function bankTotal(bank: readonly CardId[]): number {
  return bank.reduce((total, id) => total + cardInfo(id).value, 0);
}

type Stacks = PlayerView['players'][number]['table'];

/** How many of a player's countries count toward winning. */
export function completeCount(table: Stacks): number {
  return table.filter((stack) => stack.complete).length;
}

const countrySizes = new Map<string, number>(COUNTRIES.map((country) => [country.id, country.cities.length]));

/** Number of cities that complete a country; 0 if unknown. */
export function countrySize(country: string): number {
  return countrySizes.get(country) ?? 0;
}

/** What a country gives the player who holds it complete: a short label for a card or a country, and the full text. */
const PERKS: Record<PerkId, { label: string; text: string }> = {
  extraDraw: { label: `Draw ${RULES.drawsWithPerk}`, text: `draw ${RULES.drawsWithPerk} cards at the start of your turn` },
  extraPlay: { label: `Play ${RULES.playsWithPerk}`, text: `play up to ${RULES.playsWithPerk} cards a turn` },
  vetoReturn: { label: 'Veto back', text: 'the first Veto you play returns to your hand' },
};

const countryPerks = new Map<string, PerkId>(COUNTRIES.map((country) => [country.id, country.perk]));

/** The perk of a country, in words; undefined if unknown. */
export function countryPerk(country: string): { label: string; text: string } | undefined {
  const perk = countryPerks.get(country);
  return perk && PERKS[perk];
}

/** A display name for an id: 'rio-de-janeiro' -> 'Rio De Janeiro', 'uk' -> 'UK'. */
export function title(id: string): string {
  if (id.length <= 3) return id.toUpperCase();
  return id.replace(/(^|-)(\w)/g, (_, dash: string, letter: string) => (dash ? ' ' : '') + letter.toUpperCase());
}

/** Words for a camelCase name: 'endTurn' -> 'End turn'. */
export function words(name: string): string {
  const spaced = name.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`);
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const VERBS: Record<string, string> = { draw: 'Draw from the deck', drawMarket: 'Take' };

type FieldOf<T> = T extends unknown ? keyof T : never;

/** Fields that hold a seat, shown as the player's name. Typed so that a renamed field fails to compile. */
const SEAT_FIELDS: readonly FieldOf<Action | LogEntry | PlayerView['phase']>[] = [
  'player',
  'target',
  'winner',
  'receiver',
  'queue',
];

function show(field: string, value: unknown, names: readonly string[]): string {
  if (value === null) return 'none';
  if (Array.isArray(value)) return value.map((item) => show(field, item, names)).join(' + ') || 'none';
  if (typeof value === 'number' && (SEAT_FIELDS as readonly string[]).includes(field)) return names[value] ?? String(value);
  if (typeof value === 'string') return cardInfo(value).name;
  // A nested action (the card at stake in a veto, say) reads as an action; any other object as its fields.
  if (typeof value === 'object') return 'type' in value ? actionLabel(value as Action, names) : list(value, names);
  return String(value);
}

function list(fields: object, names: readonly string[]): string {
  return Object.entries(fields)
    .map(([field, value]) => `${words(field).toLowerCase()}: ${show(field, value, names)}`)
    .join(', ');
}

function details(fields: object, names: readonly string[]): string {
  const text = list(fields, names);
  return text ? ` (${text})` : '';
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
  if (kind === 'play') return `Your turn (plays left: ${view.turn.playsLeft})`;
  if (kind === 'discard') return `Discard down to ${RULES.handLimit} cards`;
  return `Your move: ${words(kind).toLowerCase()}${details(rest, names)}`;
}

export interface ActionGroups {
  /** Actions that use a card the viewer can tap: in their hand, in the Market, in their bank or laid by them. */
  byCard: Map<CardId, Action[]>;
  /** Every other action, offered as a plain button. */
  general: Action[];
}

/**
 * Splits the legal actions by the control that offers them. Every action lands in exactly one place.
 * The cards listed here are the ones `Table` draws as tappable: a zone added to one belongs in the other.
 */
export function groupActions(view: PlayerView, legal: readonly Action[]): ActionGroups {
  const me = view.players[view.viewer]!;
  const tappable = new Set([...view.hand, ...view.market, ...me.bank, ...me.table.flatMap((stack) => stack.cities)]);
  const groups: ActionGroups = { byCard: new Map(), general: [] };
  for (const action of legal) {
    if ('card' in action && tappable.has(action.card)) {
      const onCard = groups.byCard.get(action.card);
      if (onCard) onCard.push(action);
      else groups.byCard.set(action.card, [action]);
    } else {
      groups.general.push(action);
    }
  }
  return groups;
}
