import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CARDS } from '@atlas/engine';
import { animated, loadComponent, native, nodes } from './componentBoundary.ts';

function parts() {
  const jsx = (type: unknown, props: unknown) => ({ type, props });
  return loadComponent('src/table/parts.tsx', {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': native,
    'react-native-reanimated': animated,
  });
}

test('every catalog card displays bundled City Atlas art and its live value', () => {
  const { CardView } = parts();
  const images = new Map<string, string>();
  for (const card of CARDS) {
    const tree = CardView({ id: card.id });
    const texts = nodes(tree).filter((node) => node.type === 'Text').map((node) => node.props.children);
    assert.ok(texts.includes(card.value), `${card.id}: bank value`);
    const cardImages = nodes(tree).filter((node) => node.type === 'Image');
    assert.equal(cardImages.length, 1, `${card.id}: missing illustration`);
    const [{ props }] = cardImages;
    assert.equal(props.accessible, false);
    const group = card.kind === 'coin' ? 'mint' : card.kind === 'action' ? card.action : card.kind === 'wild' && card.countries.length > 2 ? 'wild-any' : card.id;
    assert.equal(props.source.split('/').pop(), `${group}.webp`, card.id);
    images.set(group, props.source);
  }
  assert.equal(new Set(images.values()).size, images.size);
});

test('compact cards retain identity, wild countries and the city perk without altering selection', () => {
  const { CardView, CARD_WIDTH, CARD_HEIGHT, DeckBack } = parts();
  const text = (tree: unknown) => nodes(tree).filter((node) => node.type === 'Text').map((node) => node.props.children);
  const onPress = () => {};
  const wild = CardView({ id: 'wild-australia-japan', selected: true, onPress });
  assert.deepEqual([CARD_WIDTH, CARD_HEIGHT], [68, 96]);
  assert.equal(wild.props.onPress, onPress);
  assert.equal(wild.props.disabled, false);
  assert.equal(wild.props.accessibilityState?.selected, true);
  assert.match(wild.props.accessibilityLabel, /Australia.*Japan/);
  assert.ok(text(wild).includes('AUSTRALIA'));
  assert.ok(text(wild).includes('JAPAN'));
  assert.ok(text(CardView({ id: 'wild-any-2' })).includes('ANY COUNTRY'));
  const city = CardView({ id: 'paris' });
  assert.equal(city.props.disabled, true);
  assert.ok(text(city).includes('Veto back'));
  const back = DeckBack();
  assert.equal(back.type, 'Image');
  assert.equal(back.props.source.split('/').pop(), 'deck-back.webp');
  assert.equal(back.props.accessible, false);
});

test('a hidden flight uses the same back as the draw pile and never displays a face', () => {
  const jsx = (type: unknown, props: unknown) => ({ type, props });
  const { Flights } = loadComponent('src/table/Flights.tsx', {
    react: { createElement: jsx, useEffect: () => {} },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': native,
    'react-native-reanimated': { ...animated, useSharedValue: () => ({ value: 0 }), useAnimatedStyle: () => ({}) },
  });
  const flight = { key: 'hidden', card: null, from: { x: 0, y: 0 }, to: { x: 20, y: 20 }, delay: 0 };
  const child = Flights({ flights: [flight] }).props.children[0];
  const contents = child.type(child.props).props.children;
  assert.equal(contents.type?.name, 'DeckBack');
  assert.equal(contents.props.full, true);
  assert.equal(contents.type(contents.props).props.source, parts().DeckBack().props.source);
});
