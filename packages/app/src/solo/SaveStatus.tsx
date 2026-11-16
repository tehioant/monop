import { Text, View } from 'react-native';
import { Button } from '../table/parts.tsx';

export function SaveStatus({ error, retry }: { error: string | null; retry: () => void }) {
  if (!error) return null;
  return (
    <View accessibilityRole="alert">
      <Text>{error}</Text>
      <Button label="Retry save" onPress={retry} />
    </View>
  );
}
