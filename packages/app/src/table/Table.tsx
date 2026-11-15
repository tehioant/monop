// The table, for solo and online play alike. It is driven only by one player's view and that player's
// legal actions, and holds no rules: a control exists exactly when the engine listed an action for it.

import type { Action, CardId, PlayerView } from '@atlas/engine';
import { Fragment, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { actionLabel, bankTotal, completeCount, groupActions, logLine, promptText, shownCards } from './actions.ts';
import { Button, CARD_HEIGHT, CardView, Chip, CountryView, Panel, shared, type Tappable } from './parts.tsx';
import { CardPanel, CardText, PayPanel, VetoPanel } from './Prompt.tsx';
import { cardPrompt, payPrompt, togglePay, vetoPrompt, type PayPrompt, type Picks } from './prompts.ts';
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
  /** The card tapped last. Its text stays up for as long as the card is on the table, whatever happens in the game. */
  card: CardId | null;
  /** The targets picked for `card`. */
  picks: Picks;
  /** The cards picked to pay with, in order. */
  paying: readonly CardId[];
}

const NOTHING: Omit<Selection, 'at'> = { card: null, picks: {}, paying: [] };

export function Table({ view, legal, names, onAction }: TableProps) {
  const [selection, setSelection] = useState<Selection>({ ...NOTHING, at: 0 });
  /** Confirmed payments still to send. */
  const [queue, setQueue] = useState<CardId[]>([]);
  /** The opponents whose area is expanded. */
  const [expanded, setExpanded] = useState<readonly number[]>([]);
  const now = view.log.length;
  const fresh = selection.at === now;
  const { picks, paying } = fresh ? selection : NOTHING;
  const selected = selection.card !== null && shownCards(view).has(selection.card) ? selection.card : null;
  const select = (change: Partial<Selection>) => setSelection({ card: selected, picks, paying, ...change, at: now });
  /** Sends an action; what was picked for it has served. */
  const send = (action: Action) => {
    select(NOTHING);
    onAction(action);
  };

  const { byCard, general } = groupActions(view, legal);
  const pay = payPrompt(view, legal, paying, names);
  // The selected card is offered to play only if it was tapped in this very state of the game, and nothing is owed.
  const selectedActions = selected !== null && fresh && !pay ? byCard.get(selected) : undefined;
  const veto = vetoPrompt(view, legal, names);
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
  const confirmPayment = ([first, ...rest]: PayPrompt['actions']) => {
    setQueue(rest.map((action) => action.card));
    if (first) send(first);
  };

  /** Any card on the table: a tap shows its text, a second tap puts it away. */
  const readable = (id: CardId): Tappable => ({
    id,
    selected: id === selected,
    // A card whose text stayed up while the game moved on is selected anew by a tap, to be played.
    onPress: () => select({ card: id === selected && (selectedActions || !byCard.has(id)) ? null : id, picks: {} }),
  });
  /** A card of the viewer's or of the Market: dimmed unless it has a legal action, which a tap then offers. */
  const tappable = (id: CardId): Tappable => {
    // While the viewer owes, a tap on a card they can pay with picks it too; not once the payment is on its way.
    const payable = queue.length === 0 ? pay?.cards.find((card) => card.key === id) : undefined;
    if (pay && payable) {
      const onPress = () => select({ card: id, paying: togglePay(pay, paying, id) });
      return { id, selected: payable.picked, dimmed: payable.disabled, onPress };
    }
    return { ...readable(id), dimmed: pay !== null || !byCard.has(id) };
  };
  const perkActive = (seat: number, country: string) =>
    view.perks.some((perk) => perk.country === country && perk.activeFor.includes(seat));

  /** What a player has on the table, card by card: each country with its cities and upgrades, then the bank. */
  const holdings = (seat: number, card: (id: CardId) => Tappable) => {
    const { table, bank } = view.players[seat]!;
    return (
      <>
        {table.length > 0 && (
          <View style={shared.wrap}>
            {/* Each country, then its cards, in one flat row that wraps: a country never splits oddly. */}
            {table.map((stack) => (
              <Fragment key={stack.country}>
                <CountryView stack={stack} active={perkActive(seat, stack.country)} />
                {[...stack.cities, ...stack.upgrades].map((id) => (
                  <Chip key={id} {...card(id)} color={countryColor(stack.country)} />
                ))}
              </Fragment>
            ))}
          </View>
        )}
        {bank.length > 0 && (
          <View style={shared.wrap}>
            {bank.map((id) => (
              <Chip key={id} {...card(id)} />
            ))}
          </View>
        )}
      </>
    );
  };

  /** What is asked of the viewer under their hand: a payment, the targets of the selected card, a Veto, or buttons. */
  const prompt = () => {
    if (queue.length > 0) return null;
    if (pay) {
      return (
        <PayPanel
          prompt={pay}
          onToggle={(card) => select({ paying: togglePay(pay, paying, card) })}
          onClear={() => select({ paying: [] })}
          onConfirm={() => confirmPayment(pay.actions)}
        />
      );
    }
    if (selectedActions) {
      return (
        <CardPanel
          prompt={cardPrompt(view, selectedActions, picks, names)}
          names={names}
          onPick={(slot, key) => select({ picks: { ...picks, [slot]: key } })}
          onAction={send}
          onCancel={() => select(NOTHING)}
        />
      );
    }
    if (veto) return <VetoPanel prompt={veto} general={general} names={names} onAction={send} />;
    return (
      <View style={[shared.wrap, styles.buttons]}>
        {general.map((action, i) => (
          <Button key={i} label={actionLabel(action, names)} onPress={() => send(action)} />
        ))}
      </View>
    );
  };

  return (
    <View style={styles.table}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.board}>
        <View style={styles.row}>
          <Text style={styles.target}>First to {view.options.countriesToWin} countries</Text>
          <View style={styles.piles}>
            <Text style={shared.small}>
              Deck {view.deckSize} · Discard{view.discardTop === null ? ' empty' : ''}
            </Text>
            {view.discardTop !== null && <Chip {...readable(view.discardTop)} />}
          </View>
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

        {/* An opponent is a summary; a tap expands it to their exact cities and bank, another folds it back. */}
        {opponents.map((seat) => {
          const player = view.players[seat]!;
          const open = expanded.includes(seat);
          return (
            <Pressable
              key={seat}
              accessibilityLabel={`${names[seat]}: ${open ? 'hide' : 'show'} cities and bank`}
              onPress={() => setExpanded(open ? expanded.filter((other) => other !== seat) : [...expanded, seat])}
            >
              <Panel highlighted={seat === waitingOn}>
                <View style={styles.row}>
                  <Text style={shared.name}>
                    {open ? '▾' : '▸'} {names[seat]}
                  </Text>
                  <Text style={shared.small}>
                    Hand {player.handSize} · Bank {bankTotal(player.bank)} · {countries(view, seat)}
                  </Text>
                </View>
                {open && holdings(seat, readable)}
                {open && player.table.length + player.bank.length === 0 && (
                  <Text style={shared.small}>No city laid, nothing banked</Text>
                )}
                {!open && player.table.length > 0 && (
                  <View style={shared.wrap}>
                    {player.table.map((stack) => (
                      <CountryView key={stack.country} stack={stack} active={perkActive(seat, stack.country)} />
                    ))}
                  </View>
                )}
              </Panel>
            </Pressable>
          );
        })}
      </ScrollView>

      <Panel highlighted={view.viewer === waitingOn} style={styles.mine}>
        <View style={styles.row}>
          <Text style={shared.name}>{names[view.viewer]}</Text>
          <Text style={shared.small}>
            Bank {bankTotal(view.players[view.viewer]!.bank)} · {countries(view, view.viewer)}
          </Text>
        </View>
        {holdings(view.viewer, tappable)}
      </Panel>

      <Text style={styles.prompt}>{pay?.text ?? veto?.text ?? promptText(view, names)}</Text>
      <ScrollView horizontal style={styles.hand} contentContainerStyle={styles.cards}>
        {view.hand.map((id) => (
          <CardView key={id} {...tappable(id)} />
        ))}
      </ScrollView>
      <View style={styles.actions}>
        {selected !== null && <CardText card={selected} onClose={selectedActions ? undefined : () => select({ card: null })} />}
        {prompt()}
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
  piles: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  mine: { marginHorizontal: 12 },
  target: { color: colors.ink, fontSize: 16, fontWeight: '700' },
  prompt: { color: colors.ink, fontSize: 14, fontWeight: '600', paddingHorizontal: 12, paddingTop: 8 },
  // As tall as a card, even when empty, so that nothing moves when the last card is played.
  hand: { flexGrow: 0, flexShrink: 0, height: CARD_HEIGHT + 16, paddingHorizontal: 12, paddingVertical: 8 },
  // Room for two rows of buttons, so that the hand does not move on most selections; a longer prompt pushes it up.
  // On a screen too short for it all, the choices of a prompt give way and scroll: its buttons stay in view.
  actions: { flexShrink: 1, minHeight: 96 },
  buttons: { paddingHorizontal: 12 },
});
