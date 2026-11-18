// All gameplay quantities come from the catalog or rules, never from the wording.
import { CARDS, COUNTRIES, RULES, type ActionId, type Card, type CardId } from '@atlas/engine';
import { english, type Translate } from '../i18n/strings.ts';
import { cardInfo, cityName, countryName, countryPerk } from './actions.ts';

const effects: Record<ActionId, (t: Translate) => string[]> = {
  windfall: (t) => [t('card.windfall', { count: RULES.windfallDraws })],
  levy: (t) => [t('card.levy', { amount: RULES.levyAmount }), t('card.paying')],
  debt: (t) => [t('card.debt', { amount: RULES.debtAmount }), t('card.paying')],
  toll: (t) => [t('card.toll'), t('card.tollIncrease', { amount: RULES.upgradeToll }), t('card.paying')],
  raid: (t) => [t('card.raid')],
  exchange: (t) => [t('card.exchange'), t('card.exchangeComplete')],
  seizure: (t) => [t('card.seizure')],
  upgrade: (t) => [t('card.upgrade', { amount: RULES.upgradeToll }), t('card.upgradeLost')],
  veto: (t) => [t('card.veto'), t('card.vetoAnswer'), t('card.vetoFree')],
};

export function tollText(scale: readonly number[], t: Translate): string {
  return scale.map((amount, i) => i === scale.length - 1 ? t('card.tollComplete', { amount })
    : t(i === 0 ? 'card.tollOne' : 'card.tollMany', { amount, count: i + 1 })).join(', ');
}

function lines(card: Card, t: Translate): string[] {
  const worthLaid = () => t('card.worthLaid', { value: card.value });
  switch (card.kind) {
    case 'city': {
      const country = COUNTRIES.find(({ id }) => id === card.country)!;
      const name = countryName(country.id, t);
      return [
        t('card.cityDetails', { country: name, count: country.cities.length, cities: country.cities.map((city) => cityName(city, t)).join(', ') }),
        t('card.countryToll', { country: name, scale: tollText(country.toll, t) }),
        t('card.countryPerk', { text: countryPerk(country.id, t)!.text }),
        worthLaid(),
      ];
    }
    case 'wild': {
      const countries = card.countries.map((country) => countryName(country, t));
      return [
        countries.length === COUNTRIES.length ? t('card.wildDetailsAny')
          : t('card.wildDetails', { countries: countries.reduce((left, right) => t('common.or', { left, right })) }),
        t('card.wildMove'), t('card.wildCounts'), worthLaid(),
      ];
    }
    case 'coin': return [t('card.coinDetails'), t('card.worthCoin', { value: card.value })];
    case 'action': return [...effects[card.action](t), t('card.worthBanked', { value: card.value })];
  }
}

/** A card in full: its name, then one sentence per line. An unknown card has a name only. */
export function cardText(id: CardId, t: Translate = english): { name: string; lines: string[] } {
  const card = CARDS.find((known) => known.id === id);
  return { name: cardInfo(id, t).name, lines: card ? lines(card, t) : [] };
}
