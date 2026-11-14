// The card catalog, derived from the data in data.ts.

import { ACTIONS, COINS, COUNTRIES } from './data.ts';

export type CardId = string;
export type CountryId = string;
export type ActionKind = (typeof ACTIONS)[number]['id'];

/** Every card has a coin `value`: what it is worth once banked. */
export type Card =
  | { id: CardId; kind: 'city'; country: CountryId; value: number }
  | { id: CardId; kind: 'action'; action: ActionKind; value: number }
  | { id: CardId; kind: 'coin'; value: number };

/** The standard deck, unshuffled. */
export const CARDS: readonly Card[] = [
  ...COUNTRIES.flatMap((country) =>
    country.cities.map((id): Card => ({ id, kind: 'city', country: country.id, value: country.cityValue })),
  ),
  ...ACTIONS.flatMap(({ id, value, count }) =>
    Array.from({ length: count }, (_, i): Card => ({ id: `${id}-${i + 1}`, kind: 'action', action: id, value })),
  ),
  ...COINS.flatMap(({ value, count }) =>
    Array.from({ length: count }, (_, i): Card => ({ id: `coin-${value}-${i + 1}`, kind: 'coin', value })),
  ),
];

const cardsById = new Map(CARDS.map((card) => [card.id, card]));
const countrySizes = new Map<CountryId, number>(COUNTRIES.map((country) => [country.id, country.cities.length]));

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
