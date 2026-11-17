import { Text, View } from 'react-native';
import { useTranslation } from '../i18n/locale.tsx';
import { Button } from '../table/parts.tsx';
import type { SaveError } from './store.ts';

export function SaveStatus({ error, retry }: { error: SaveError | null; retry: () => void }) {
  const t = useTranslation();
  if (!error) return null;
  return (
    <View accessibilityRole="alert">
      <Text>{t('solo.saveError')}</Text>
      <Button label={t('solo.retry')} onPress={retry} />
    </View>
  );
}
