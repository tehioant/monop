// The table, for solo and online play alike. It is driven only by one player's view and that player's
// legal actions, and holds no rules: a control exists exactly when the engine listed an action for it.

import type { Action, CardId, PlayerView } from '@atlas/engine';
import { Fragment, useEffect, useRef, useState, type ComponentRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { signal } from '../settings/feedback.ts';
import { actionLabel, bankTotal, completeCount, groupActions, logLine, promptText, shownCards } from './actions.ts';
import { FLIGHT_MS, Flights, STAGGER_MS, type Flight, type Point } from './Flights.tsx';
import { sinceLastTurn } from './log.ts';
import { LogSheet } from './LogSheet.tsx';
import { cueBetween, movesBetween, type Cue, type Move, type Zone } from './moves.ts';
import { Button, CARD_HEIGHT, CARD_WIDTH, CardView, Chip, CountryView, Panel, shared, type Tappable } from './parts.tsx';
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
  /** The view the picks were made in: authoritative corrections also invalidate them. */
  at: PlayerView;
  /** The card tapped last. Its text stays up for as long as the card is on the table, whatever happens in the game. */
  card: CardId | null;
  /** The targets picked for `card`. */
  picks: Picks;
  /** The cards picked to pay with, in order. */
  paying: readonly CardId[];
}

const NOTHING: Omit<Selection, 'at'> = { card: null, picks: {}, paying: [] };

/** What led to the view on screen from the one shown before it. */
interface Step {
  before: PlayerView;
  /** The cards to show moving. */
  moves: Move[];
  /** The event to play a sound and a haptic for. */
  cue: Cue | null;
}

/** The most log entries one action writes. A view further ahead of the last one is shown as it is, with no movement. */
const STEP_ENTRIES = 4;

function stepBetween(before: PlayerView, after: PlayerView): Step {
  const entries = after.log.length - before.log.length;
  if (entries < 1 || entries > STEP_ENTRIES) return { before: after, moves: [], cue: null };
  return { before, moves: movesBetween(before, after), cue: cueBetween(before, after) };
}

/** After the player has scrolled the board themselves, it is left where they put it for this long. */
const HANDS_OFF_MS = 4000;
/** Between two cards of the hand, and before the first. */
const HAND_GAP = 6;
const HAND_PADDING = 12;

interface Rect extends Point {
  width: number;
  height: number;
}

type Node = ComponentRef<typeof View>;

function measure(node: Node | null | undefined): Promise<Rect | undefined> {
  return new Promise((resolve) => {
    if (node) node.measureInWindow((x, y, width, height) => resolve({ x, y, width, height }));
    else resolve(undefined);
  });
}

/** Where a place is drawn: the view that holds it, and how far across and down that view its cards are. */
function spot(zone: Zone, viewer: number): { anchor: string; across: number; down: number } {
  const [place, seat] = zone.split(':');
  if (seat === undefined) return { anchor: zone, across: 0.5, down: 0.5 };
  if (place !== 'hand') return { anchor: `seat:${seat}`, across: 0.25, down: 1 };
  // An opponent's hand is the count in the heading of their area.
  return Number(seat) === viewer ? { anchor: 'hand', across: 0.5, down: 0.5 } : { anchor: `seat:${seat}`, across: 0.6, down: 0 };
}

export function Table({ view, legal, names, onAction }: TableProps) {
  const [selection, setSelection] = useState<Selection>({ ...NOTHING, at: view });
  const [logOpen, setLogOpen] = useState(false);
  const [seen, setSeen] = useState({ view, step: stepBetween(view, view) });
  // A new view: what changed since the last one is worked out once, as it comes in.
  if (seen.view !== view) setSeen({ view, step: stepBetween(seen.view, view) });
  const { step } = seen;
  const [flights, setFlights] = useState<Flight[]>([]);
  /** The views that cards fly between, measured when a card moves. */
  const anchors = useRef<Record<string, Node | null>>({});
  const anchor = (key: string) => (node: Node | null) => {
    anchors.current[key] = node;
  };
  const board = useRef<ComponentRef<typeof ScrollView>>(null);
  const hand = useRef<ComponentRef<typeof ScrollView>>(null);
  /** Where the board and the hand are scrolled to, and where each opponent is on the board. */
  const scrolled = useRef({ board: 0, height: 0, touched: 0, hand: 0, rows: {} as Record<number, { y: number; height: number }> });
  /** Confirmed payments still to send. */
  const [queue, setQueue] = useState<CardId[]>([]);
  /** The opponents whose area is expanded. */
  const [expanded, setExpanded] = useState<readonly number[]>([]);
  const now = view.log.length;
  const fresh = selection.at === view;
  const { picks, paying } = fresh ? selection : NOTHING;
  const selected = selection.card !== null && shownCards(view).has(selection.card) ? selection.card : null;
  const select = (change: Partial<Selection>) => setSelection({ card: selected, picks, paying, ...change, at: view });
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

  /** Brings into view the opponent whose cards move and the card that reaches the viewer's hand. */
  const follow = (moves: readonly Move[]) => {
    const { rows, height, touched } = scrolled.current;
    const seats = moves.flatMap(({ from, to }) => [from, to]).map((zone) => Number(zone.split(':')[1]));
    const row = rows[seats.find((seat) => seat !== view.viewer && rows[seat]) ?? -1];
    if (row && Date.now() - touched > HANDS_OFF_MS) {
      const top = scrolled.current.board;
      if (row.y < top) board.current?.scrollTo({ y: row.y - 8, animated: false });
      else if (row.y + row.height > top + height) board.current?.scrollTo({ y: row.y + row.height + 8 - height, animated: false });
    }
    if (moves.some(({ to }) => to === `hand:${view.viewer}`)) hand.current?.scrollToEnd({ animated: false });
  };

  // The sound of the step, and its cards in flight from where they were to where they are now.
  useEffect(() => {
    if (step.cue) signal(step.cue);
    if (step.moves.length === 0) return;
    let stale = false;
    const fly = async () => {
      follow(step.moves);
      await new Promise(requestAnimationFrame);
      const keys = Object.keys(anchors.current);
      const rects = new Map(await Promise.all(keys.map(async (key) => [key, await measure(anchors.current[key])] as const)));
      const table = rects.get('table');
      const visible = rects.get('board');
      if (stale || !table || !visible) return;
      const point = (zone: Zone, card: CardId | null, cards: readonly CardId[]): Point | undefined => {
        const { anchor, across, down } = spot(zone, view.viewer);
        const rect = rects.get(anchor);
        if (!rect) return undefined;
        const inset = Math.min(18, rect.height / 2);
        let x = rect.x + rect.width * across;
        let y = rect.y + inset + (rect.height - 2 * inset) * down;
        if (anchor === 'hand' && card !== null && cards.includes(card)) {
          // The card's own place in the hand, as far as it is in sight.
          const offset = HAND_PADDING + cards.indexOf(card) * (CARD_WIDTH + HAND_GAP) + CARD_WIDTH / 2 - scrolled.current.hand;
          x = rect.x + Math.max(0, Math.min(rect.width, offset));
        } else if (anchor !== 'hand' && anchor !== `seat:${view.viewer}`) {
          // A place the board has scrolled out of sight is at the edge it went out by.
          y = Math.max(visible.y, Math.min(visible.y + visible.height, y));
        }
        return { x: x - table.x, y: y - table.y };
      };
      const taking = step.moves.flatMap(({ card, from, to }, i): Flight[] => {
        const start = point(from, card, step.before.hand);
        const end = point(to, card, view.hand);
        return start && end ? [{ key: `${now}:${i}`, card, from: start, to: end, delay: i * STAGGER_MS }] : [];
      });
      // The cards of the step before may still be in the air.
      setFlights((flying) => [...flying.slice(-6), ...taking]);
    };
    void fly();
    return () => {
      stale = true;
    };
  }, [step]);
  const landing = new Map(step.moves.map(({ card }, i) => [card, FLIGHT_MS + i * STAGGER_MS]));

  /** Any card on the table: a tap shows its text, a second tap puts it away. */
  const readable = (id: CardId): Tappable => ({
    id,
    selected: id === selected,
    landing: landing.get(id),
    // A card whose text stayed up while the game moved on is selected anew by a tap, to be played.
    onPress: () => select({ card: id === selected && (selectedActions || !byCard.has(id)) ? null : id, picks: {} }),
  });
  /** A card of the viewer's or of the Market: dimmed unless it has a legal action, which a tap then offers. */
  const tappable = (id: CardId): Tappable => {
    // While the viewer owes, a tap on a card they can pay with picks it too; not once the payment is on its way.
    const payable = queue.length === 0 ? pay?.cards.find((card) => card.key === id) : undefined;
    if (pay && payable) {
      const onPress = () => select({ card: id, paying: togglePay(pay, paying, id) });
      return { id, selected: payable.picked, dimmed: payable.disabled, onPress, landing: landing.get(id) };
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

  const recent = sinceLastTurn(view.log, view.viewer);

  return (
    <View ref={anchor('table')} style={styles.table}>
      <ScrollView
        ref={(node) => { board.current = node; anchor('board')(node); }}
        style={styles.scroll}
        contentContainerStyle={styles.board}
        scrollEventThrottle={16}
        onLayout={(event) => (scrolled.current.height = event.nativeEvent.layout.height)}
        onScroll={(event) => (scrolled.current.board = event.nativeEvent.contentOffset.y)}
        onScrollBeginDrag={() => (scrolled.current.touched = Date.now())}
        onScrollEndDrag={() => (scrolled.current.touched = Date.now())}
      >
        <View style={styles.row}>
          <Text style={styles.target}>First to {view.options.countriesToWin} countries</Text>
          <View style={styles.piles}>
            <Text ref={anchor('deck')} style={shared.small}>
              Deck {view.deckSize}
            </Text>
            <View ref={anchor('discard')} style={styles.piles}>
              <Text style={shared.small}>· Discard{view.discardTop === null ? ' empty' : ''}</Text>
              {view.discardTop !== null && <Chip {...readable(view.discardTop)} />}
            </View>
          </View>
        </View>

        <View style={styles.middle}>
          <Panel ref={anchor('market')}>
            <Text style={shared.small}>Market</Text>
            <View style={styles.cards}>
              {view.market.map((id) => (
                <CardView key={id} {...tappable(id)} />
              ))}
            </View>
          </Panel>
          {/* What happened since the viewer's last turn, the latest last; a tap opens the log in full. */}
          <Pressable style={styles.log} onPress={() => setLogOpen(true)} accessibilityLabel="Open the log">
            {recent.slice(-LOG_ENTRIES).map((entry, i, lines) => (
              <Text key={recent.length - lines.length + i} style={i === lines.length - 1 ? styles.latest : shared.small} numberOfLines={2}>
                {logLine(entry, names)}
              </Text>
            ))}
            <Text style={styles.more}>Since your turn: {recent.length} ▸</Text>
          </Pressable>
        </View>

        {/* An opponent is a summary; a tap expands it to their exact cities and bank, another folds it back. */}
        {opponents.map((seat) => {
          const player = view.players[seat]!;
          const open = expanded.includes(seat);
          return (
            <Pressable
              key={seat}
              ref={anchor(`seat:${seat}`)}
              onLayout={(event) => (scrolled.current.rows[seat] = event.nativeEvent.layout)}
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

      {/* The player's own side of the table, with an edge of its own: the board scrolls behind it. */}
      <ScrollView style={styles.own} contentContainerStyle={styles.ownContent} nestedScrollEnabled>
        <Panel ref={anchor(`seat:${view.viewer}`)} highlighted={view.viewer === waitingOn} style={styles.mine}>
          <View style={styles.row}>
            <Text style={shared.name}>{names[view.viewer]}</Text>
            <Text style={shared.small}>
              Bank {bankTotal(view.players[view.viewer]!.bank)} · {countries(view, view.viewer)}
            </Text>
          </View>
          {holdings(view.viewer, tappable)}
        </Panel>

        <Text style={styles.prompt}>{pay?.text ?? veto?.text ?? promptText(view, names)}</Text>
        <View ref={anchor('hand')}>
          <ScrollView
            ref={hand}
            horizontal
            style={styles.hand}
            contentContainerStyle={styles.cards}
            scrollEventThrottle={16}
            onScroll={(event) => (scrolled.current.hand = event.nativeEvent.contentOffset.x)}
          >
            {view.hand.map((id) => (
              <CardView key={id} {...tappable(id)} />
            ))}
          </ScrollView>
        </View>
        <View style={styles.actions}>
          {selected !== null && <CardText card={selected} onClose={selectedActions ? undefined : () => select({ card: null })} />}
          {prompt()}
        </View>
      </ScrollView>
      <Flights flights={flights} />
      {logOpen && <LogSheet log={view.log} viewer={view.viewer} names={names} onClose={() => setLogOpen(false)} />}
    </View>
  );
}

function countries(view: PlayerView, seat: number): string {
  return `Countries ${completeCount(view.players[seat]!.table)}/${view.options.countriesToWin}`;
}

const styles = StyleSheet.create({
  table: { flex: 1 },
  // Opponents retain a reachable viewport; large own holdings and prompts scroll independently.
  scroll: { flex: 1, minHeight: '36%' },
  board: { paddingHorizontal: 12, paddingBottom: 8, gap: 8 },
  own: { flexGrow: 0, flexShrink: 1, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.background },
  ownContent: { paddingTop: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
  middle: { flexDirection: 'row', gap: 8 },
  // The latest entries, beside the Market and no taller than it.
  log: { flex: 1, justifyContent: 'flex-end', gap: 2, overflow: 'hidden' },
  latest: { color: colors.ink, fontSize: 12, fontWeight: '600' },
  more: { color: colors.accent, fontSize: 12, fontWeight: '600' },
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
