// The table, for solo and online play alike. It is driven only by one player's view and that player's
// legal actions, and holds no rules: a control exists exactly when the engine listed an action for it.

import type { Action, CardId, PlayerView } from '@atlas/engine';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { actionLabel, bankTotal, cardInfo, completeCount, groupActions, logLine, promptText } from './actions.ts';
import { Button, CARD_HEIGHT, CardView, Chip, CountryView, Panel, shared, type Tappable } from './parts.tsx';
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
  const tappable = (id: CardId): Tappable => ({
    id,
    selected: selectedActions !== undefined && id === selected,
    onPress: byCard.has(id) ? () => setSelected(id === selected ? null : id) : undefined,
  });

  return (
    <View style={styles.table}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.board}>
        <View style={styles.row}>
          <Text style={styles.target}>First to {view.options.countriesToWin} countries</Text>
          <Text style={shared.small}>
            Deck {view.deckSize} · Discard {view.discardTop === null ? 'empty' : cardInfo(view.discardTop).name}
          </Text>
        </View>

        <View style={styles.middle}>
          <Panel>
            <Text style={shared.small}>Market</Text>
            <View style={styles.cards}>
              {view.market.map((id) => (
                <CardView key={id} {...tappable(id)} />
              ))}
            </View>
          </Panel>
          <View style={styles.log}>
            {view.log.slice(-LOG_ENTRIES).map((entry, i) => (
              <Text key={i} style={shared.small} numberOfLines={2}>
                {logLine(entry, names)}
              </Text>
            ))}
          </View>
        </View>

        {opponents.map((seat) => {
          const player = view.players[seat]!;
          return (
            <Panel key={seat} highlighted={seat === waitingOn}>
              <View style={styles.row}>
                <Text style={shared.name}>{names[seat]}</Text>
                <Text style={shared.small}>
                  Hand {player.handSize} · Bank {bankTotal(player.bank)} · {countries(view, seat)}
                </Text>
              </View>
              {player.table.length > 0 && (
                <View style={shared.wrap}>
                  {player.table.map((stack) => (
                    <CountryView key={stack.country} stack={stack} />
                  ))}
                </View>
              )}
            </Panel>
          );
        })}
      </ScrollView>

      <Panel highlighted={view.viewer === waitingOn} style={styles.mine}>
        <View style={styles.row}>
          <Text style={shared.name}>{names[view.viewer]}</Text>
          <Text style={shared.small}>
            Bank {bankTotal(me.bank)} · {countries(view, view.viewer)}
          </Text>
        </View>
        {me.table.length > 0 && (
          <View style={shared.wrap}>
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
          <View style={shared.wrap}>
            {me.bank.map((id) => (
              <Chip key={id} {...tappable(id)} />
            ))}
          </View>
        )}
      </Panel>

      <Text style={styles.prompt}>{promptText(view, names)}</Text>
      <ScrollView horizontal style={styles.hand} contentContainerStyle={styles.cards}>
        {view.hand.map((id) => (
          <CardView key={id} {...tappable(id)} />
        ))}
      </ScrollView>
      <ScrollView style={styles.actions} contentContainerStyle={shared.wrap}>
        {selectedActions && <Button quiet label="Cancel" onPress={() => setSelected(null)} />}
        {(selectedActions ?? general).map((action, i) => (
          <Button key={i} label={actionLabel(action, names)} onPress={() => act(action)} />
        ))}
      </ScrollView>
    </View>
  );
}

function countries(view: PlayerView, seat: number): string {
  return `Countries ${completeCount(view.players[seat]!.table)}/${view.options.countriesToWin}`;
}

const styles = StyleSheet.create({
  table: { flex: 1 },
  // Only the board gives way when space is short: the player's own area, hand and actions keep their size.
  scroll: { flex: 1 },
  board: { paddingHorizontal: 12, paddingBottom: 8, gap: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
  middle: { flexDirection: 'row', gap: 8 },
  // The latest entries, beside the Market and no taller than it.
  log: { flex: 1, justifyContent: 'flex-end', gap: 2, overflow: 'hidden' },
  cards: { flexDirection: 'row', gap: 6 },
  mine: { marginHorizontal: 12 },
  target: { color: colors.ink, fontSize: 16, fontWeight: '700' },
  prompt: { color: colors.ink, fontSize: 14, fontWeight: '600', paddingHorizontal: 12, paddingTop: 8 },
  // As tall as a card, even when empty, so that nothing moves when the last card is played.
  hand: { flexGrow: 0, flexShrink: 0, height: CARD_HEIGHT + 16, paddingHorizontal: 12, paddingVertical: 8 },
  // Room for two rows, so that the hand does not move on most selections; more rows push it up, then scroll.
  actions: { flexGrow: 0, flexShrink: 0, minHeight: 96, maxHeight: 200, paddingHorizontal: 12 },
});
