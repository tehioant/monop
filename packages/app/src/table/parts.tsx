// The pieces the table and the results screen are drawn from.

import type { CardId, PlayerView } from '@atlas/engine';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { cardInfo, countryPerk, countrySize, title } from './actions.ts';
import { colors, countryColor } from './theme.ts';

type Stack = PlayerView['players'][number]['table'][number];

/** A card the table draws. `dimmed` says that nothing can be done with it now; it is inert without `onPress`. */
export interface Tappable {
  id: CardId;
  selected?: boolean;
  dimmed?: boolean;
  onPress?: () => void;
}

export const CARD_HEIGHT = 96;

/** A card drawn from its data. */
export function CardView({ id, selected, dimmed, onPress }: Tappable) {
  const { name, kind, value, country } = cardInfo(id);
  const perk = country && countryPerk(country);
  const band = country ? countryColor(country) : kind === 'coin' ? colors.coin : colors.action;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityLabel={name}
      style={[styles.card, selected && styles.cardSelected, dimmed && styles.dimmed]}
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
      {/* What the city's country gives once complete: visible before the city is laid. */}
      {perk && <Text style={styles.cardPerk}>{perk.label}</Text>}
      <Text style={styles.cardValue}>{value}</Text>
    </Pressable>
  );
}

/**
 * A country with its progress and its upgrades, and a line of `detail` if given. With `active` given, its perk
 * too: marked as active for a holder it is in force for, plain otherwise.
 */
export function CountryView({ stack, detail, active }: { stack: Stack; detail?: string; active?: boolean }) {
  const progress = `${stack.cities.length}/${countrySize(stack.country)}`;
  const upgrades = stack.upgrades.length;
  const perk = active === undefined ? undefined : countryPerk(stack.country);
  return (
    <View style={[styles.country, { backgroundColor: countryColor(stack.country) }, stack.complete && styles.complete]}>
      <Text style={styles.countryName}>
        {title(stack.country)} {progress}
        {stack.complete ? ' ✓ complete' : ''}
        {upgrades > 0 ? ` · ${upgrades} upgrade${upgrades > 1 ? 's' : ''}` : ''}
        {detail !== undefined && <Text style={styles.countryDetail}>{`  ${detail}`}</Text>}
      </Text>
      {perk && <Text style={[styles.perk, active && styles.perkActive]}>{active ? `★ ${perk.label}` : perk.label}</Text>}
    </View>
  );
}

/** A card on the table, by name only. `color` outlines it: the country it is laid in. */
export function Chip({ id, selected, dimmed, onPress, color }: Tappable & { color?: string }) {
  return <Choice label={cardInfo(id).name} picked={selected} dimmed={dimmed ?? false} onPress={onPress} color={color} />;
}

/** Something to pick, by its label. Inert without `onPress`, and dimmed then unless `dimmed` says otherwise. */
export function Choice({
  label,
  picked,
  onPress,
  color,
  dimmed = !onPress,
}: {
  label: string;
  picked?: boolean;
  onPress?: () => void;
  color?: string;
  dimmed?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={[
        styles.chip,
        color !== undefined && { borderColor: color },
        picked && styles.chipSelected,
        dimmed && styles.dimmed,
      ]}
    >
      <Text style={styles.chipText}>{label}</Text>
    </Pressable>
  );
}

/** A player's area. `highlighted` outlines it: the player to act, or the winner. */
export function Panel({ highlighted, style, children }: { highlighted?: boolean; style?: ViewStyle; children: ReactNode }) {
  return <View style={[styles.panel, highlighted && styles.highlighted, style]}>{children}</View>;
}

export function Button({ label, onPress, quiet, disabled }: { label: string; onPress: () => void; quiet?: boolean; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.button, quiet && styles.buttonQuiet, disabled && styles.dimmed]}>
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
  cardPerk: { color: colors.muted, fontSize: 9, fontWeight: '600' },
  cardValue: { color: colors.coin, fontSize: 13, fontWeight: '700', paddingBottom: 4 },
  country: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  complete: { borderColor: colors.ink, borderWidth: 3 },
  perk: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '600',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#ffffff99',
    paddingHorizontal: 4,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  perkActive: { color: colors.ink, backgroundColor: colors.active, borderColor: colors.active, fontWeight: '800' },
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
