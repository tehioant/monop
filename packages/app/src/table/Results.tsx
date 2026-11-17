// The end of a game, from one player's final view: the winner and every player's countries.

import type { PlayerView } from '@atlas/engine';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from '../i18n/locale.tsx';
import { cardInfo, completeCount } from './actions.ts';
import { CountryView, Panel, shared } from './parts.tsx';
import { colors } from './theme.ts';

export function Results({ view, names }: { view: PlayerView; names: readonly string[] }) {
  const t = useTranslation();
  const winner = view.phase.kind === 'over' ? view.phase.winner : null;
  let headline = t('results.noWinner');
  if (winner === view.viewer) headline = t('results.youWin');
  else if (winner !== null) headline = t('results.winner', { name: names[winner] ?? winner });
  return (
    <ScrollView contentContainerStyle={styles.results}>
      <Text style={styles.headline}>{headline}</Text>
      <Text style={shared.small}>{t('board.completeGoal', { count: view.options.countriesToWin })}</Text>
      {view.players.map((player, seat) => (
        <Panel key={seat} highlighted={seat === winner}>
          <Text style={shared.name}>
            {t('results.complete', { name: names[seat] ?? seat, count: completeCount(player.table) })}
          </Text>
          {player.table.length === 0 && <Text style={shared.small}>{t('results.noCountries')}</Text>}
          <View style={shared.wrap}>
            {player.table.map((stack) => (
              <CountryView
                key={stack.country}
                stack={stack}
                detail={stack.cities.map((id) => cardInfo(id, t).name).join(', ')}
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
