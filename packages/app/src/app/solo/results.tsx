import { Redirect, router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { inProgress, soloNames, soloView } from '../../solo/solo.ts';
import { useSolo } from '../../solo/store.ts';
import { SaveStatus } from '../../solo/SaveStatus.tsx';
import { Button } from '../../table/parts.tsx';
import { Results } from '../../table/Results.tsx';

export default function SoloResults() {
  const { game, rematch, saveError, retrySave } = useSolo();
  if (!game) return <Redirect href="/" />;
  // A rematch has just started.
  if (inProgress(game)) return <Redirect href="/solo/table" />;
  return (
    <SafeAreaView style={styles.screen}>
      <Results view={soloView(game)} names={soloNames(game)} />
      <View style={styles.bar}>
        <SaveStatus error={saveError} retry={retrySave} />
        <Button label="Rematch" onPress={rematch} />
        <Button quiet label="Home" onPress={() => router.replace('/')} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  bar: { padding: 16, gap: 8 },
});
