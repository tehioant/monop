// How the table reads a view and its legal actions: which control offers each action, and the words for
// actions, log entries and prompts. Everything here works on the shape of the data, never on the rules, so
// an action type or a phase the table has never heard of still gets a control and a readable label.

import {
  CARDS,
  COUNTRIES,
  RULES,
  type Action,
  type ActionId,
  type Card,
  type CardId,
  type LogEntry,
  type PerkId,
  type PlayerView,
} from '@atlas/engine';
import { english, hasKey, type Translate } from '../i18n/strings.ts';

/** What the table needs to draw a card, whatever its kind. */
export interface CardInfo {
  name: string;
  kind: Card['kind'] | 'unknown';
  value: number;
  /** Cities only. */
  country?: string;
  countries?: readonly string[];
  /** Action cards only. */
  action?: ActionId;
}

const cards = new Map<CardId, Card>(CARDS.map((card) => [card.id, card]));

// These unions come from the catalog; a new country, city or action needs a resource entry.
type CityId = (typeof COUNTRIES)[number]['cities'][number];

export function cityName(city: CityId, t: Translate): string {
  return t(`city.${city}`);
}

export function countryName(country: string, t: Translate): string {
  const known = countries.get(country);
  return known ? t(`country.${known.id}`) : title(country);
}

export function cardInfo(id: CardId, t: Translate = english): CardInfo {
  const card = cards.get(id);
  if (!card) return { name: title(id), kind: 'unknown', value: 0 };
  const { kind, value } = card;
  if (kind === 'city') return { name: cityName(card.id as CityId, t), kind, value, country: card.country };
  if (kind === 'coin') return { name: t('card.coin', { value }), kind, value };
  if (kind === 'wild') {
    const name = card.countries.length === COUNTRIES.length ? t('card.wildAny')
      : t('card.wild', { countries: card.countries.map((country) => countryName(country, t)).join('/') });
    return { name, kind, value, countries: card.countries };
  }
  return { name: t(`card.action.${card.action}`), kind, value, action: card.action };
}

export function bankTotal(bank: readonly CardId[]): number {
  return bank.reduce((total, id) => total + (cards.get(id)?.value ?? 0), 0);
}

type Stacks = PlayerView['players'][number]['table'];

/** How many of a player's countries count toward winning. */
export function completeCount(table: Stacks): number {
  return table.filter((stack) => stack.complete).length;
}

const countries = new Map<string, (typeof COUNTRIES)[number]>(COUNTRIES.map((country) => [country.id, country]));

/** Number of cities that complete a country; 0 if unknown. */
export function countrySize(country: string): number {
  return countries.get(country)?.cities.length ?? 0;
}

/** What a country gives the player who holds it complete: a short label for a card or a country, and the full text. */
const perks: Record<PerkId, (t: Translate) => { label: string; text: string }> = {
  extraDraw: (t) => ({
    label: t('perk.extraDraw', { count: RULES.drawsWithPerk }),
    text: t('perk.extraDrawText', { count: RULES.drawsWithPerk }),
  }),
  extraPlay: (t) => ({
    label: t('perk.extraPlay', { count: RULES.playsWithPerk }),
    text: t('perk.extraPlayText', { count: RULES.playsWithPerk }),
  }),
  vetoReturn: (t) => ({ label: t('perk.vetoReturn'), text: t('perk.vetoReturnText') }),
};

/** The perk of a country, in words; undefined if unknown. */
export function countryPerk(country: string, t: Translate = english): { label: string; text: string } | undefined {
  const perk = countries.get(country)?.perk;
  return perk && perks[perk](t);
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

type ActionType = LogEntry['type'];
type Field = 'target' | 'country' | 'city' | 'give' | 'take' | 'winner' | 'receiver' | 'owed' | 'amount' | 'queue' | 'vetoes' | 'effect' | 'player';

type FieldOf<T> = T extends unknown ? keyof T : never;

/** Fields that hold a seat, shown as the player's name. Typed so that a renamed field fails to compile. */
const SEAT_FIELDS: readonly FieldOf<Action | LogEntry | PlayerView['phase']>[] = [
  'player',
  'target',
  'winner',
  'receiver',
  'queue',
];

function show(field: string, value: unknown, names: readonly string[], t: Translate): string {
  if (value === null) return t('field.none');
  if (Array.isArray(value)) return value.map((item) => show(field, item, names, t)).join(' + ') || t('field.none');
  if (typeof value === 'number' && (SEAT_FIELDS as readonly string[]).includes(field)) return names[value] ?? String(value);
  if (typeof value === 'string') return field === 'country' ? countryName(value, t) : cardInfo(value, t).name;
  // A nested action (the card at stake in a veto, say) reads as an action; any other object as its fields.
  if (typeof value === 'object') return 'type' in value ? actionLabel(value as Action, names, t) : list(value, names, t);
  return String(value);
}

function list(fields: object, names: readonly string[], t: Translate): string {
  return Object.entries(fields).map(([field, value]) => {
    const key = `field.${field}` as `field.${Field}`;
    return t('action.field', { field: hasKey(key) ? t(key) : words(field).toLowerCase(), value: show(field, value, names, t) });
  }).join(', ');
}

function withDetails(action: string, fields: object, names: readonly string[], t: Translate): string {
  const details = list(fields, names, t);
  return details ? t('action.details', { action, details }) : action;
}

/** Turn canonical actions into labels; future action identifiers still retain their details. */
export function actionLabel(action: Action | LogEntry, names: readonly string[], t: Translate = english): string {
  const { type, card, ...rest } = action as { type: ActionType; card?: CardId } & Record<string, unknown>;
  const key = `action.${type}` as const;
  const verb = hasKey(key) ? t(key) : words(type);
  const subject = card === undefined ? '' : cardInfo(card, t).name;
  return withDetails(subject && subject !== verb ? t('action.subject', { verb, card: subject }) : verb, rest, names, t);
}

export function logLine(entry: LogEntry, names: readonly string[], t: Translate = english): string {
  if (!('player' in entry)) return actionLabel(entry, names, t);
  const { player, ...action } = entry;
  return t('action.log', { name: names[player] ?? player, action: actionLabel(action as Action, names, t) });
}

/** What the game is waiting for, from the viewer's side. */
export function promptText(view: PlayerView, names: readonly string[], t: Translate = english): string {
  const phase = view.phase;
  if (phase.kind === 'over') return t('action.gameOver');
  if (phase.player !== view.viewer) return t('phase.waiting', { player: names[phase.player] ?? t('phase.otherPlayer') });
  if (phase.kind === 'draw') return t('phase.draw', { count: phase.remaining });
  if (phase.kind === 'play') return t('phase.play', { count: view.turn.playsLeft });
  if (phase.kind === 'discard') return t('phase.discard', { count: RULES.handLimit });
  const { kind, player: _player, ...rest } = phase;
  const key = `phase.${kind}` as const;
  const action = hasKey(key) ? t(key) : words(kind).toLowerCase();
  return withDetails(t('phase.move', { action }), rest, names, t);
}

/** Every card the viewer can see on the table: their hand, the Market, the discard top, every bank and country. */
export function shownCards(view: PlayerView): Set<CardId> {
  const laid = view.players.flatMap(({ bank, table }) => [...bank, ...table.flatMap((stack) => [...stack.cities, ...stack.upgrades])]);
  return new Set([...view.hand, ...view.market, ...laid, ...(view.discardTop === null ? [] : [view.discardTop])]);
}

export interface ActionGroups {
  /** Actions that use a card the viewer acts with: in their hand, in the Market, in their bank or laid by them. */
  byCard: Map<CardId, Action[]>;
  /** Every other action, offered as a plain button. */
  general: Action[];
}

/**
 * Splits the legal actions by the control that offers them. Every action lands in exactly one place.
 * The cards listed here are the ones `Table` draws as `tappable`: a zone added to one belongs in the other.
 * (Any other card it draws can be tapped too, but only to be read.)
 */
export function groupActions(view: PlayerView, legal: readonly Action[]): ActionGroups {
  const me = view.players[view.viewer]!;
  const laid = me.table.flatMap((stack) => [...stack.cities, ...stack.upgrades]);
  const tappable = new Set([...view.hand, ...view.market, ...me.bank, ...laid]);
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
