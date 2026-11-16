import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGame, viewFor, type PlayerView } from '@atlas/engine';
import { animated, hooks, loadComponent, native, nodes } from './componentBoundary.ts';

test('own holdings and prompts have a scrollable area independent of the opponent board', () => {
  const runtime = hooks();
  const { Table } = loadComponent(new URL('../src/table/Table.tsx', import.meta.url).pathname, {
    react: runtime.react, 'react-native': native, 'react-native-reanimated': animated,
    '../settings/feedback.ts': { signal() {} },
  });
  const view = viewFor(createGame({ players: 5, countriesToWin: 3 }, 1), 0);
  const tree = runtime.render(() => Table({ view, legal: [], names: ['You', 'A', 'B', 'C', 'D'], onAction() {} }));
  const own = nodes(tree).find((node) => node.props?.style?.borderTopWidth === 1);
  assert.equal(own.type, 'ScrollView', 'large own holdings must not overflow an unscrollable area');
  assert.equal(nodes(tree).filter((node) => node.props?.accessibilityLabel?.endsWith('show cities and bank')).length, 4);
});

test('same-log corrections invalidate pending card choices', () => {
  const runtime = hooks();
  const { Table } = loadComponent(new URL('../src/table/Table.tsx', import.meta.url).pathname, {
    react: runtime.react, 'react-native': native, 'react-native-reanimated': animated,
    '../settings/feedback.ts': { signal() {} },
  });
  let view = { ...viewFor(createGame({ players: 2, countriesToWin: 3 }, 1), 0), hand: ['sydney'] };
  const render = () => runtime.render(() => Table({ view, legal: [{ type: 'bank', card: 'sydney' }], names: ['You', 'Bot'], onAction() {} }));
  nodes(render()).find((node) => node.type?.name === 'CardView' && node.props.id === 'sydney').props.onPress();
  assert.ok(nodes(render()).some((node) => node.type?.name === 'CardPanel'));
  view = { ...view, deckSize: view.deckSize - 1 };
  assert.equal(nodes(render()).some((node) => node.type?.name === 'CardPanel'), false);
});

test('Table measures its board viewport and emits a flight for a newly drawn card', async () => {
  const runtime = hooks();
  const { Table } = loadComponent(new URL('../src/table/Table.tsx', import.meta.url).pathname, {
    react: runtime.react, 'react-native': native, 'react-native-reanimated': animated,
    '../settings/feedback.ts': { signal() {} },
  });
  const original = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (fn) => { fn(0); return 1; };
  let view: PlayerView = viewFor(createGame({ players: 2, countriesToWin: 3 }, 1), 0);
  const render = () => runtime.render(() => Table({ view, legal: [], names: ['You', 'Bot'], onAction() {} }));
  const mount = (tree: any) => nodes(tree).forEach(({ props }) => {
    const ref = props?.ref;
    const node = { measureInWindow: (done: any) => done(10, 20, 300, 200), scrollToEnd() {}, scrollTo() {} };
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  });
  try {
    mount(render()); runtime.flush();
    view = { ...view, hand: [...view.hand, 'coin-1-1'], log: [...view.log, { type: 'draw', player: 0 }] };
    mount(render()); runtime.flush();
    await new Promise(setImmediate);
    const flights = nodes(render()).find((node) => node.type?.name === 'Flights').props.flights;
    assert.equal(flights.length, 1, 'actual Table must pass a measured draw flight to Flights');
    assert.equal(flights[0].card, 'coin-1-1');
    assert.notDeepEqual(flights[0].from, flights[0].to);
  } finally { runtime.unmount(); globalThis.requestAnimationFrame = original; }
});
