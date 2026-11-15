// Cards in flight over the table: each goes from the place it left to the place it is in now, then fades out
// over the card that is drawn there. The table works out the places; this only draws the movement.

import type { CardId } from '@atlas/engine';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { CARD_HEIGHT, CARD_WIDTH, CardView } from './parts.tsx';
import { colors } from './theme.ts';

/** How long a card takes to get where it goes. */
export const FLIGHT_MS = 420;
/** Between two cards that leave in the same step. */
export const STAGGER_MS = 90;

export interface Point {
  x: number;
  y: number;
}

export interface Flight {
  key: string;
  /** Null for a card the viewer may not see: it flies face down. */
  card: CardId | null;
  /** Where the centre of the card starts and ends, from the top left corner of the table. */
  from: Point;
  to: Point;
  /** How long it waits before leaving, in ms. */
  delay: number;
}

export function Flights({ flights }: { flights: readonly Flight[] }) {
  return (
    <View style={styles.overlay}>
      {flights.map((flight) => (
        <Flying {...flight} key={flight.key} />
      ))}
    </View>
  );
}

function Flying({ card, from, to, delay }: Flight) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withDelay(delay, withTiming(1, { duration: FLIGHT_MS, easing: Easing.inOut(Easing.cubic) }));
  }, []);
  const style = useAnimatedStyle(() => {
    const done = progress.value;
    return {
      // Out of sight until it leaves, and again once it has landed.
      opacity: done === 0 ? 0 : Math.min(1, (1 - done) * 6),
      transform: [
        { translateX: from.x + (to.x - from.x) * done - CARD_WIDTH / 2 },
        { translateY: from.y + (to.y - from.y) * done - CARD_HEIGHT / 2 },
        // Lifted off the table in the middle of the flight.
        { scale: 0.55 + 0.25 * Math.sin(Math.PI * done) },
      ],
    };
  });
  return (
    <Animated.View style={[styles.flying, style]}>
      {card === null ? (
        <View style={styles.back}>
          <Text style={styles.backMark}>A</Text>
        </View>
      ) : (
        <CardView id={card} />
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, pointerEvents: 'none' },
  flying: {
    position: 'absolute',
    left: 0,
    top: 0,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  back: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: 8,
    borderWidth: 3,
    borderColor: colors.surface,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backMark: { color: colors.surface, fontSize: 32, fontWeight: '800' },
});
