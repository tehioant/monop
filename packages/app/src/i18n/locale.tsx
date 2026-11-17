import { useLocales } from 'expo-localization';
import { createContext, useContext, type ReactNode } from 'react';
import { useSettings } from '../settings/store.ts';
import { english, resolveLanguage, translate, type Language, type Translate } from './strings.ts';

const Locale = createContext<Language>('en');
const translations = { en: english, fr: translate('fr') };

export function LocaleProvider({ children }: { children: ReactNode }) {
  const choice = useSettings((state) => state.settings.language);
  const locales = useLocales();
  return <Locale.Provider value={resolveLanguage(choice, locales[0]?.languageTag)}>{children}</Locale.Provider>;
}

export function useTranslation(): Translate {
  return translations[useContext(Locale)];
}
