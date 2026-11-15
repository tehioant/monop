import { DIFFICULTIES } from '@atlas/bots';
import { RULES } from '@atlas/engine';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSolo } from '../../solo/store.ts';
import { title } from '../../table/actions.ts';
import { Choice } from '../../table/Choice.tsx';
import { Button } from '../../table/parts.tsx';
import { colors } from '../../table/theme.ts';

// The options come from the engine and the bots; the screen only picks which one starts selected.
const BOT_COUNTS = RULES.playerCounts.map((players) => players - 1);
const DEFAULT_BOTS = BOT_COUNTS.includes(3) ? 3 : BOT_COUNTS[0]!;
const DEFAULT_DIFFICULTY = DIFFICULTIES[Math.floor((DIFFICULTIES.length - 1) / 2)]!;
const DEFAULT_COUNTRIES = Math.min(...RULES.countriesToWin);

export default function NewSoloGame() {
  const start = useSolo((solo) => solo.start);
  const [bots, setBots] = useState(DEFAULT_BOTS);
  const [difficulty, setDifficulty] = useState(DEFAULT_DIFFICULTY);
  const [countriesToWin, setCountriesToWin] = useState(DEFAULT_COUNTRIES);

  return (
    <SafeAreaView style={styles.screen}>
      <Text style={styles.title}>Solo game</Text>
      <Choice label="Opponents" options={BOT_COUNTS} value={bots} onChange={setBots} />
      <Choice label="Difficulty" options={DIFFICULTIES} value={difficulty} onChange={setDifficulty} show={title} />
      <Choice label="Countries to win" options={RULES.countriesToWin} value={countriesToWin} onChange={setCountriesToWin} />
      <Button
        label="Start"
        onPress={() => {
          start({ bots, difficulty, countriesToWin });
          router.replace('/solo/table');
        }}
      />
      <Button quiet label="Back" onPress={() => router.back()} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 24, gap: 24 },
  title: { color: colors.ink, fontSize: 28, fontWeight: '800' },
});
