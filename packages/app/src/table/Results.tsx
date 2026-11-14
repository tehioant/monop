// The end of a game, from one player's final view: the winner and every player's countries.

import type { PlayerView } from '@atlas/engine';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { cardInfo } from './actions.ts';
import { CountryView } from './parts.tsx';
import { colors } from './theme.ts';

export function Results({ view, names }: { view: PlayerView; names: readonly string[] }) {
  const winner = view.phase.kind === 'over' ? view.phase.winner : null;
  const headline = winner === null ? 'No winner' : winner === view.viewer ? 'You win!' : `${names[winner]} wins`;
  return (
    <ScrollView contentContainerStyle={styles.results}>
      <Text style={styles.headline}>{headline}</Text>
      <Text style={styles.small}>First to {view.options.countriesToWin} complete countries</Text>
      {view.players.map((player, seat) => (
        <View key={seat} style={[styles.panel, seat === winner && styles.winner]}>
          <Text style={styles.name}>
            {names[seat]} · {player.table.filter((stack) => stack.complete).length} complete
          </Text>
          {player.table.length === 0 && <Text style={styles.small}>No countries</Text>}
          <View style={styles.wrap}>
            {player.table.map((stack) => (
              <CountryView
                key={stack.country}
                stack={stack}
                detail={stack.cities.map((id) => cardInfo(id).name).join(', ')}
              />
            ))}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  results: { padding: 16, gap: 10 },
  headline: { color: colors.ink, fontSize: 28, fontWeight: '800' },
  small: { color: colors.muted, fontSize: 13 },
  panel: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.surface,
    padding: 10,
    gap: 6,
  },
  winner: { borderColor: colors.accent },
  name: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
});
