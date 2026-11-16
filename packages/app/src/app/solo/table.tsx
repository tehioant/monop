import { Redirect, router } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { botToMove, soloLegal, soloNames, soloView, type SoloGame } from '../../solo/solo.ts';
import { useSolo } from '../../solo/store.ts';
import { Button } from '../../table/parts.tsx';
import { Table } from '../../table/Table.tsx';
import { usePaced } from '../../table/usePaced.ts';

export default function SoloTable() {
  const game = useSolo((solo) => solo.game);
  if (!game) return <Redirect href="/" />;
  return <Playing game={game} />;
}

function Playing({ game }: { game: SoloGame }) {
  const { play, stepBot } = useSolo();
  // The bots play at once, one action after the other; what they did is shown at a pace the player can follow.
  const incoming = useMemo(() => soloView(game), [game]);
  const { view, legal, settled } = usePaced(incoming, soloLegal(game));
  const over = view.phase.kind === 'over' && settled;

  useEffect(() => {
    if (!botToMove(game)) return;
    const timer = setTimeout(stepBot);
    return () => clearTimeout(timer);
  }, [game, stepBot]);

  useEffect(() => {
    if (over) router.replace('/solo/results');
  }, [over]);

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.bar}>
        <Button quiet label="Settings" onPress={() => router.push('/settings')} />
        <Button quiet label="Quit" onPress={() => router.replace('/')} />
      </View>
      <Table view={view} legal={legal} names={soloNames(game)} onAction={play} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  bar: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, paddingHorizontal: 12 },
});
