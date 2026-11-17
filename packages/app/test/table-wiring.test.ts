import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGame, viewFor, type PlayerView } from '@atlas/engine';
import { englishLocale, animated, hooks, loadComponent, native, nodes } from './componentBoundary.ts';

test('own holdings and prompts have a scrollable area independent of the opponent board', () => {
  const runtime = hooks();
  const { Table } = loadComponent(new URL('../src/table/Table.tsx', import.meta.url).pathname, {
    '../i18n/locale.tsx': englishLocale, react: runtime.react, 'react-native': native, 'react-native-reanimated': animated,
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
    '../i18n/locale.tsx': englishLocale, react: runtime.react, 'react-native': native, 'react-native-reanimated': animated,
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
    '../i18n/locale.tsx': englishLocale, react: runtime.react, 'react-native': native, 'react-native-reanimated': animated,
    '../settings/feedback.ts': { signal() {} },
  });
  const initial = viewFor(createGame({ players: 2, countriesToWin: 3 }, 1), 0);
  let view: PlayerView = { ...initial, phase: { kind: 'pay', player: 0, receiver: 1, owed: 3, amount: 3, queue: [] },
    players: initial.players.map((player, seat) => seat === 0 ? { ...player, bank: ['coin-1-1', 'coin-2-1'] } : player) };
  const legal = [{ type: 'pay', card: 'coin-1-1' }, { type: 'pay', card: 'coin-2-1' }];
  const render = () => runtime.render(() => Table({ view, legal, names: ['You', 'Bot'], onAction: (action: any) => { sent.push(action); } }));
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
    '../i18n/locale.tsx': englishLocale, react: runtime.react, 'react-native': native, 'react-native-reanimated': animated,
    '../settings/feedback.ts': { signal() {} },
  });
  const initial = viewFor(createGame({ players: 2, countriesToWin: 3 }, 1), 0);
  let view: PlayerView = { ...initial, phase: { kind: 'pay', player: 0, receiver: 1, owed: 3, amount: 3, queue: [] },
    players: initial.players.map((player, seat) => seat === 0 ? { ...player, bank: ['coin-1-1', 'coin-2-1'] } : player) };
  let legal = [{ type: 'pay', card: 'coin-1-1' }, { type: 'pay', card: 'coin-2-1' }];
  const render = () => runtime.render(() => Table({ view, legal, names: ['You', 'Bot'], onAction: (action: any) => { sent.push(action); } }));
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
    '../i18n/locale.tsx': englishLocale, react: runtime.react, 'react-native': native, 'react-native-reanimated': animated,
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

for (const failure of ['measure', 'frame', 'scroll']) {
  test(`Table abandons decorative ${failure} failures with one sanitized warning and working actions`, async () => {
    const runtime = hooks(); const warnings: unknown[][] = []; const sent: any[] = [];
    const warn = console.warn; const frame = globalThis.requestAnimationFrame;
    console.warn = (...args) => { warnings.push(args); };
    globalThis.requestAnimationFrame = (fn) => {
      if (failure === 'frame') throw new Error('private native details');
      fn(0); return 1;
    };
    const { Table } = loadComponent(new URL('../src/table/Table.tsx', import.meta.url).pathname, {
      '../i18n/locale.tsx': englishLocale, react: runtime.react, 'react-native': native, 'react-native-reanimated': animated,
      '../settings/feedback.ts': { signal() {} },
    });
    let view: PlayerView = viewFor(createGame({ players: 2, countriesToWin: 3 }, 1), 0);
    const action = { type: 'endTurn' };
    const render = () => runtime.render(() => Table({ view, legal: [action], names: ['You', 'Bot'], onAction: (a: any) => { sent.push(a); } }));
    const mount = (tree: any) => nodes(tree).forEach(({ props }) => {
      const node = {
        measureInWindow(done: any) { if (failure === 'measure') throw new Error('private native details'); done(10, 20, 300, 200); },
        scrollToEnd() { if (failure === 'scroll') throw new Error('private native details'); }, scrollTo() {},
      };
      if (typeof props?.ref === 'function') props.ref(node);
      else if (props?.ref) props.ref.current = node;
    });
    try {
      mount(render()); runtime.flush();
      for (let i = 0; i < 3; i++) {
        view = { ...view, hand: [...view.hand, 'coin-1-1'], log: [...view.log, { type: 'draw', player: 0 }] };
        mount(render()); runtime.flush(); await new Promise(setImmediate);
        assert.deepEqual(nodes(render()).find((n) => n.type?.name === 'Flights').props.flights, []);
      }
      nodes(render()).find((n) => n.type?.name === 'Button' && n.props.label === 'End turn').props.onPress();
      assert.deepEqual(sent, [action]);
      assert.deepEqual(warnings, [['[atlas:flights] Card animation unavailable; gameplay continues.']]);
    } finally { runtime.unmount(); console.warn = warn; globalThis.requestAnimationFrame = frame; }
  });
}

for (const outcome of ['first refusal', 'later refusal', 'accepted boolean', 'online void']) {
  test(`three-card payment reconciles ${outcome} without replay or duplicate sends`, () => {
    const runtime = hooks(); const sent: string[] = [];
    const { Table } = loadComponent(new URL('../src/table/Table.tsx', import.meta.url).pathname, {
      '../i18n/locale.tsx': englishLocale, react: runtime.react, 'react-native': native, 'react-native-reanimated': animated,
      '../settings/feedback.ts': { signal() {} },
    });
    const cards = ['coin-1-1', 'coin-2-1', 'coin-3-1'];
    const initial = viewFor(createGame({ players: 2, countriesToWin: 3 }, 1), 0);
    let view: PlayerView = { ...initial, phase: { kind: 'pay', player: 0, receiver: 1, owed: 6, amount: 6, queue: [] },
      players: initial.players.map((player, seat) => seat === 0 ? { ...player, bank: cards } : player) };
    let refusing = outcome.includes('refusal');
    const refused = outcome === 'later refusal' ? cards[1] : cards[0];
    const render = () => runtime.render(() => Table({ view,
      legal: view.players[0]!.bank.map(card => ({ type: 'pay', card })), names: ['You', 'Bot'],
      onAction(action: any) { sent.push(action.card); return outcome === 'online void' ? undefined : !(refusing && action.card === refused); },
    }));
    const settle = () => { render(); runtime.flush(); render(); runtime.flush(); };
    const panel = () => nodes(render()).find(node => node.type?.name === 'PayPanel');
    const confirm = () => {
      for (const card of view.players[0]!.bank) panel().props.onToggle(card);
      panel().props.onConfirm(); settle();
    };
    const answer = (card: string, owed: number) => {
      view = { ...view, phase: { kind: 'pay', player: 0, receiver: 1, owed, amount: 6, queue: [] },
        players: view.players.map((player, seat) => seat === 0 ? { ...player, bank: player.bank.filter(id => id !== card) } : player),
        log: [...view.log, { type: 'pay', player: 0, card }] };
      settle();
    };
    try {
      settle(); confirm(); assert.deepEqual(sent, [cards[0]]);
      if (outcome === 'later refusal') { answer(cards[0]!, 5); assert.deepEqual(sent, cards.slice(0, 2)); }
      if (refusing) {
        const unchanged = view; const attempts = [...sent];
        assert.ok(panel(), 'explicit refusal must reopen PayPanel without a new authoritative view');
        assert.ok(view.players[0]!.bank.includes(refused!), 'refused card remains available');
        assert.equal(panel().props.prompt.actions.length, 0, 'refused intent must require a new selection and confirmation');
        refusing = false; settle(); settle();
        assert.equal(view, unchanged); assert.deepEqual(sent, attempts, 'storage recovery alone must not replay intent');
        confirm(); assert.deepEqual(sent, [...attempts, view.players[0]!.bank[0]], 'only reconfirmation resends refused card');
      }
      const remaining = [...view.players[0]!.bank];
      let owed = outcome === 'later refusal' ? 5 : 6;
      for (let i = 0; i < remaining.length; i++) {
        const before = sent.length;
        owed -= Number(remaining[i]!.split('-')[1]);
        answer(remaining[i]!, owed); settle();
        assert.equal(sent.length, before + (i + 1 < remaining.length ? 1 : 0), 'each accepted response advances at most one card');
      }
      assert.deepEqual(sent, outcome === 'first refusal' ? [cards[0], ...cards] : outcome === 'later refusal' ? [cards[0], cards[1], cards[1], cards[2]] : cards);
    } finally { runtime.unmount(); }
  });
}
