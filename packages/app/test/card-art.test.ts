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

const thailand = [
  ['london', 'Bangkok', 'bangkok'],
  ['manchester', 'Chiang Mai', 'chiang-mai'],
  ['edinburgh', 'Phuket', 'phuket'],
  ['wild-uk-india', 'Wild Thailand/India', 'wild-thailand-india'],
] as const;

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
    const art = thailand.find(([id]) => id === card.id)?.[2] ?? group;
    assert.equal(props.source.split('/').pop(), `${art}.webp`, card.id);
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

test('Thailand replaces the UK artwork and labels without retiring saved card IDs', () => {
  const { CardView } = parts();
  for (const [id, name] of thailand) {
    const tree = CardView({ id });
    assert.equal(tree.props.accessibilityLabel.split('. Base toll:')[0], name);
    const rendered = nodes(tree);
    assert.ok(rendered.some((node) => node.type === 'Text' && node.props.children === 'THAILAND'));
  }
});

test('city faces show the base toll for each set size, separate from the bank value', () => {
  const { CardView } = parts();
  const text = (id: string) => nodes(CardView({ id })).filter((node) => node.type === 'Text').map((node) => node.props.children);
  for (const [id, toll, bankValue] of [
    ['cairo', 'Toll 1/2', 1],
    ['london', 'Toll 1/2/4', 2],
    ['mumbai', 'Toll 1/3/5/7', 3],
  ] as const) {
    assert.ok(text(id).includes(toll), `${id}: missing ${toll}`);
    assert.ok(text(id).includes(bankValue), `${id}: missing bank value`);
  }
  assert.equal(CardView({ id: 'london' }).props.accessibilityLabel, 'Bangkok. Base toll: 1 with 1 city, 2 with 2 cities, 4 once complete.');
  for (const id of ['wild-uk-india', 'wild-any-1', 'toll-1', 'coin-2-1']) {
    assert.ok(!text(id).some((label) => typeof label === 'string' && label.startsWith('Toll ')), `${id}: no fixed toll`);
  }
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
