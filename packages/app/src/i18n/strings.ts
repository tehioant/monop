import { en } from './en.ts';
import { fr } from './fr.ts';

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

export const english = translate('en');

export function hasKey(key: string): key is Key {
  return Object.hasOwn(en, key);
}
