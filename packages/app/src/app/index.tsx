import { router } from 'expo-router';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { inProgress } from '../solo/solo.ts';
import { useSolo } from '../solo/store.ts';
import { Button } from '../table/parts.tsx';
import { colors } from '../table/theme.ts';

export default function Home() {
  // The solo game saved on the device, or left a moment ago. There is one at a time.
  const saved = useSolo(({ game }) => game !== null && inProgress(game));
  const abandon = useSolo((solo) => solo.abandon);

  const confirmAbandon = () =>
    Alert.alert('Abandon the solo game?', 'The game in progress will be lost.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Abandon', style: 'destructive', onPress: abandon },
    ]);

  return (
    <View style={styles.home}>
      <Text style={styles.title}>Atlas</Text>
      <Text style={styles.tagline}>Collect countries, city by city.</Text>
      {saved ? (
        <>
          <Button label="Resume solo game" onPress={() => router.push('/solo/table')} />
          <Button quiet label="Abandon solo game" onPress={confirmAbandon} />
        </>
      ) : (
        <Button label="Solo game" onPress={() => router.push('/solo/new')} />
      )}
      <Button label="Play online" onPress={() => router.push('/online')} />
      <Button quiet label="Settings" onPress={() => router.push('/settings')} />
    </View>
  );
}

const styles = StyleSheet.create({
  home: { flex: 1, justifyContent: 'center', padding: 32, gap: 16 },
  title: { color: colors.ink, fontSize: 48, fontWeight: '800', textAlign: 'center' },
  tagline: { color: colors.muted, fontSize: 16, textAlign: 'center', marginBottom: 24 },
});
