// The panels under the hand: the text of the selected card, and what is asked of the player (the targets of that
// card, a payment, a Veto). They draw what `prompts.ts` worked out and report taps; the selection lives in `Table`.

import type { Action, CardId } from '@atlas/engine';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { actionLabel } from './actions.ts';
import { cardText } from './cardText.ts';
import { Button, Choice, shared } from './parts.tsx';
import type { CardPrompt, PayPrompt, Slot, VetoPrompt } from './prompts.ts';
import { colors, countryColor } from './theme.ts';

/** A card in full. `onClose` puts it away: for a card that is only read, with no panel of its own to cancel. */
export function CardText({ card, onClose }: { card: CardId; onClose?: () => void }) {
  const { name, lines } = cardText(card);
  return (
    <View style={styles.text}>
      <View style={styles.heading}>
        <Text style={styles.title}>{name}</Text>
        {onClose && (
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={styles.close}>Close</Text>
          </Pressable>
        )}
      </View>
      {lines.map((line, i) => (
        <Text key={i} style={styles.line}>
          {line}
        </Text>
      ))}
    </View>
  );
}

/** What a selected card can do: at once, or once the targets to pick are confirmed. */
export function CardPanel({
  prompt,
  names,
  onPick,
  onAction,
  onCancel,
}: {
  prompt: CardPrompt;
  names: readonly string[];
  onPick: (slot: Slot, key: string) => void;
  onAction: (action: Action) => void;
  onCancel: () => void;
}) {
  const { chosen, confirm, steps } = prompt;
  return (
    <View style={styles.panel}>
      {steps.length > 0 && (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.steps}>
          {steps.map((step) => (
            <View key={step.slot} style={styles.step}>
              <Text style={shared.small}>{step.title}</Text>
              {step.groups.map((group) => (
                <View key={String(group.seat)} style={[shared.wrap, styles.group]}>
                  {group.seat !== null && <Text style={styles.owner}>{names[group.seat]}</Text>}
                  {group.options.map((option) => (
                    <Choice
                      key={option.key}
                      label={option.label}
                      picked={option.picked}
                      color={option.country && countryColor(option.country)}
                      onPress={() => onPick(step.slot, option.key)}
                    />
                  ))}
                </View>
              ))}
            </View>
          ))}
        </ScrollView>
      )}
      <View style={shared.wrap}>
        <Button quiet label="Cancel" onPress={onCancel} />
        {prompt.direct.map((action, i) => (
          <Button key={i} label={actionLabel(action, names)} onPress={() => onAction(action)} />
        ))}
      </View>
      {/* On its own line, so that nothing moves when its label changes. */}
      {confirm !== null && <Button label={confirm} disabled={!chosen} onPress={() => chosen && onAction(chosen)} />}
    </View>
  );
}

/** A payment: what is owed, what the picked cards add up to, and the cards to pay with. */
export function PayPanel({
  prompt,
  onToggle,
  onClear,
  onConfirm,
}: {
  prompt: PayPrompt;
  onToggle: (card: string) => void;
  onClear: () => void;
  onConfirm: () => void;
}) {
  return (
    <View style={styles.panel}>
      <Text style={styles.title}>{prompt.summary}</Text>
      <Text style={shared.small}>No change is given. Pay with banked cards and laid cities, never from your hand.</Text>
      <ScrollView style={styles.scroll} contentContainerStyle={shared.wrap}>
        {prompt.cards.map((card) => (
          <Choice
            key={card.key}
            label={card.label}
            picked={card.picked}
            color={card.country && countryColor(card.country)}
            dimmed={card.disabled}
            onPress={card.disabled ? undefined : () => onToggle(card.key)}
          />
        ))}
      </ScrollView>
      <View style={shared.wrap}>
        <Button quiet label="Clear" disabled={prompt.total === 0} onPress={onClear} />
        <Button label={`Pay ${prompt.total}`} disabled={prompt.actions.length === 0} onPress={onConfirm} />
      </View>
    </View>
  );
}

/**
 * A Veto question: answer with a Veto, or let things stand. The question itself is the table's prompt line.
 * `general` are the actions the table offers as plain buttons: declining is one of them, worded for the question.
 */
export function VetoPanel({
  prompt,
  general,
  names,
  onAction,
}: {
  prompt: VetoPrompt;
  general: readonly Action[];
  names: readonly string[];
  onAction: (action: Action) => void;
}) {
  const { veto } = prompt;
  return (
    <View style={[shared.wrap, styles.panel]}>
      {general.map((action, i) => (
        <Button
          key={i}
          quiet
          label={action.type === 'decline' ? prompt.declineLabel : actionLabel(action, names)}
          onPress={() => onAction(action)}
        />
      ))}
      {veto && <Button label="Play Veto" onPress={() => onAction(veto)} />}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { flexShrink: 1, paddingHorizontal: 12, paddingBottom: 8, gap: 6 },
  title: { color: colors.ink, fontSize: 13, fontWeight: '600' },
  text: { paddingHorizontal: 12, paddingBottom: 6, gap: 1 },
  heading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  close: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  line: { color: colors.ink, fontSize: 12 },
  // The choices scroll when they are many; the title and the buttons stay in view.
  scroll: { flexGrow: 0, flexShrink: 1, maxHeight: 220 },
  steps: { gap: 8 },
  step: { gap: 4 },
  group: { alignItems: 'center' },
  owner: { color: colors.ink, fontSize: 12, fontWeight: '700' },
});
