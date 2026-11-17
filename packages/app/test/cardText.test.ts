import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACTIONS, CARDS, COUNTRIES, RULES } from '@atlas/engine';
import { english } from '../src/i18n/strings.ts';
import { countryName, countryPerk } from '../src/table/actions.ts';
import { cardText } from '../src/table/cardText.ts';

// The expectations are read from the card data, as the texts are: retuning the game must not break them.

const text = (id: string) => cardText(id).lines.join(' ');
const actionCard = (action: string) => CARDS.find((card) => card.kind === 'action' && card.action === action)!;

test('every card of the deck has a text that ends on what it is worth, and every action card its own', () => {
  for (const card of CARDS) {
    const { name, lines } = cardText(card.id);
    assert.ok(name.length > 0 && lines.length >= 2, card.id);
    assert.match(lines.at(-1)!, new RegExp(`[Ww]orth ${card.value} as payment`), card.id);
  }
  const actions = CARDS.filter((card) => card.kind === 'action').map((card) => text(card.id));
  assert.equal(new Set(actions).size, ACTIONS.length);
});

test('a city says what its country needs, charges and gives, from the card data', () => {
  for (const country of COUNTRIES) {
    const city = text(country.cities[0]);
    const name = countryName(country.id, english);
    assert.ok(city.includes(`A city of ${name}, which is complete with ${country.cities.length} cities: `), city);
    for (const other of country.cities) assert.ok(city.includes(cardText(other).name), city);
    // The whole toll scale, in order, the last step being the complete country.
    const scale = new RegExp(`A Toll on ${name} charges each opponent ${country.toll.join('\\b.*\\b')} once complete\\.`);
    assert.match(city, scale);
    assert.ok(city.includes(`Held complete: ${countryPerk(country.id)!.text}.`), city);
  }
});

test('an action card quotes the numbers of the rules', () => {
  const action = (id: string) => text(actionCard(id).id);
  assert.ok(action('windfall').startsWith(`Draw ${RULES.windfallDraws} cards from the deck.`));
  assert.ok(action('levy').startsWith(`Every opponent pays you ${RULES.levyAmount}.`));
  assert.ok(action('debt').startsWith(`One opponent of your choice pays you ${RULES.debtAmount}.`));
  assert.ok(action('toll').includes(`by ${RULES.upgradeToll} for each upgrade`));
  assert.ok(action('upgrade').includes(`its toll rises by ${RULES.upgradeToll}.`));
  assert.ok(action('raid').endsWith(`Or bank it: worth ${actionCard('raid').value} as payment.`));
});

test('a wild city lists the countries it can be laid as', () => {
  for (const card of CARDS) {
    if (card.kind !== 'wild') continue;
    const any = card.countries.length === COUNTRIES.length;
    const expected = any ? 'any country' : card.countries.map((id) => countryName(id, english)).join(' or ');
    assert.ok(text(card.id).startsWith(`A wild city: lay it as a city of ${expected}.`), card.id);
  }
});

test('a card the table does not know has a name and no text', () => {
  assert.deepEqual(cardText('trade-embargo'), { name: 'Trade Embargo', lines: [] });
});
