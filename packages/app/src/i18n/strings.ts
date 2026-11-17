export const en = {
  'common.back': 'Back',
  'common.count': 'Total: {count}',
  'settings.title': 'Settings',
  'settings.sound': 'Sound',
  'settings.soundDetail': 'Cards, your turn, a charge or a card aimed at you, a complete country, the end of the game.',
  'settings.haptics': 'Haptics',
  'settings.hapticsDetail': 'A tap in the hand for the same events and for your own cards.',
  'settings.language': 'Language',
  'settings.system': 'Device language',
  'settings.en': 'English',
  'settings.fr': 'Français',
  'settings.saveError': 'Changes apply now but could not be saved. Try changing the setting again.',
  'home.tagline': 'Collect countries, city by city.',
} as const;

export const fr = {
  'common.back': 'Retour',
  'common.count': 'Total : {count}',
  'settings.title': 'Paramètres',
  'settings.sound': 'Son',
  'settings.soundDetail': 'Les cartes, votre tour, une demande de paiement ou une carte qui vous vise, un pays complété et la fin de la partie.',
  'settings.haptics': 'Vibrations',
  'settings.hapticsDetail': 'Une vibration pour les mêmes événements et pour les cartes que vous jouez.',
  'settings.language': 'Langue',
  'settings.system': 'Langue de l’appareil',
  'settings.en': 'English',
  'settings.fr': 'Français',
  'settings.saveError': 'Les changements sont appliqués, mais n’ont pas pu être enregistrés. Réessayez de modifier le réglage.',
  'home.tagline': 'Collectionnez les pays, ville après ville.',
} satisfies Record<keyof typeof en, string>;

export const languageChoices = ['system', 'en', 'fr'] as const;
export type LanguageChoice = typeof languageChoices[number];
export type Language = Exclude<LanguageChoice, 'system'>;

export function isLanguageChoice(value: unknown): value is LanguageChoice {
  return languageChoices.some((choice) => choice === value);
}

export function resolveLanguage(choice: LanguageChoice, deviceTag: string | undefined): Language {
  if (choice !== 'system') return choice;
  return deviceTag?.split('-')[0]?.toLowerCase() === 'fr' ? 'fr' : 'en';
}

type Key = keyof typeof en;
type Placeholders<S extends string> = S extends `${string}{${infer Name}}${infer Rest}` ? Name | Placeholders<Rest> : never;
type Values = Record<string, string | number>;
export type Translate = <K extends Key>(key: K, ...args: [Placeholders<typeof en[K]>] extends [never]
  ? [] : [Record<Placeholders<typeof en[K]>, string | number>]) => string;

export function translate(language: Language): Translate {
  const strings = language === 'fr' ? fr : en;
  return (key: Key, values?: Values) => strings[key].replace(/\{(\w+)\}/g, (whole, name: string) =>
    values && Object.hasOwn(values, name) ? String(values[name]) : whole);
}
