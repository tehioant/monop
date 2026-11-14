// The end of a game, from one player's final view: the winner and every player's countries.

import type { PlayerView } from '@atlas/engine';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { cardInfo, completeCount } from './actions.ts';
import { CountryView, Panel, shared } from './parts.tsx';
import { colors } from './theme.ts';

export function Results({ view, names }: { view: PlayerView; names: readonly string[] }) {
  const winner = view.phase.kind === 'over' ? view.phase.winner : null;
  const headline = winner === null ? 'No winner' : winner === view.viewer ? 'You win!' : `${names[winner]} wins`;
  return (
    <ScrollView contentContainerStyle={styles.results}>
      <Text style={styles.headline}>{headline}</Text>
      <Text style={shared.small}>First to {view.options.countriesToWin} complete countries</Text>
      {view.players.map((player, seat) => (
        <Panel key={seat} highlighted={seat === winner}>
          <Text style={shared.name}>
            {names[seat]} · {completeCount(player.table)} complete
          </Text>
          {player.table.length === 0 && <Text style={shared.small}>No countries</Text>}
          <View style={shared.wrap}>
            {player.table.map((stack) => (
              <CountryView
                key={stack.country}
                stack={stack}
                detail={stack.cities.map((id) => cardInfo(id).name).join(', ')}
              />
            ))}
          </View>
        </Panel>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  results: { padding: 16, gap: 10 },
  headline: { color: colors.ink, fontSize: 28, fontWeight: '800' },
});
