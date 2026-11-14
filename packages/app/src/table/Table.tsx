// The table, for solo and online play alike. It is driven only by one player's view and that player's
// legal actions, and holds no rules: a control exists exactly when the engine listed an action for it.

import type { Action, CardId, PlayerView } from '@atlas/engine';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { actionLabel, bankTotal, cardInfo, groupActions, logLine, promptText } from './actions.ts';
import { Button, CardView, Chip, CountryView } from './parts.tsx';
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

const LOG_ENTRIES = 4;

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
  /** A card of the viewer's or of the Market: it can be tapped exactly when it has a legal action. */
  const tappable = (id: CardId) => ({
    id,
    selected: selectedActions !== undefined && id === selected,
    onPress: byCard.has(id) ? () => setSelected(id === selected ? null : id) : undefined,
  });

  return (
    <View style={styles.table}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.board}>
        <View style={styles.row}>
          <Text style={styles.target}>First to {view.options.countriesToWin} countries</Text>
          <Text style={styles.small}>
            Deck {view.deckSize} · Discard {view.discardTop === null ? 'empty' : cardInfo(view.discardTop).name}
          </Text>
        </View>

        <View style={styles.middle}>
          <View style={styles.panel}>
            <Text style={styles.small}>Market</Text>
            <View style={styles.cards}>
              {view.market.map((id) => (
                <CardView key={id} {...tappable(id)} />
              ))}
            </View>
          </View>
          <View style={styles.log}>
            {view.log.slice(-LOG_ENTRIES).map((entry, i) => (
              <Text key={i} style={styles.small} numberOfLines={2}>
                {logLine(entry, names)}
              </Text>
            ))}
          </View>
        </View>

        {opponents.map((seat) => {
          const player = view.players[seat]!;
          return (
            <View key={seat} style={[styles.panel, seat === waitingOn && styles.active]}>
              <View style={styles.row}>
                <Text style={styles.name}>{names[seat]}</Text>
                <Text style={styles.small}>
                  Hand {player.handSize} · Bank {bankTotal(player.bank)} · {countries(view, seat)}
                </Text>
              </View>
              {player.table.length > 0 && (
                <View style={styles.wrap}>
                  {player.table.map((stack) => (
                    <CountryView key={stack.country} stack={stack} />
                  ))}
                </View>
              )}
            </View>
          );
        })}

      </ScrollView>

      <View style={[styles.panel, styles.mine, view.viewer === waitingOn && styles.active]}>
        <View style={styles.row}>
          <Text style={styles.name}>{names[view.viewer]}</Text>
          <Text style={styles.small}>
            Bank {bankTotal(me.bank)} · {countries(view, view.viewer)}
          </Text>
        </View>
        {me.table.length > 0 && (
          <View style={styles.wrap}>
            {me.table.map((stack) => (
              <CountryView key={stack.country} stack={stack}>
                {stack.cities.map((id) => (
                  <Chip key={id} {...tappable(id)} />
                ))}
              </CountryView>
            ))}
          </View>
        )}
        {me.bank.length > 0 && (
          <View style={styles.wrap}>
            {me.bank.map((id) => (
              <Chip key={id} {...tappable(id)} />
            ))}
          </View>
        )}
      </View>

      <Text style={styles.prompt}>{promptText(view, names)}</Text>
      <ScrollView horizontal style={styles.hand} contentContainerStyle={styles.cards}>
        {view.hand.map((id) => (
          <CardView key={id} {...tappable(id)} />
        ))}
      </ScrollView>
      <ScrollView style={styles.actions} contentContainerStyle={styles.wrap}>
        {selectedActions && <Button quiet label="Cancel" onPress={() => setSelected(null)} />}
        {(selectedActions ?? general).map((action, i) => (
          <Button key={i} label={actionLabel(action, names)} onPress={() => act(action)} />
        ))}
      </ScrollView>
    </View>
  );
}

function countries(view: PlayerView, seat: number): string {
  const complete = view.players[seat]!.table.filter((stack) => stack.complete).length;
  return `Countries ${complete}/${view.options.countriesToWin}`;
}

const styles = StyleSheet.create({
  table: { flex: 1, backgroundColor: colors.background },
  // Only the board gives way when space is short: the player's own area, hand and actions keep their size.
  scroll: { flex: 1 },
  board: { paddingHorizontal: 12, paddingBottom: 8, gap: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  middle: { flexDirection: 'row', gap: 8 },
  // The latest entries, beside the Market and no taller than it.
  log: { flex: 1, justifyContent: 'flex-end', gap: 2, overflow: 'hidden' },
  cards: { flexDirection: 'row', gap: 6 },
  panel: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.surface,
    padding: 8,
    gap: 6,
  },
  mine: { marginHorizontal: 12 },
  active: { borderColor: colors.accent },
  target: { color: colors.ink, fontSize: 16, fontWeight: '700' },
  name: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  small: { color: colors.muted, fontSize: 12 },
  prompt: { color: colors.ink, fontSize: 14, fontWeight: '600', paddingHorizontal: 12, paddingTop: 8 },
  // As tall as a card, even when empty, so that nothing moves when the last card is played.
  hand: { flexGrow: 0, flexShrink: 0, height: 112, paddingHorizontal: 12, paddingVertical: 8 },
  // Room for two rows, so that the hand does not move on most selections; more rows push it up, then scroll.
  actions: { flexGrow: 0, flexShrink: 0, minHeight: 96, maxHeight: 200, paddingHorizontal: 12 },
});
