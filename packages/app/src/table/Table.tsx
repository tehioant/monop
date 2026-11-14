// The table, for solo and online play alike. It is driven only by one player's view and that player's
// legal actions, and holds no rules: a control exists exactly when the engine listed an action for it.

import type { Action, CardId, PlayerView } from '@atlas/engine';
import { Fragment, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { actionLabel, bankTotal, cardInfo, completeCount, groupActions, logLine, promptText } from './actions.ts';
import { Button, CARD_HEIGHT, CardView, Chip, CountryView, Panel, shared, type Tappable } from './parts.tsx';
import { CardPanel, PayPanel, VetoPanel } from './Prompt.tsx';
import { cardPrompt, payPrompt, togglePay, vetoPrompt, type Picks } from './prompts.ts';
import { colors, countryColor } from './theme.ts';

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

/** What the player has picked but not sent: all of it is dropped by a cancel, and nothing reaches the game. */
interface Selection {
  /** The length of the log the picks were made at: they are void as soon as anything happens in the game. */
  at: number;
  card: CardId | null;
  /** The targets picked for `card`. */
  picks: Picks;
  /** The cards picked to pay with, in order. */
  paying: CardId[];
}

const NOTHING: Omit<Selection, 'at'> = { card: null, picks: {}, paying: [] };

export function Table({ view, legal, names, onAction }: TableProps) {
  const [selection, setSelection] = useState<Selection>({ ...NOTHING, at: 0 });
  /** Confirmed payments still to send. */
  const [queue, setQueue] = useState<CardId[]>([]);
  const now = view.log.length;
  const { card: selected, picks, paying } = selection.at === now ? selection : NOTHING;
  const select = (change: Partial<Selection>) => setSelection({ card: selected, picks, paying, ...change, at: now });

  const { byCard, general } = groupActions(view, legal);
  const selectedActions = selected === null ? undefined : byCard.get(selected);
  const pay = payPrompt(view, legal, paying, names);
  const veto = vetoPrompt(view, legal, names);
  const me = view.players[view.viewer]!;
  const opponents = view.players.map((_, i) => (view.viewer + i) % view.players.length).slice(1);
  const waitingOn = view.phase.kind === 'over' ? null : view.phase.player;

  // A payment of several cards goes out one card per view: the next once the game has answered the last.
  // A card the game no longer asks for (the debt is settled, the game is over) ends it.
  useEffect(() => {
    if (queue.length === 0) return;
    const next = legal.find((action) => action.type === 'pay' && action.card === queue[0]);
    setQueue(next ? queue.slice(1) : []);
    if (next) onAction(next);
  }, [now]);
  const confirmPayment = ([first, ...rest]: Action[]) => {
    setQueue(rest.flatMap((action) => ('card' in action ? [action.card] : [])));
    if (first) onAction(first);
  };

  /** Picks a card to pay with or puts it back; undefined for a card that cannot be added (or paid with at all). */
  const togglePayment = (id: CardId) => {
    const next = pay && togglePay(pay, paying, id);
    return next && next.length !== paying.length ? () => select({ paying: next }) : undefined;
  };
  /** A card of the viewer's or of the Market: it can be tapped exactly when it has a legal action. */
  const tappable = (id: CardId): Tappable => {
    // While the viewer owes, their cards are picked to pay with, and none is selected for anything else.
    if (pay) return { id, selected: paying.includes(id), onPress: togglePayment(id) };
    return {
      id,
      selected: selectedActions !== undefined && id === selected,
      onPress: byCard.has(id) ? () => select({ card: id === selected ? null : id, picks: {} }) : undefined,
    };
  };
  const perkActive = (seat: number, country: string) =>
    view.perks.some((perk) => perk.country === country && perk.activeFor.includes(seat));

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
                    <CountryView key={stack.country} stack={stack} active={perkActive(seat, stack.country)} />
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
            {/* Each country, then its cities, in one flat row that wraps: a country never splits oddly. */}
            {me.table.map((stack) => (
              <Fragment key={stack.country}>
                <CountryView stack={stack} active={perkActive(view.viewer, stack.country)} />
                {stack.cities.map((id) => (
                  <Chip key={id} {...tappable(id)} color={countryColor(stack.country)} />
                ))}
              </Fragment>
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

      <Text style={styles.prompt}>{pay?.text ?? veto?.text ?? promptText(view, names)}</Text>
      <ScrollView horizontal style={styles.hand} contentContainerStyle={styles.cards}>
        {view.hand.map((id) => (
          <CardView key={id} {...tappable(id)} />
        ))}
      </ScrollView>
      <View style={styles.actions}>
        {queue.length > 0 ? null : pay ? (
          <PayPanel
            prompt={pay}
            onToggle={togglePayment}
            onClear={() => select({ paying: [] })}
            onConfirm={() => confirmPayment(pay.actions)}
          />
        ) : selected !== null && selectedActions ? (
          <CardPanel
            prompt={cardPrompt(view, selected, selectedActions, picks, names)}
            names={names}
            onPick={(slot, key) => select({ picks: { ...picks, [slot]: key } })}
            onAction={onAction}
            onCancel={() => select(NOTHING)}
          />
        ) : veto ? (
          <VetoPanel prompt={veto} onAction={onAction} />
        ) : (
          <View style={styles.buttons}>
            {general.map((action, i) => (
              <Button key={i} label={actionLabel(action, names)} onPress={() => onAction(action)} />
            ))}
          </View>
        )}
      </View>
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
  // Room for two rows of buttons, so that the hand does not move on most selections; a longer prompt pushes it up.
  actions: { flexShrink: 0, minHeight: 96 },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 12 },
});
