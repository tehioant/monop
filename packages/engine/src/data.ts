// Tunable game data. No rule logic here: balancing edits this file only.

export const RULES = {
  playerCounts: [2, 3, 4, 5] as readonly number[],
  countriesToWin: [3, 5] as readonly number[],
  startingHand: 5,
  drawsPerTurn: 2,
  /** Draws for a player who starts their turn with an empty hand. */
  drawsOnEmptyHand: 4,
  marketSize: 3,
  windfallDraws: 2,
  /** What a Levy charges every opponent. */
  levyAmount: 2,
  /** What a Debt charges one chosen opponent. */
  debtAmount: 5,
  playsPerTurn: 3,
  handLimit: 7,
};

/** A country is complete when all of its cities are laid. `cityValue` is the coin value of each of its cities. */
export const COUNTRIES = [
  { id: 'egypt', cityValue: 1, cities: ['cairo', 'alexandria'] },
  { id: 'australia', cityValue: 1, cities: ['sydney', 'melbourne'] },
  { id: 'france', cityValue: 2, cities: ['paris', 'lyon', 'marseille'] },
  { id: 'uk', cityValue: 2, cities: ['london', 'manchester', 'edinburgh'] },
  { id: 'italy', cityValue: 2, cities: ['rome', 'milan', 'naples'] },
  { id: 'japan', cityValue: 2, cities: ['tokyo', 'osaka', 'kyoto'] },
  { id: 'brazil', cityValue: 2, cities: ['rio-de-janeiro', 'sao-paulo', 'brasilia'] },
  { id: 'usa', cityValue: 3, cities: ['new-york', 'los-angeles', 'chicago', 'houston'] },
  { id: 'china', cityValue: 3, cities: ['beijing', 'shanghai', 'guangzhou', 'chengdu'] },
  { id: 'india', cityValue: 3, cities: ['mumbai', 'delhi', 'bengaluru', 'kolkata'] },
] as const;

/**
 * Wild cities, one card each: laid as any one of its `countries` ('any' = every country), and counting as a city
 * of the country it is laid in.
 */
export const WILD_CITIES = [
  { id: 'wild-egypt-italy', value: 2, countries: ['egypt', 'italy'] },
  { id: 'wild-australia-japan', value: 2, countries: ['australia', 'japan'] },
  { id: 'wild-france-usa', value: 3, countries: ['france', 'usa'] },
  { id: 'wild-uk-india', value: 3, countries: ['uk', 'india'] },
  { id: 'wild-brazil-china', value: 3, countries: ['brazil', 'china'] },
  { id: 'wild-any-1', value: 1, countries: 'any' },
  { id: 'wild-any-2', value: 1, countries: 'any' },
] as const;

/** Coin cards: `count` copies of each `value`. */
export const COINS = [
  { value: 1, count: 6 },
  { value: 2, count: 5 },
  { value: 3, count: 3 },
  { value: 4, count: 3 },
  { value: 5, count: 2 },
  { value: 10, count: 1 },
] as const;

/** Action cards: `count` copies of each, worth `value` once banked. */
export const ACTIONS = [
  { id: 'windfall', value: 1, count: 4 },
  { id: 'levy', value: 2, count: 3 },
  { id: 'debt', value: 3, count: 3 },
] as const;
