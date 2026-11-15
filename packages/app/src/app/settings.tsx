// The player's settings. Opened from home and from a game, which goes on underneath.

import { router } from 'expo-router';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { signal } from '../settings/feedback.ts';
import type { Settings } from '../settings/settings.ts';
import { useSettings } from '../settings/store.ts';
import { Button, Panel, shared } from '../table/parts.tsx';
import { colors } from '../table/theme.ts';

/** The switches, in order. A setting of another kind (the language) gets its own row below them. */
const SWITCHES: { name: keyof Settings; label: string; detail: string }[] = [
  { name: 'sound', label: 'Sound', detail: 'Cards, your turn, a charge or a card aimed at you, a complete country, the end of the game.' },
  { name: 'haptics', label: 'Haptics', detail: 'A tap in the hand for the same events and for your own cards.' },
];

export default function SettingsScreen() {
  const { settings, change } = useSettings();
  return (
    <SafeAreaView style={styles.screen}>
      <Text style={styles.title}>Settings</Text>
      <Panel>
        {SWITCHES.map(({ name, label, detail }) => (
          <View key={name} style={styles.row}>
            <View style={styles.text}>
              <Text style={shared.name}>{label}</Text>
              <Text style={shared.small}>{detail}</Text>
            </View>
            <Switch
              accessibilityLabel={label}
              value={settings[name]}
              trackColor={{ true: colors.accent }}
              onValueChange={(on) => {
                change({ [name]: on });
                // What is now on is heard or felt at once.
                signal('turn');
              }}
            />
          </View>
        ))}
      </Panel>
      <Button quiet label="Back" onPress={() => router.back()} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 24, gap: 16 },
  title: { color: colors.ink, fontSize: 28, fontWeight: '800' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  text: { flex: 1, gap: 2 },
});
