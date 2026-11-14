// The pieces the table and the results screen are drawn from: a card, a country, a button.

import type { CardId, PlayerView } from '@atlas/engine';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { cardInfo, countrySize, title } from './actions.ts';
import { colors, countryColor } from './theme.ts';

type Stack = PlayerView['players'][number]['table'][number];

/** A card drawn from its data. Dimmed and inert without `onPress`. */
export function CardView({ id, selected, onPress }: { id: CardId; selected?: boolean; onPress?: () => void }) {
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
      <Text style={styles.cardName} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.7}>
        {name}
      </Text>
      <Text style={styles.cardValue}>{value}</Text>
    </Pressable>
  );
}

/** A country with its progress; `detailed` lists the cities laid in it. */
export function CountryView({ stack, detailed }: { stack: Stack; detailed?: boolean }) {
  const progress = `${stack.cities.length}/${countrySize(stack.country)}`;
  return (
    <View style={[styles.country, { backgroundColor: countryColor(stack.country) }, stack.complete && styles.complete]}>
      <Text style={styles.countryName}>
        {title(stack.country)} {progress}
        {stack.complete ? ' ✓' : ''}
      </Text>
      {detailed && <Text style={styles.countryCities}>{stack.cities.map((id) => cardInfo(id).name).join(', ')}</Text>}
    </View>
  );
}

export function Button({ label, onPress, quiet }: { label: string; onPress: () => void; quiet?: boolean }) {
  return (
    <Pressable onPress={onPress} style={[styles.button, quiet && styles.buttonQuiet]}>
      <Text style={[styles.buttonText, quiet && styles.buttonQuietText]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 68,
    height: 96,
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
  country: { borderRadius: 6, paddingVertical: 4, paddingHorizontal: 8, borderWidth: 2, borderColor: 'transparent' },
  complete: { borderColor: colors.ink },
  countryName: { color: '#fff', fontSize: 12, fontWeight: '700' },
  countryCities: { color: '#fff', fontSize: 11 },
  button: { backgroundColor: colors.accent, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 14 },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '600', textAlign: 'center' },
  buttonQuiet: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.line },
  buttonQuietText: { color: colors.ink },
});
