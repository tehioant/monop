// The full text of a card: what it is, what it does and what it is worth. Every number in it is read from the
// card data and the rules, so retuning the game never needs a text edited.

import { CARDS, COUNTRIES, RULES, type ActionId, type Card, type CardId } from '@atlas/engine';
import { cardInfo, countryPerk, title } from './actions.ts';

const PAYING = 'They pay with banked cards and laid cities, and get no change.';

/** What each action card does when played. A new action card fails to compile here. */
const EFFECTS: Record<ActionId, string[]> = {
  windfall: [`Draw ${RULES.windfallDraws} cards from the deck.`],
  levy: [`Every opponent pays you ${RULES.levyAmount}.`, PAYING],
  debt: [`One opponent of your choice pays you ${RULES.debtAmount}.`, PAYING],
  toll: [
    'Every opponent pays you the toll of one country you hold cities in.',
    `The toll grows with the cities you hold there, and by ${RULES.upgradeToll} for each upgrade.`,
    PAYING,
  ],
  raid: ["Take one city from an opponent's incomplete country."],
  exchange: ["Swap one of your cities for one of an opponent's.", 'Cities of complete countries cannot be swapped.'],
  seizure: ["Take an opponent's complete country, its upgrades included."],
  upgrade: [
    `Attach it to one of your complete countries: its toll rises by ${RULES.upgradeToll}.`,
    'If the country stops being complete, the upgrade goes to your bank.',
  ],
  veto: [
    "Play it when an opponent's card hits you: the card does nothing to you.",
    'A Veto can be answered by a Veto, which puts the card back on.',
    'It uses none of your plays.',
  ],
};

const cards = new Map<CardId, Card>(CARDS.map((card) => [card.id, card]));
const countries = new Map<string, (typeof COUNTRIES)[number]>(COUNTRIES.map((country) => [country.id, country]));

/** A toll scale in words: '1 with 1 city, 2 with 2 cities, 4 once complete'. */
function tollText(scale: readonly number[]): string {
  return scale
    .map((amount, i) => (i === scale.length - 1 ? `${amount} once complete` : `${amount} with ${i + 1} ${i === 0 ? 'city' : 'cities'}`))
    .join(', ');
}

function lines(card: Card): string[] {
  const worth = `Worth ${card.value} as payment`;
  switch (card.kind) {
    case 'city': {
      const country = countries.get(card.country);
      const perk = countryPerk(card.country);
      if (!country || !perk) return [`${worth}, laid or banked.`];
      const name = title(country.id);
      return [
        `A city of ${name}, which is complete with ${country.cities.length} cities: ${country.cities.map(title).join(', ')}.`,
        `A Toll on ${name} charges each opponent ${tollText(country.toll)}.`,
        `Held complete: ${perk.text}.`,
        `${worth}, laid or banked.`,
      ];
    }
    case 'wild': {
      const any = card.countries.length === COUNTRIES.length;
      return [
        `A wild city: lay it as a city of ${any ? 'any country' : card.countries.map(title).join(' or ')}.`,
        'On your turn you can move it to another of its countries, without using a play.',
        'It counts as a city of the country it is in, but a country made of wild cities only is not complete.',
        `${worth}, laid or banked.`,
      ];
    }
    case 'coin':
      return ['Bank it to pay what opponents charge you.', `${worth}. No change is given.`];
    case 'action':
      return [...EFFECTS[card.action], `Or bank it: ${worth.toLowerCase()}.`];
  }
}

/** A card in full: its name, then one sentence per line. A card the table does not know has a name only. */
export function cardText(id: CardId): { name: string; lines: string[] } {
  const card = cards.get(id);
  return { name: cardInfo(id).name, lines: card ? lines(card) : [] };
}
