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

test('an authoritative same-log correction cancels the rest of a confirmed payment', () => {
  const runtime = hooks(); const sent: any[] = [];
  const { Table } = loadComponent(new URL('../src/table/Table.tsx', import.meta.url).pathname, {
    react: runtime.react, 'react-native': native, 'react-native-reanimated': animated,
    '../settings/feedback.ts': { signal() {} },
  });
  const initial = viewFor(createGame({ players: 2, countriesToWin: 3 }, 1), 0);
  let view: PlayerView = { ...initial, phase: { kind: 'pay', player: 0, receiver: 1, owed: 3, amount: 3, queue: [] },
    players: initial.players.map((player, seat) => seat === 0 ? { ...player, bank: ['coin-1-1', 'coin-2-1'] } : player) };
  const legal = [{ type: 'pay', card: 'coin-1-1' }, { type: 'pay', card: 'coin-2-1' }];
  const render = () => runtime.render(() => Table({ view, legal, names: ['You', 'Bot'], onAction: (action: any) => sent.push(action) }));
  render(); runtime.flush();
  for (const id of ['coin-1-1', 'coin-2-1']) {
    nodes(render()).find((node) => node.type?.name === 'Chip' && node.props.id === id).props.onPress();
  }
  nodes(render()).find((node) => node.type?.name === 'PayPanel').props.onConfirm();
  assert.equal(sent.length, 1);
  view = { ...view, deckSize: view.deckSize - 1 }; render(); runtime.flush(); render();
  view = { ...view, log: [...view.log, { type: 'pay', player: 0, card: 'coin-1-1' }] };
  render(); runtime.flush();
  assert.equal(sent.length, 1, 'correction must cancel old queued intent before a later view arrives');
  runtime.unmount();
});

test('an ordinary payment response sends the next confirmed card exactly once', () => {
  const runtime = hooks(); const sent: any[] = [];
  const { Table } = loadComponent(new URL('../src/table/Table.tsx', import.meta.url).pathname, {
    react: runtime.react, 'react-native': native, 'react-native-reanimated': animated,
    '../settings/feedback.ts': { signal() {} },
  });
  const initial = viewFor(createGame({ players: 2, countriesToWin: 3 }, 1), 0);
  let view: PlayerView = { ...initial, phase: { kind: 'pay', player: 0, receiver: 1, owed: 3, amount: 3, queue: [] },
    players: initial.players.map((player, seat) => seat === 0 ? { ...player, bank: ['coin-1-1', 'coin-2-1'] } : player) };
  let legal = [{ type: 'pay', card: 'coin-1-1' }, { type: 'pay', card: 'coin-2-1' }];
  const render = () => runtime.render(() => Table({ view, legal, names: ['You', 'Bot'], onAction: (action: any) => sent.push(action) }));
  render(); runtime.flush();
  for (const id of ['coin-1-1', 'coin-2-1']) {
    nodes(render()).find((node) => node.type?.name === 'Chip' && node.props.id === id).props.onPress();
  }
  nodes(render()).find((node) => node.type?.name === 'PayPanel').props.onConfirm();
  render(); runtime.flush();
  assert.deepEqual(sent, [{ type: 'pay', card: 'coin-1-1' }]);
  view = { ...view, phase: { kind: 'pay', player: 0, receiver: 1, owed: 2, amount: 3, queue: [] },
    players: view.players.map((player, seat) => seat === 0 ? { ...player, bank: ['coin-2-1'] } : player),
    log: [...view.log, { type: 'pay', player: 0, card: 'coin-1-1' }] };
  legal = [{ type: 'pay', card: 'coin-2-1' }];
  render(); runtime.flush(); render(); runtime.flush();
  assert.deepEqual(sent, [{ type: 'pay', card: 'coin-1-1' }, { type: 'pay', card: 'coin-2-1' }]);
  runtime.unmount();
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
