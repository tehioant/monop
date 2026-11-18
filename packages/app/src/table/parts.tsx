// The pieces the table and the results screen are drawn from.

import { COUNTRIES, type CardId, type PlayerView } from '@atlas/engine';
import type { ComponentRef, ReactNode, Ref } from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import Animated, { ZoomIn } from 'react-native-reanimated';
import { cardInfo, countryPerk, countrySize, title } from './actions.ts';
import { cardArtwork, deckBack } from './cardArt.ts';
import { tollText } from './cardText.ts';
import { colors, countryColor } from './theme.ts';

type Stack = PlayerView['players'][number]['table'][number];

/** A card the table draws. `dimmed` says that nothing can be done with it now; it is inert without `onPress`. */
export interface Tappable {
  id: CardId;
  selected?: boolean;
  dimmed?: boolean;
  onPress?: () => void;
  /** How long the card takes to get here, in ms, if it has just moved: it shows once it has landed. */
  landing?: number;
}

export const CARD_WIDTH = 68;
export const CARD_HEIGHT = 96;

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const FACE_INK = '#203b3f';
const FACE_WHITE = '#fff7e4';
const WILD_INK = '#614c72';
const ACTION_INK = '#285d53';
const COIN_INK = '#714a21';
const ATLAS_COUNTRY_INK: Record<string, string> = {
  egypt: '#775725', australia: '#25696e', france: '#244d64', uk: '#393761', italy: '#375837',
  japan: '#833e36', brazil: '#235b46', usa: '#884b32', china: '#773b52', india: '#865322',
};

function cardCountryInk(country: string) {
  return ATLAS_COUNTRY_INK[country] ?? countryColor(country);
}

/**
 * A card that has just moved here shows only once it has landed. Decided when the card is first drawn there.
 * It grows into place rather than fades in: a fade would undo the dimming of a card that cannot be played.
 */
function landed(after: number | undefined) {
  return after === undefined ? undefined : ZoomIn.delay(after).duration(140);
}

function renderTollTiles(tolls: readonly number[], ink: string) {
  return (
    <View testID="city-tolls" style={styles.tollFooter}>
      <Text allowFontScaling={false} style={[styles.tollHeading, { color: ink }]}>TOLL</Text>
      <View style={styles.tollRow}>
        {tolls.map((amount, index) => {
          const complete = index === tolls.length - 1;
          return (
            <View key={index} style={[styles.tollTile, complete && styles.tollTileComplete]}>
              <Text allowFontScaling={false} style={styles.tollAmount}>{amount}</Text>
              <Text allowFontScaling={false} style={styles.tollMilestone}>{complete ? 'SET' : String(index + 1)}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

/** A card drawn from its data. */
export function CardView({ id, selected, dimmed, onPress, landing }: Tappable) {
  const { name, kind, value, country, countries, action } = cardInfo(id);
  const perk = country && countryPerk(country);
  const tolls = country ? COUNTRIES.find((entry) => entry.id === country)?.toll : undefined;
  const anyCountry = countries?.length === COUNTRIES.length;
  let artKey = action ?? id;
  let displayName = name;
  let ink = ACTION_INK;
  let label = title(kind);
  if (country) {
    ink = cardCountryInk(country);
    label = title(country);
  } else if (countries) {
    ink = WILD_INK;
    displayName = 'Wild';
    label = 'Any country';
    if (anyCountry) artKey = 'wild-any';
  } else if (kind === 'coin') {
    ink = COIN_INK;
    displayName = 'Coin';
    artKey = 'mint';
  }
  const artwork = cardArtwork[artKey];
  const split = countries && !anyCountry ? countries : undefined;
  const splitName = displayName.length > 11 && displayName.includes(' ');
  if (splitName) displayName = displayName.replace(/ (?=\S+$)/, '\n');
  const nameSize = displayName.length >= 9 ? 11 : displayName.length >= 7 ? 13 : 15;
  return (
    <AnimatedPressable
      entering={landed(landing)}
      onPress={onPress}
      disabled={!onPress}
      accessibilityLabel={tolls ? `${name}. Base toll: ${tollText(tolls)}.` : name}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityState={{ selected: !!selected }}
      style={[styles.card, tolls && styles.cityCard, selected && styles.cardSelected, dimmed && styles.dimmed]}
    >
      <View style={[styles.cardTop, tolls && styles.cityTop]}>
        <View style={styles.cardBadge}>
          <Text allowFontScaling={false} style={styles.cardValue}>{value}</Text>
          <View style={styles.coinMark} />
        </View>
        {tolls ? (
          <View style={styles.cityMetadata}>
            <Text allowFontScaling={false} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85} style={[styles.cityCountry, { color: ink }]}>{label.toUpperCase()}</Text>
            {perk && <Text allowFontScaling={false} numberOfLines={1} style={[styles.cityPerk, { color: ink }]}>{perk.label}</Text>}
          </View>
        ) : (
          <Text allowFontScaling={false} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85} style={[styles.cardTopLabel, { color: ink }]}>{kind.toUpperCase()}</Text>
        )}
      </View>
      <Text
        style={[styles.cardName, { fontSize: nameSize }, tolls && styles.cityName, splitName && styles.cardNameStacked]}
        numberOfLines={splitName ? 2 : 1}
        allowFontScaling={false}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
      >
        {displayName}
      </Text>
      <View style={styles.cardArtWindow}>
        {artwork !== undefined && <Image source={artwork} resizeMode="cover" style={styles.cardIllustration} accessible={false} />}
      </View>
      {tolls ? (
        renderTollTiles(tolls, ink)
      ) : split ? (
        <View style={styles.cardSplit}>
          {split.map((entry) => {
            const label = title(entry).toUpperCase();
            return (
              <View key={entry} style={[styles.cardBand, { flex: label.length, backgroundColor: cardCountryInk(entry) }]}>
                <Text allowFontScaling={false} numberOfLines={1} style={[styles.cardBandText, styles.cardSplitText]}>{label}</Text>
              </View>
            );
          })}
        </View>
      ) : (
        <View style={[styles.cardBand, { backgroundColor: ink }]}>
          <Text allowFontScaling={false} numberOfLines={1} style={[styles.cardBandText, label.length > 9 && styles.cardBandSmall]}>{label.toUpperCase()}</Text>
        </View>
      )}
    </AnimatedPressable>
  );
}

export function DeckBack({ full = false }: { full?: boolean } = {}) {
  return <Image source={deckBack} style={[styles.deckBack, full && styles.fullBack]} accessible={false} />;
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
export function Chip({ id, selected, dimmed, onPress, landing, color }: Tappable & { color?: string }) {
  return <Choice label={cardInfo(id).name} picked={selected} dimmed={dimmed} onPress={onPress} color={color} landing={landing} />;
}

/** Something to pick, by its label. Inert without `onPress`. */
export function Choice({
  label,
  picked,
  onPress,
  color,
  dimmed,
  landing,
}: {
  label: string;
  picked?: boolean;
  onPress?: () => void;
  color?: string;
  dimmed?: boolean;
  landing?: number;
}) {
  return (
    <AnimatedPressable
      entering={landed(landing)}
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
    </AnimatedPressable>
  );
}

/** A player's area. `highlighted` outlines it: the player to act, or the winner. */
export function Panel(props: { highlighted?: boolean; style?: ViewStyle; children: ReactNode; ref?: Ref<ComponentRef<typeof View>> }) {
  const { highlighted, style, children, ref } = props;
  return (
    <View ref={ref} style={[styles.panel, highlighted && styles.highlighted, style]}>
      {children}
    </View>
  );
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
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#c9bc98',
    backgroundColor: '#fbf3dd',
    overflow: 'hidden',
    flexShrink: 0,
    paddingHorizontal: 3,
    paddingTop: 3,
    paddingBottom: 4,
    gap: 2,
  },
  cityCard: { gap: 1 },
  cardSelected: { borderColor: colors.accent, boxShadow: `inset 0 0 0 1px ${colors.accent}` },
  dimmed: { opacity: 0.6 },
  cardTop: { height: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 1 },
  cardBadge: { minWidth: 18, height: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2, paddingHorizontal: 2, borderRadius: 2, backgroundColor: FACE_INK },
  cardValue: { color: FACE_WHITE, fontSize: 11, lineHeight: 12, fontWeight: '800', includeFontPadding: false },
  coinMark: { width: 4, height: 4, borderRadius: 2, borderWidth: 0.7, borderColor: FACE_WHITE },
  cardTopLabel: { fontSize: 8, lineHeight: 10, fontWeight: '800', includeFontPadding: false, flexShrink: 1 },
  cityTop: { height: 16 },
  cityMetadata: { flexShrink: 1, minWidth: 0 },
  cityCountry: { fontSize: 7, lineHeight: 8, fontWeight: '800', textAlign: 'right', includeFontPadding: false },
  cityPerk: { fontSize: 7, lineHeight: 8, textAlign: 'right', includeFontPadding: false },
  cardName: { height: 19, color: FACE_INK, fontFamily: Platform.select({ ios: 'Georgia', default: 'serif' }), lineHeight: 19, fontWeight: '700', includeFontPadding: false },
  cityName: { height: 16, lineHeight: 16 },
  cardNameStacked: { height: 22, lineHeight: 11 },
  cardArtWindow: { flex: 1, overflow: 'hidden', backgroundColor: '#e4ddcb' },
  cardIllustration: { width: '100%', height: '100%' },
  cardSplit: { flexDirection: 'row', gap: 1 },
  cardBand: { borderRadius: 2, paddingVertical: 1, justifyContent: 'center', minHeight: 15 },
  cardBandText: { color: FACE_WHITE, fontSize: 8.5, lineHeight: 10, fontWeight: '800', textAlign: 'center', includeFontPadding: false },
  cardBandSmall: { fontSize: 7 },
  cardSplitText: { fontSize: 6.25 },
  tollFooter: { gap: 1 },
  tollHeading: { fontSize: 7.5, lineHeight: 8, fontWeight: '800', includeFontPadding: false },
  tollRow: { flexDirection: 'row', gap: 1 },
  tollTile: { flex: 1, height: 20, alignItems: 'center', justifyContent: 'center', borderRadius: 2, backgroundColor: '#e6ddc6' },
  tollTileComplete: { backgroundColor: '#f1d397' },
  tollAmount: { color: '#372819', fontSize: 11.5, lineHeight: 12, fontWeight: '800', includeFontPadding: false },
  tollMilestone: { color: '#372819', fontSize: 6.5, lineHeight: 7, fontWeight: '800', includeFontPadding: false },
  deckBack: { width: 18, height: 25.4, borderRadius: 2 },
  fullBack: { width: CARD_WIDTH, height: CARD_HEIGHT, borderRadius: 5 },
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
