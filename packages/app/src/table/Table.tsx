// The table, for solo and online play alike. It is driven only by one player's view and that player's
// legal actions, and holds no rules: a control exists exactly when the engine listed an action for it.

import type { Action, CardId, PlayerView } from '@atlas/engine';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { actionLabel, bankTotal, cardInfo, groupActions, logLine, promptText } from './actions.ts';
import { Button, CardView, CountryView } from './parts.tsx';
import { colors } from './theme.ts';

export interface TableProps {
  view: PlayerView;
  /** The viewer's legal actions in `view`; empty while the game waits on someone else. */
  legal: readonly Action[];
  /** Display names by seat. */
  names: readonly string[];
  /** Called with one of the elements of `legal`. */
  onAction: (action: Action) => void;
}

const LOG_LINES = 4;

export function Table({ view, legal, names, onAction }: TableProps) {
  const [selected, setSelected] = useState<CardId | null>(null);
  const { byCard, general } = groupActions(view, legal);
  // A selection that outlived its actions (the card was played, the phase moved on) counts as none.
  const selectedActions = selected === null ? undefined : byCard.get(selected);
  const me = view.players[view.viewer]!;
  const opponents = view.players.map((_, i) => (view.viewer + i) % view.players.length).slice(1);
  const waitingOn = view.phase.kind === 'over' ? null : view.phase.player;

  const act = (action: Action) => {
    setSelected(null);
    onAction(action);
  };
  const card = (id: CardId) => (
    <CardView
      key={id}
      id={id}
      selected={selectedActions !== undefined && id === selected}
      onPress={byCard.has(id) ? () => setSelected(id === selected ? null : id) : undefined}
    />
  );

  return (
    <View style={styles.table}>
      <ScrollView contentContainerStyle={styles.board}>
        <View style={styles.row}>
          <Text style={styles.target}>First to {view.options.countriesToWin} countries</Text>
          <Text style={styles.small}>
            Deck {view.deckSize} · Discard {view.discardTop === null ? 'empty' : cardInfo(view.discardTop).name}
          </Text>
        </View>

        {opponents.map((seat) => {
          const player = view.players[seat]!;
          return (
            <View key={seat} style={[styles.panel, seat === waitingOn && styles.active]}>
              <View style={styles.row}>
                <Text style={styles.name}>{names[seat]}</Text>
                <Text style={styles.small}>
                  Hand {player.handSize} · Bank {bankTotal(player.bank)} · {summary(view, seat)}
                </Text>
              </View>
              <View style={styles.wrap}>
                {player.table.map((stack) => (
                  <CountryView key={stack.country} stack={stack} />
                ))}
              </View>
            </View>
          );
        })}

        <View style={styles.panel}>
          <Text style={styles.small}>Market</Text>
          <View style={styles.cards}>{view.market.map(card)}</View>
        </View>

        {view.log.length > 0 && (
          <View style={styles.panel}>
            {view.log.slice(-LOG_LINES).map((entry, i) => (
              <Text key={i} style={styles.small} numberOfLines={1}>
                {logLine(entry, names)}
              </Text>
            ))}
          </View>
        )}

        <View style={[styles.panel, view.viewer === waitingOn && styles.active]}>
          <View style={styles.row}>
            <Text style={styles.name}>{names[view.viewer]}</Text>
            <Text style={styles.small}>
              Bank {bankTotal(me.bank)} · {summary(view, view.viewer)}
            </Text>
          </View>
          <View style={styles.wrap}>
            {me.table.map((stack) => (
              <CountryView key={stack.country} stack={stack} detailed />
            ))}
          </View>
        </View>
      </ScrollView>

      <Text style={styles.prompt}>{promptText(view, names)}</Text>
      <ScrollView horizontal style={styles.hand} contentContainerStyle={styles.cards}>
        {view.hand.map(card)}
      </ScrollView>
      <ScrollView style={styles.actions} contentContainerStyle={styles.wrap}>
        {(selectedActions ?? general).map((action, i) => (
          <Button key={i} label={actionLabel(action, names)} onPress={() => act(action)} />
        ))}
        {selectedActions && <Button quiet label="Cancel" onPress={() => setSelected(null)} />}
      </ScrollView>
    </View>
  );
}

function summary(view: PlayerView, seat: number): string {
  const complete = view.players[seat]!.table.filter((stack) => stack.complete).length;
  return `Countries ${complete}/${view.options.countriesToWin}`;
}

const styles = StyleSheet.create({
  table: { flex: 1, backgroundColor: colors.background },
  board: { padding: 12, gap: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  cards: { flexDirection: 'row', gap: 6 },
  panel: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.surface,
    padding: 8,
    gap: 6,
  },
  active: { borderColor: colors.accent },
  target: { color: colors.ink, fontSize: 16, fontWeight: '700' },
  name: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  small: { color: colors.muted, fontSize: 12 },
  prompt: { color: colors.ink, fontSize: 14, fontWeight: '600', paddingHorizontal: 12, paddingTop: 8 },
  hand: { flexGrow: 0, paddingHorizontal: 12, paddingVertical: 8 },
  actions: { flexGrow: 0, height: 96, paddingHorizontal: 12 },
});
