// The pieces the table and the results screen are drawn from.

import type { CardId, PlayerView } from '@atlas/engine';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { cardInfo, countrySize, title } from './actions.ts';
import { colors, countryColor } from './theme.ts';

type Stack = PlayerView['players'][number]['table'][number];

/** A card the table draws. Dimmed and inert without `onPress`. */
export interface Tappable {
  id: CardId;
  selected?: boolean;
  onPress?: () => void;
}

export const CARD_HEIGHT = 96;

/** A card drawn from its data. */
export function CardView({ id, selected, onPress }: Tappable) {
  const { name, kind, value, country } = cardInfo(id);
  const band = country ? countryColor(country) : kind === 'coin' ? colors.coin : colors.action;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityLabel={name}
      style={[styles.card, selected && styles.cardSelected, !onPress && styles.dimmed]}
    >
      <View style={[styles.cardBand, { backgroundColor: band }]}>
        <Text style={styles.cardBandText} numberOfLines={1}>
          {country ? title(country) : title(kind)}
        </Text>
      </View>
      {/* One line per word at most, shrunk to fit: a long name is never cut in the middle. */}
      <Text
        style={styles.cardName}
        numberOfLines={Math.min(name.split(/[ /]/).length, 3)}
        adjustsFontSizeToFit
        minimumFontScale={0.6}
      >
        {name}
      </Text>
      <Text style={styles.cardValue}>{value}</Text>
    </Pressable>
  );
}

/** A country with its progress, and a line of `detail` if given. */
export function CountryView({ stack, detail }: { stack: Stack; detail?: string }) {
  const progress = `${stack.cities.length}/${countrySize(stack.country)}`;
  return (
    <View style={[styles.country, { backgroundColor: countryColor(stack.country) }, stack.complete && styles.complete]}>
      <Text style={styles.countryName}>
        {title(stack.country)} {progress}
        {stack.complete ? ' ✓' : ''}
        {detail !== undefined && <Text style={styles.countryDetail}>{`  ${detail}`}</Text>}
      </Text>
    </View>
  );
}

/** A card on the table, by name only. `color` outlines it: the country it is laid in. */
export function Chip({ id, selected, onPress, color }: Tappable & { color?: string }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={[
        styles.chip,
        color !== undefined && { borderColor: color },
        selected && styles.chipSelected,
        !onPress && styles.dimmed,
      ]}
    >
      <Text style={styles.chipText}>{cardInfo(id).name}</Text>
    </Pressable>
  );
}

/** A player's area. `highlighted` outlines it: the player to act, or the winner. */
export function Panel({ highlighted, style, children }: { highlighted?: boolean; style?: ViewStyle; children: ReactNode }) {
  return <View style={[styles.panel, highlighted && styles.highlighted, style]}>{children}</View>;
}

export function Button({ label, onPress, quiet }: { label: string; onPress: () => void; quiet?: boolean }) {
  return (
    <Pressable onPress={onPress} style={[styles.button, quiet && styles.buttonQuiet]}>
      <Text style={[styles.buttonText, quiet && styles.buttonQuietText]}>{label}</Text>
    </Pressable>
  );
}

/** Styles the table and the results screen share. */
export const shared = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  name: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  small: { color: colors.muted, fontSize: 12 },
});

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.surface,
    padding: 8,
    gap: 6,
  },
  highlighted: { borderColor: colors.accent },
  card: {
    width: 68,
    height: CARD_HEIGHT,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    alignItems: 'center',
  },
  cardSelected: { borderColor: colors.accent, borderWidth: 3 },
  dimmed: { opacity: 0.6 },
  cardBand: { alignSelf: 'stretch', paddingVertical: 3, paddingHorizontal: 2 },
  cardBandText: { color: '#fff', fontSize: 10, fontWeight: '700', textAlign: 'center' },
  cardName: { flex: 1, color: colors.ink, fontSize: 12, fontWeight: '600', textAlign: 'center', padding: 4 },
  cardValue: { color: colors.coin, fontSize: 13, fontWeight: '700', paddingBottom: 4 },
  country: {
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  complete: { borderColor: colors.ink },
  countryName: { color: '#fff', fontSize: 12, fontWeight: '700' },
  countryDetail: { fontWeight: '400' },
  chip: {
    backgroundColor: colors.surface,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: colors.line,
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  chipSelected: { borderColor: colors.accent, backgroundColor: '#dbe4ff' },
  chipText: { color: colors.ink, fontSize: 12, fontWeight: '600' },
  button: { backgroundColor: colors.accent, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 14 },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '600', textAlign: 'center' },
  buttonQuiet: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.line },
  buttonQuietText: { color: colors.ink },
});
