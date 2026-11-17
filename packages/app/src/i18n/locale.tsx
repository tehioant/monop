import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { useSettings } from '../settings/store.ts';
import { readLanguage } from './deviceLanguage.ts';
import { english, translate, type Language, type Translate } from './strings.ts';

const Locale = createContext<Language>('en');
const translations = { en: english, fr: translate('fr') };

export function LocaleProvider({ children }: { children: ReactNode }) {
  const choice = useSettings((state) => state.settings.language);
  const [systemLanguage, setSystemLanguage] = useState(() => readLanguage(choice));
  useEffect(() => {
    if (choice !== 'system') return;
    const refresh = () => setSystemLanguage(readLanguage('system'));
    refresh();
    // Expo recommends re-reading locales on foreground: Android can change them without restarting the app.
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => subscription.remove();
  }, [choice]);
  return <Locale.Provider value={choice === 'system' ? systemLanguage : choice}>{children}</Locale.Provider>;
}

export function useTranslation(): Translate {
  return translations[useContext(Locale)];
}
