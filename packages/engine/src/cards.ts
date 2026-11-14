// The card catalog, derived from the data in data.ts.

import { ACTIONS, COINS, COUNTRIES, WILD_CITIES } from './data.ts';

export type CardId = string;
export type CountryId = string;
export type ActionId = (typeof ACTIONS)[number]['id'];
export type PerkId = (typeof COUNTRIES)[number]['perk'];

/** Every card has a coin `value`: what it is worth once banked. */
export type Card =
  | { id: CardId; kind: 'city'; country: CountryId; value: number }
  /** A wild city: laid as any one of `countries`. */
  | { id: CardId; kind: 'wild'; countries: readonly CountryId[]; value: number }
  | { id: CardId; kind: 'coin'; value: number }
  | { id: CardId; kind: 'action'; action: ActionId; value: number };

/** The standard deck, unshuffled. */
export const CARDS: readonly Card[] = [
  ...COUNTRIES.flatMap((country) =>
    country.cities.map((id): Card => ({ id, kind: 'city', country: country.id, value: country.cityValue })),
  ),
  ...WILD_CITIES.map(
    ({ id, value, countries }): Card => ({
      id,
      kind: 'wild',
      countries: countries === 'any' ? COUNTRIES.map((country) => country.id) : countries,
      value,
    }),
  ),
  ...COINS.flatMap(({ value, count }) =>
    Array.from({ length: count }, (_, i): Card => ({ id: `coin-${value}-${i + 1}`, kind: 'coin', value })),
  ),
  ...ACTIONS.flatMap(({ id, value, count }) =>
    Array.from({ length: count }, (_, i): Card => ({ id: `${id}-${i + 1}`, kind: 'action', action: id, value })),
  ),
];

const cardsById = new Map(CARDS.map((card) => [card.id, card]));
const countrySizes = new Map<CountryId, number>(COUNTRIES.map((country) => [country.id, country.cities.length]));
const tollScales = new Map<CountryId, readonly number[]>(COUNTRIES.map((country) => [country.id, country.toll]));
const countryPerks = new Map<CountryId, PerkId>(COUNTRIES.map((country) => [country.id, country.perk]));

export function getCard(id: CardId): Card {
  const card = cardsById.get(id);
  if (!card) throw new Error(`Unknown card: ${id}`);
  return card;
}

/** Number of cities needed to complete a country. */
export function countrySize(country: CountryId): number {
  const size = countrySizes.get(country);
  if (size === undefined) throw new Error(`Unknown country: ${country}`);
  return size;
}

/** A country's toll scale: entry `n - 1` is the toll for holding `n` of its cities. */
export function tollScale(country: CountryId): readonly number[] {
  const scale = tollScales.get(country);
  if (!scale) throw new Error(`Unknown country: ${country}`);
  return scale;
}

/** The perk a country gives the player who holds it complete. */
export function countryPerk(country: CountryId): PerkId {
  const perk = countryPerks.get(country);
  if (!perk) throw new Error(`Unknown country: ${country}`);
  return perk;
}
