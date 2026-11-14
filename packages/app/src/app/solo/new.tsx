import { DIFFICULTIES } from '@atlas/bots';
import { RULES } from '@atlas/engine';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSolo } from '../../solo/store.ts';
import { title } from '../../table/actions.ts';
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

function Choice<T extends string | number>(props: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  show?: (value: T) => string;
}) {
  const { label, options, value, onChange, show = String } = props;
  return (
    <View style={styles.choice}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.options}>
        {options.map((option) => (
          <Pressable
            key={option}
            onPress={() => onChange(option)}
            accessibilityState={{ selected: option === value }}
            style={[styles.option, option === value && styles.optionSelected]}
          >
            <Text style={[styles.optionText, option === value && styles.optionSelectedText]}>{show(option)}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 24, gap: 24 },
  title: { color: colors.ink, fontSize: 28, fontWeight: '800' },
  choice: { gap: 8 },
  label: { color: colors.ink, fontSize: 16, fontWeight: '700' },
  options: { flexDirection: 'row', gap: 8 },
  option: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  optionSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  optionText: { color: colors.ink, fontSize: 16, fontWeight: '600', textAlign: 'center' },
  optionSelectedText: { color: '#fff' },
});
