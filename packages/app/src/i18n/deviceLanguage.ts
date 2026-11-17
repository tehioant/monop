import { getLocales } from 'expo-localization';
import { warnOnce } from '../warnOnce.ts';
import { resolveLanguage, type Language, type LanguageChoice } from './strings.ts';

export function readLanguage(choice: LanguageChoice): Language {
  if (choice !== 'system') return choice;
  try {
    return resolveLanguage(choice, getLocales()[0]?.languageTag);
  } catch {
    warnOnce('locale', 'Device locale unavailable; using English.');
    return 'en';
  }
}