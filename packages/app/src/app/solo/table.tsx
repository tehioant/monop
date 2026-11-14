import { Redirect, router } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { botToMove, soloLegal, soloNames, soloView } from '../../solo/solo.ts';
import { useSolo } from '../../solo/store.ts';
import { Button } from '../../table/parts.tsx';
import { Table } from '../../table/Table.tsx';

/** Pause before each bot action, so that the player can follow what the bots do. */
const BOT_DELAY_MS = 500;

export default function SoloTable() {
  const { game, play, stepBot } = useSolo();
  const over = game?.state.phase.kind === 'over';

  useEffect(() => {
    if (!game || !botToMove(game)) return;
    const timer = setTimeout(stepBot, BOT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [game, stepBot]);

  useEffect(() => {
    if (over) router.replace('/solo/results');
  }, [over]);

  if (!game) return <Redirect href="/" />;
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.bar}>
        <Button quiet label="Quit" onPress={() => router.replace('/')} />
      </View>
      <Table view={soloView(game)} legal={soloLegal(game)} names={soloNames(game)} onAction={play} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  bar: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 12 },
});
