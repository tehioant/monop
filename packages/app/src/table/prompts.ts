// The table's prompts: what a selected card offers, a payment in progress and a Veto question.
// Like `actions.ts`, all of it is read off the view and the legal actions. A choice exists exactly when the
// engine listed an action for it, and picking is the caller's state only: nothing is sent before a confirm.

import { RULES, type Action, type ActionId, type CardId, type Effect, type PlayerView } from '@atlas/engine';
import { actionLabel, bankTotal, cardInfo, countryPerk, countrySize, title } from './actions.ts';

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
type Aimed = { type: string; card: CardId; target: number; country: string; city: CardId; give: CardId; take: CardId };

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
  /** The words of the confirm button: what `chosen` does, or what is still to pick. Null without steps. */
  confirm: string | null;
}

/** The country one of a player's laid cities is in. */
function laidIn(view: PlayerView, seat: number, city: CardId): string | undefined {
  return view.players[seat]?.table.find((stack) => stack.cities.includes(city))?.country;
}

function stackLabel(view: PlayerView, seat: number, country: string): string {
  const stack = view.players[seat]?.table.find((held) => held.country === country);
  const progress = `${title(country)} ${stack?.cities.length ?? 0}/${countrySize(country)}`;
  return stack ? `${progress}${stack.complete ? ' ✓' : ''} · toll ${stack.toll}` : progress;
}

/** How one way of aiming an action is asked for, offered and confirmed. */
interface Aim {
  ask: string;
  /** One option: its owner (null for the viewer's own things and for opponents themselves), label and country. */
  option: (action: Aimed, view: PlayerView, names: readonly string[]) => Omit<Option, 'key' | 'picked'> & { seat: number | null };
  /** One line for the whole action, on the button that sends it. */
  confirm: (action: Aimed, names: readonly string[]) => string;
}

/** The verb and the card, as on any other button: 'Play Toll'. */
const head = ({ type, card }: Aimed, names: readonly string[]) => actionLabel({ type, card } as Action, names);

/** The ways to aim an action that have their own wording, by the fields the action carries besides its card. */
const AIMS: Record<string, Aim> = {
  'city,target': {
    ask: 'Take which city?',
    option: ({ target, city }, view) => ({ seat: target, label: cardInfo(city).name, country: laidIn(view, target, city) }),
    confirm: ({ target, city }, names) => `Take ${cardInfo(city).name} from ${names[target]}`,
  },
  'give,take,target': {
    ask: 'For which city?',
    option: ({ target, take }, view) => ({ seat: target, label: cardInfo(take).name, country: laidIn(view, target, take) }),
    confirm: ({ target, give, take }, names) => `Give ${cardInfo(give).name} for ${names[target]}'s ${cardInfo(take).name}`,
  },
  'country,target': {
    ask: 'Take which country?',
    option: ({ target, country }, view) => ({ seat: target, label: stackLabel(view, target, country), country }),
    confirm: ({ target, country }, names) => `Take ${title(country)} from ${names[target]}`,
  },
  country: {
    ask: 'Which country?',
    option: ({ country }, view) => ({ seat: null, label: stackLabel(view, view.viewer, country), country }),
    confirm: (action, names) => `${head(action, names)}: ${title(action.country)}`,
  },
  target: {
    ask: 'Which opponent?',
    option: ({ target }, view, names) => ({ seat: null, label: `${names[target]} · bank ${bankTotal(view.players[target]?.bank ?? [])}` }),
    confirm: (action, names) => `${head(action, names)}: ${names[action.target]}`,
  },
};

/** Any other action: it reads as `actionLabel` words it, so a new way of aiming still gets its options. */
const OTHER: Aim = {
  ask: 'Choose',
  option: (action, _view, names) => ({ seat: null, label: actionLabel(action as Action, names) }),
  confirm: (action, names) => actionLabel(action as Action, names),
};

/** The own city an Exchange gives: picked on its own, before what it is given for. */
const GIVE: Pick<Aim, 'ask' | 'option'> = {
  ask: 'Give which of your cities?',
  option: ({ give }, view) => ({ seat: null, label: cardInfo(give).name, country: laidIn(view, view.viewer, give) }),
};

/** The fields an action is aimed with, as one word: 'city,target' for a Raid, 'country' for a Toll, '' for none. */
function shape(action: Action): string {
  return Object.keys(action).filter((field) => field !== 'type' && field !== 'card').sort().join(',');
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
  const split = aimed.every((action) => 'give' in action);
  const slots: Slot[] = aimed.length === 0 ? [] : split ? ['give', 'aim'] : ['aim'];
  const keyed = aimed.map((action) => {
    const { card: _card, give, ...rest } = action as Aimed;
    const keys: Record<Slot, string> = split ? { give, aim: JSON.stringify(rest) } : { give: '', aim: JSON.stringify({ ...rest, give }) };
    return { action: action as Aimed, aim: AIMS[shape(action)] ?? OTHER, keys };
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
    const groups = new Map<number | null, Option[]>();
    const seen = new Set<string>();
    let title = '';
    for (const { action, aim, keys } of keyed) {
      const key = keys[slot];
      if (seen.has(key) || !fits(keys, slot)) continue;
      const { ask, option } = slot === 'give' ? GIVE : aim;
      if (seen.size === 0) title = ask;
      seen.add(key);
      const { seat, ...rest } = option(action, view, names);
      groups.set(seat, [...(groups.get(seat) ?? []), { ...rest, key, picked: picked[slot] === key }]);
    }
    return { slot, title, groups: [...groups].map(([seat, options]) => ({ seat, options })) };
  });

  const chosen = slots.every((slot) => picked[slot] !== undefined) ? keyed.find(({ keys }) => fits(keys)) : undefined;
  const missing = steps.find((step) => picked[step.slot] === undefined);
  return {
    title: cardTitle(card),
    direct,
    steps,
    chosen: (chosen?.action as Action | undefined) ?? null,
    confirm: chosen ? chosen.aim.confirm(chosen.action, names) : (missing?.title ?? null),
  };
}

export interface PayPrompt {
  /** Who is owed, and how much is still to pay. */
  text: string;
  owed: number;
  /** What the picked cards are worth together. */
  total: number;
  /** The running total against what is owed, in words. */
  summary: string;
  /**
   * Every card that can be paid with, with its worth; `key` is the card. A card is `disabled` once the picked
   * ones cover what is owed: every picked card is then needed when its turn to be paid comes, so the game
   * never refuses one because the debt is already settled.
   */
  cards: (Option & { disabled: boolean })[];
  /**
   * The payments a confirm makes, one card each, in the order to send them: the next one once the game has
   * answered the last. Empty until the picked cards cover what is owed, or are all there is to pay with.
   */
  actions: Extract<Action, { type: 'pay' }>[];
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
    summary: `Selected ${total} of ${phase.owed}${total > phase.owed ? ` (${total - phase.owed} over)` : ''}`,
    cards: payable.map(({ card }) => {
      const { name, kind, value } = cardInfo(card);
      const isPicked = chosen.some((action) => action.card === card);
      return {
        key: card,
        label: kind === 'coin' ? name : `${name} (${value})`,
        country: laidIn(view, viewer, card),
        picked: isPicked,
        disabled: !isPicked && total >= phase.owed,
      };
    }),
    actions: enough ? chosen : [],
  };
}

/** The picked cards after a tap on `card`: put back if it was picked, added unless it is disabled or not payable. */
export function togglePay(prompt: PayPrompt, picked: readonly CardId[], card: CardId): readonly CardId[] {
  if (picked.includes(card)) return picked.filter((id) => id !== card);
  return prompt.cards.some((option) => option.key === card && !option.disabled) ? [...picked, card] : picked;
}

export interface VetoPrompt {
  text: string;
  /** Answer with a Veto: one of the viewer's, they are all alike. */
  veto: Action | undefined;
  /** The words for declining: letting the card, or the other player's Veto, stand. */
  declineLabel: string;
}

/** What the card at stake does to the viewer, its target. */
function stake(effect: Effect): string {
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
      ? `${names[turn.player]} plays ${card}: ${stake(phase.effect)}. Cancel it with a Veto?`
      : `${names[turn.player]} answers your Veto with a Veto: ${card} is back on, ${stake(phase.effect)}. Veto again?`;
  return {
    text,
    veto: legal.find((action) => action.type === 'play'),
    declineLabel: targeted ? 'Let it happen' : 'Accept the Veto',
  };
}
