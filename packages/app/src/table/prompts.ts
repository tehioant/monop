// The table's prompts: what a selected card offers, a payment in progress and a Veto question.
// Like `actions.ts`, all of it is read off the view and the legal actions. A choice exists exactly when the
// engine listed an action for it, and picking is the caller's state only: nothing is sent before a confirm.

import { RULES, type Action, type ActionId, type CardId, type PlayerView } from '@atlas/engine';
import { actionLabel, bankTotal, cardInfo, countryPerk, countrySize, title, words } from './actions.ts';

/** What each action card does, for the prompt of a selected card. A new action card fails to compile here. */
const EFFECTS: Record<ActionId, string> = {
  windfall: `draw ${RULES.windfallDraws} cards from the deck`,
  levy: `every opponent pays you ${RULES.levyAmount}`,
  debt: `one opponent pays you ${RULES.debtAmount}`,
  toll: 'every opponent pays you the toll of one of your countries',
  raid: "take a city from an opponent's incomplete country",
  exchange: "swap one of your cities for an opponent's, incomplete countries only",
  seizure: "take an opponent's complete country, upgrades included",
  upgrade: `attach it to one of your complete countries, its toll rises by ${RULES.upgradeToll}`,
  veto: 'cancels a card played against you; it cannot be played on your own turn',
};

/** An action seen as its fields: the prompts go by which fields an action carries, not by its card. */
type Aimed = { type: string; card: CardId; target?: number; country?: string; city?: CardId; give?: CardId; take?: CardId };

/** A pick is made in a slot: the own city an Exchange gives, or everything else the action is aimed at. */
export type Slot = 'give' | 'aim';
/** The option picked in each slot so far, by key. */
export type Picks = Partial<Record<Slot, string>>;

export interface Option {
  key: string;
  label: string;
  /** The country the option is, or is laid in: its colour. */
  country?: string;
  picked: boolean;
}

export interface Step {
  slot: Slot;
  title: string;
  /** The options, by the opponent they belong to; `seat` is null for the viewer's own and for opponents themselves. */
  groups: { seat: number | null; options: Option[] }[];
}

export interface CardPrompt {
  title: string;
  /** Actions with nothing to choose (bank, lay a city, a card with no target): sent as they are. */
  direct: Action[];
  /** What is left to choose for the other actions; empty when the card has none. */
  steps: Step[];
  /** The action the picks add up to, once every step has one. */
  chosen: Action | null;
}

/** The fields an action is aimed with, as one word: 'city,target' for a Raid, 'country' for a Toll. */
function shape(action: Action): string {
  return Object.keys(action).filter((field) => field !== 'type' && field !== 'card').sort().join(',');
}

/** The country one of a player's laid cities is in. */
function laidIn(view: PlayerView, seat: number, city: CardId | undefined): string | undefined {
  return view.players[seat]?.table.find((stack) => stack.cities.includes(city!))?.country;
}

function stackLabel(view: PlayerView, seat: number, country: string): string {
  const stack = view.players[seat]?.table.find((held) => held.country === country);
  const progress = `${title(country)} ${stack?.cities.length ?? 0}/${countrySize(country)}`;
  return stack ? `${progress}${stack.complete ? ' ✓' : ''} · toll ${stack.toll}` : progress;
}

const STEP_TITLES: Record<string, string> = {
  'city,target': 'Take which city?',
  'give,take,target': 'For which city?',
  'country,target': 'Take which country?',
  country: 'Which country?',
  target: 'Which opponent?',
};

function describe(view: PlayerView, slot: Slot, action: Action, names: readonly string[]): Omit<Option, 'key' | 'picked'> & { seat: number | null } {
  const { target, country, city, give, take } = action as Aimed;
  if (slot === 'give') return { seat: null, label: cardInfo(give!).name, country: laidIn(view, view.viewer, give) };
  switch (shape(action)) {
    case 'city,target':
    case 'give,take,target':
      return { seat: target!, label: cardInfo((city ?? take)!).name, country: laidIn(view, target!, city ?? take) };
    case 'country,target':
    case 'country':
      return { seat: target ?? null, label: stackLabel(view, target ?? view.viewer, country!), country };
    case 'target':
      return { seat: null, label: `${names[target!]} · bank ${bankTotal(view.players[target!]?.bank ?? [])}` };
    default:
      return { seat: null, label: actionLabel(action, names) };
  }
}

/** One line for the action a confirm would send. */
export function confirmLabel(action: Action, names: readonly string[]): string {
  const { card, target, country, city, give, take } = action as Aimed;
  const them = names[target ?? -1];
  switch (shape(action)) {
    case 'city,target':
      return `Take ${cardInfo(city!).name} from ${them}`;
    case 'give,take,target':
      return `Give ${cardInfo(give!).name} for ${them}'s ${cardInfo(take!).name}`;
    case 'country,target':
      return `Take ${title(country!)} from ${them}`;
    case 'country':
      return `${words(action.type)} ${cardInfo(card).name}: ${title(country!)}`;
    case 'target':
      return `${words(action.type)} ${cardInfo(card).name}: ${them}`;
    default:
      return actionLabel(action, names);
  }
}

function cardTitle(card: CardId): string {
  const { name, action, country } = cardInfo(card);
  if (action) return `${name}: ${EFFECTS[action]}`;
  const perk = country && countryPerk(country);
  if (perk) return `${name}: ${title(country)}, ${countrySize(country)} cities. Held complete: ${perk.text}`;
  return name;
}

/**
 * The prompt of a selected card, from the legal actions that use it (`groupActions().byCard`) and the picks made
 * so far. Every one of those actions is either in `direct` or reachable as `chosen` by picking one option per step.
 * A step with a single option needs no pick, and a pick that no longer names an option counts as none.
 */
export function cardPrompt(
  view: PlayerView,
  card: CardId,
  actions: readonly Action[],
  picks: Picks,
  names: readonly string[],
): CardPrompt {
  const direct = actions.filter((action) => shape(action) === '');
  const aimed = actions.filter((action) => shape(action) !== '');
  // The city given is picked on its own when every action has one (an Exchange); it is part of the aim otherwise.
  const slots: Slot[] = aimed.length > 0 && aimed.every((action) => 'give' in action) ? ['give', 'aim'] : ['aim'];
  const keyed = aimed.map((action) => {
    const { card: _card, give, ...rest } = action as Aimed;
    const keys: Record<Slot, string> =
      slots.length > 1 ? { give: give!, aim: JSON.stringify(rest) } : { give: '', aim: JSON.stringify({ ...rest, give }) };
    return { action, keys };
  });

  const picked: Picks = {};
  for (const slot of slots) {
    const all = new Set(keyed.map(({ keys }) => keys[slot]));
    const pick = picks[slot];
    if (pick !== undefined && all.has(pick)) picked[slot] = pick;
    else if (all.size === 1) picked[slot] = [...all][0];
  }
  /** True if the action agrees with the picks made in the other slots. */
  const fits = (keys: Record<Slot, string>, slot?: Slot) =>
    slots.every((other) => other === slot || picked[other] === undefined || picked[other] === keys[other]);

  const steps = slots.map((slot): Step => {
    const options = new Map<string, Option & { seat: number | null }>();
    for (const { action, keys } of keyed) {
      if (!fits(keys, slot) || options.has(keys[slot])) continue;
      options.set(keys[slot], { ...describe(view, slot, action, names), key: keys[slot], picked: picked[slot] === keys[slot] });
    }
    const seats = [...new Set([...options.values()].map((option) => option.seat))];
    const first = keyed.find(({ keys }) => options.has(keys[slot]))?.action;
    return {
      slot,
      title: slot === 'give' ? 'Give which of your cities?' : (STEP_TITLES[first ? shape(first) : ''] ?? 'Choose'),
      groups: seats.map((seat) => ({
        seat,
        options: [...options.values()].filter((option) => option.seat === seat).map(({ seat: _seat, ...option }) => option),
      })),
    };
  });

  const complete = slots.every((slot) => picked[slot] !== undefined);
  const chosen = complete ? keyed.find(({ keys }) => fits(keys))?.action : undefined;
  return { title: cardTitle(card), direct, steps: aimed.length > 0 ? steps : [], chosen: chosen ?? null };
}

export interface PayPrompt {
  /** Who is owed, and how much is still to pay. */
  text: string;
  owed: number;
  /** What the picked cards are worth together. */
  total: number;
  /** Every card that can be paid with, with its worth; `key` is the card. */
  cards: Option[];
  /**
   * The payments a confirm makes, one card each, in the order to send them: the next one once the game has
   * answered the last. Empty until the picked cards cover what is owed, or are all there is to pay with.
   */
  actions: Action[];
}

/** The payment prompt, while the viewer owes; null otherwise. `picked` are the cards chosen so far, in order. */
export function payPrompt(
  view: PlayerView,
  legal: readonly Action[],
  picked: readonly CardId[],
  names: readonly string[],
): PayPrompt | null {
  const { phase, viewer } = view;
  if (phase.kind !== 'pay' || phase.player !== viewer) return null;
  const payable = legal.filter((action) => action.type === 'pay');
  const chosen = picked.flatMap((id) => payable.filter((action) => action.card === id));
  const total = bankTotal(chosen.map((action) => action.card));
  const enough = chosen.length > 0 && (total >= phase.owed || chosen.length === payable.length);
  return {
    text: `You owe ${phase.owed} to ${names[phase.receiver]}`,
    owed: phase.owed,
    total,
    cards: payable.map(({ card }) => {
      const { name, kind, value } = cardInfo(card);
      return {
        key: card,
        label: kind === 'coin' ? name : `${name} (${value})`,
        country: laidIn(view, viewer, card),
        picked: chosen.some((action) => action.card === card),
      };
    }),
    actions: enough ? chosen : [],
  };
}

/**
 * The picked cards after a tap on `card`. A card is added only while more is owed than is picked, so every
 * picked card is needed when its turn to be paid comes: the game never refuses one for being paid already.
 */
export function togglePay(prompt: PayPrompt, picked: readonly CardId[], card: CardId): CardId[] {
  if (picked.includes(card)) return picked.filter((id) => id !== card);
  const payable = prompt.cards.some((option) => option.key === card);
  return payable && prompt.total < prompt.owed ? [...picked, card] : [...picked];
}

export interface VetoPrompt {
  text: string;
  /** Answer with a Veto: one of the viewer's, they are all alike. */
  veto: Action | undefined;
  /** Let the card, or the other player's Veto, stand. */
  decline: Action | undefined;
  declineLabel: string;
}

/** What the card at stake does to the viewer, its target. */
function stake(view: PlayerView): string {
  if (view.phase.kind !== 'veto') return '';
  const { effect } = view.phase;
  if (!('take' in effect)) return `you pay ${effect.amount}`;
  const { country, city, give, take } = effect.take;
  if (give !== undefined && take !== undefined) return `you get ${cardInfo(give).name} for your ${cardInfo(take).name}`;
  if (city !== undefined) return `you lose ${cardInfo(city).name}`;
  if (country !== undefined) return `you lose ${title(country)}`;
  return actionLabel(effect.take, []);
}

/** The Veto prompt, while the viewer is asked; null otherwise. */
export function vetoPrompt(view: PlayerView, legal: readonly Action[], names: readonly string[]): VetoPrompt | null {
  const { phase, turn, viewer } = view;
  if (phase.kind !== 'veto' || phase.player !== viewer) return null;
  // The card at stake: named by a take, and for a charge the last card the turn player played that is not a Veto.
  const played =
    'take' in phase.effect
      ? phase.effect.take
      : view.log.filter((entry) => entry.type === 'play' && entry.player === turn.player && cardInfo(entry.card).action !== 'veto').pop();
  const card = played && 'card' in played ? cardInfo(played.card).name : 'a card';
  const targeted = phase.target === viewer;
  const text = !targeted
    ? `${names[phase.target]} answers your ${card} with a Veto. Play your own to force it through?`
    : phase.vetoes === 0
      ? `${names[turn.player]} plays ${card}: ${stake(view)}. Cancel it with a Veto?`
      : `${names[turn.player]} answers your Veto with a Veto: ${card} is back on, ${stake(view)}. Veto again?`;
  return {
    text,
    veto: legal.find((action) => action.type === 'play'),
    decline: legal.find((action) => action.type === 'decline'),
    declineLabel: targeted ? 'Let it happen' : 'Accept the Veto',
  };
}
