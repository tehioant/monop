// Tunable game data. No rule logic here: balancing edits this file only.

export const RULES = {
  playerCounts: [2, 3, 4, 5] as readonly number[],
  countriesToWin: [3, 5] as readonly number[],
  startingHand: 5,
  drawsPerTurn: 2,
  /** Turn-start draws, instead of `drawsPerTurn`, for a player with the `extraDraw` perk. */
  drawsWithPerk: 3,
  /** Draws for a player who starts their turn with an empty hand. */
  drawsOnEmptyHand: 4,
  marketSize: 3,
  windfallDraws: 2,
  /** What a Levy charges every opponent. */
  levyAmount: 2,
  /** What a Debt charges one chosen opponent. */
  debtAmount: 5,
  playsPerTurn: 3,
  /** Plays per turn, instead of `playsPerTurn`, for a player with the `extraPlay` perk. */
  playsWithPerk: 4,
  handLimit: 7,
};

/**
 * A country is complete when all of its cities are laid. `cityValue` is the coin value of each of its cities.
 * `toll` is the country's toll scale, one entry per city: `toll[n - 1]` is what a Toll charges each opponent
 * when the player holds `n` of its cities, the last entry being for the complete country.
 * `perk` is what a player gets for as long as they hold the country complete:
 * `extraDraw` draws `RULES.drawsWithPerk` cards at the start of their turn, `extraPlay` plays up to
 * `RULES.playsWithPerk` cards per turn, `vetoReturn` takes back into their hand the first Veto they play in the game.
 * The perks are dealt to the countries in turn, in list order: a placeholder for balancing.
 */
export const COUNTRIES = [
  { id: 'egypt', cityValue: 1, cities: ['cairo', 'alexandria'], toll: [1, 2], perk: 'extraDraw' },
  { id: 'australia', cityValue: 1, cities: ['sydney', 'melbourne'], toll: [1, 2], perk: 'extraPlay' },
  { id: 'france', cityValue: 2, cities: ['paris', 'lyon', 'marseille'], toll: [1, 2, 4], perk: 'vetoReturn' },
  { id: 'uk', cityValue: 2, cities: ['london', 'manchester', 'edinburgh'], toll: [1, 2, 4], perk: 'extraDraw' },
  { id: 'italy', cityValue: 2, cities: ['rome', 'milan', 'naples'], toll: [1, 2, 4], perk: 'extraPlay' },
  { id: 'japan', cityValue: 2, cities: ['tokyo', 'osaka', 'kyoto'], toll: [1, 2, 4], perk: 'vetoReturn' },
  { id: 'brazil', cityValue: 2, cities: ['rio-de-janeiro', 'sao-paulo', 'brasilia'], toll: [1, 2, 4], perk: 'extraDraw' },
  { id: 'usa', cityValue: 3, cities: ['new-york', 'los-angeles', 'chicago', 'houston'], toll: [1, 3, 5, 7], perk: 'extraPlay' },
  { id: 'china', cityValue: 3, cities: ['beijing', 'shanghai', 'guangzhou', 'chengdu'], toll: [1, 3, 5, 7], perk: 'vetoReturn' },
  { id: 'india', cityValue: 3, cities: ['mumbai', 'delhi', 'bengaluru', 'kolkata'], toll: [1, 3, 5, 7], perk: 'extraDraw' },
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
  { id: 'toll', value: 1, count: 6 },
  { id: 'raid', value: 3, count: 3 },
  { id: 'exchange', value: 3, count: 3 },
  { id: 'seizure', value: 5, count: 2 },
  { id: 'veto', value: 4, count: 3 },
] as const;
