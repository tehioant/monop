import assert from 'node:assert/strict';
import test from 'node:test';
import type { PlayerView } from '@atlas/engine';
import type { ReactElement } from 'react';
import * as tutorial from '../src/tutorial/tutorial.ts';
import { english } from '../src/i18n/strings.ts';
import { animated, englishLocale, hooks, loadComponent, native, nodes } from './componentBoundary.ts';

function mount(initial: tutorial.Tutorial | null, isSettled = true) {
  const screenHooks = hooks();
  const tableHooks = hooks();
  let active = screenHooks.react;
  const react = {
    useEffect: (...args: Parameters<typeof active.useEffect>) => active.useEffect(...args),
    useState: (initial: unknown) => active.useState(initial),
    useRef: (initial: unknown) => active.useRef(initial),
    useMemo: (compute: () => unknown) => compute(),
  };
  const departures: string[] = [];
  const Table = () => null;
  const Results = () => null;
  const Screen = loadComponent(new URL('../src/app/tutorial.tsx', import.meta.url).pathname, {
    react,
    'react-native': native, 'react-native-reanimated': animated,
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    'expo-router': { router: { dismissTo: (path: string) => departures.push(path) } },
    '../i18n/locale.tsx': englishLocale,
    '../tutorial/tutorial.ts': { ...tutorial, startTutorial: () => initial },
    '../table/Table.tsx': { Table }, '../table/Results.tsx': { Results },
    '../table/usePaced.ts': { usePaced: (view: PlayerView, legal: unknown) => ({ view, legal, settled: isSettled }) },
    '../solo/store.ts': { useSolo: () => assert.fail('tutorial used the ordinary solo store') },
  }).default as () => ReactElement<Record<string, unknown>, (props: Record<string, unknown>) => ReactElement>;
  const render = () => {
    active = screenHooks.react;
    const screen = screenHooks.render(Screen);
    if (screen.type.name !== 'PracticeTable') return nodes(screen);
    active = tableHooks.react;
    return nodes(tableHooks.render(() => screen.type(screen.props)));
  };
  return { render, departures, Table, Results, flush: tableHooks.flush, unmount: tableHooks.unmount };
}

test('tutorial route forwards one real allowed action and refuses an obsolete Table callback', () => {
  const fixture = mount(tutorial.startTutorial());
  const table = fixture.render().find((node) => node.type === fixture.Table)?.props;
  assert.ok(table, 'the route renders the shared Table');
  assert.deepEqual(table.legal, [{ type: 'lay', card: 'cairo' }]);
  assert.equal(table.onAction({ type: 'bank', card: 'cairo' }), false);
  assert.equal(table.onAction(table.legal[0]), true);
  // Even before React commits the update, an old callback may not send an intent for the next view.
  assert.equal(table.onAction({ type: 'bank', card: 'coin-4-1' }), false);
  const next = fixture.render().find((node) => node.type === fixture.Table).props;
  assert.deepEqual(next.view.players[0].table[0].cities, ['cairo']);
  assert.deepEqual(next.legal, [{ type: 'bank', card: 'coin-4-1' }]);
});

test('a prepared bot lesson cancels its delayed action when the route unmounts', (t) => {
  const initial = tutorial.startTutorial()!;
  const fixture = mount({ cursor: 4, state: { ...initial.state, phase: { kind: 'draw', player: 1, remaining: 1 }, turn: { player: 1, played: 0 } } });
  const clear = t.mock.method(globalThis, 'clearTimeout', () => {});
  const schedule = t.mock.method(globalThis, 'setTimeout', () => 'bot-timer');
  assert.ok(fixture.render().some((node) => node.type === fixture.Table));
  fixture.flush();
  assert.equal(schedule.mock.callCount(), 1);
  fixture.unmount();
  assert.equal(clear.mock.callCount(), 1);
  assert.deepEqual(clear.mock.calls[0]?.arguments, ['bot-timer']);
});

test('prepared victory and setup refusal offer their own Home exit instead of the solo results route', () => {
  const initial = tutorial.startTutorial()!;
  const finished = mount({ cursor: 26, state: { ...initial.state, phase: { kind: 'over', winner: 0 } } });
  const result = finished.render().find((node) => node.type === finished.Results);
  assert.equal(result?.props.view.phase.winner, 0);
  finished.render().find((node) => node.props.label === english('common.home')).props.onPress();
  assert.deepEqual(finished.departures, ['/']);

  const broken = mount(null);
  assert.ok(!broken.render().some((node) => node.type === broken.Table));
  broken.render().find((node) => node.props.label === english('common.home')).props.onPress();
  assert.deepEqual(broken.departures, ['/']);
});
