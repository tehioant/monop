import assert from 'node:assert/strict';
import test from 'node:test';
import { RULES, CARDS, createGame, viewFor } from '@atlas/engine';
import { english, translate } from '../src/i18n/strings.ts';
import { animated, hooks, loadComponent, native, nodes } from './componentBoundary.ts';

const french = translate('fr');

const src = new URL('../src/', import.meta.url).pathname;
const button = (tree: unknown, label: string) => nodes(tree).find((node) => node.props.label === label);

for (const [t, title, evidence] of [
  [english, 'Rules', [
    `${RULES.handLimit} cards`, `${CARDS.length} cards`, 'No change', 'Veto', 'complete countries',
    `draw ${RULES.drawsOnEmptyHand} if your hand is empty. Otherwise, on your first turn`,
    'During the play phase of your turn', 'separately for each target in turn order',
    `draw ${RULES.drawsWithPerk} cards at the start of later turns if your hand is not empty`,
  ]],
  [french, 'Règles', [
    `${RULES.handLimit} cartes`, `${CARDS.length} cartes`, 'Pas de monnaie', 'Véto', 'pays complets',
    `piochez ${RULES.drawsOnEmptyHand} cartes si votre main est vide. Sinon, au premier tour`,
    'Pendant la phase de jeu de votre tour', 'séparément pour chaque cible, dans l’ordre du tour',
    `piochez ${RULES.drawsWithPerk} cartes au début de vos tours suivants si votre main n’est pas vide`,
  ]],
] as const) {
  test(`${title} opens over a shared table and closes without sending an action`, () => {
    const h = hooks();
    const mocks = {
      react: h.react, 'react-native': { ...native, Modal: 'Modal' }, 'react-native-reanimated': animated,
      'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
      '../i18n/locale.tsx': { useTranslation: () => t },
      '../settings/feedback.ts': { signal: () => assert.fail('opened rules sent feedback') },
    };
    const { Table } = loadComponent(`${src}table/Table.tsx`, mocks);
    const game = createGame({ players: 2, countriesToWin: 3 }, 42);
    const view = viewFor(game, 0);
    const props = { view, legal: [], names: ['You', 'Bot'], onAction: () => assert.fail('rules sent a game action') };
    const table = () => h.render(() => Table(props));
    const findRules = (tree: unknown) => nodes(tree).find((node) => node.type?.name === 'RulesButton');
    const rules = findRules(table());
    assert.ok(rules, 'shared table exposes the rules');
    const trigger = hooks();
    // The rules child is rendered independently: no navigation or game-effect execution.
    const { RulesButton } = loadComponent(`${src}rules/RulesButton.tsx`, { ...mocks, react: trigger.react });
    const render = () => trigger.render(RulesButton);
    button(render(), title).props.onPress();
    const modal = nodes(render()).find((node) => node.type?.name === 'RulesModal');
    assert.ok(modal);
    const sheet = modal.type(modal.props);
    const copy = nodes(sheet).flatMap((node) => typeof node.props.children === 'string' ? [node.props.children] : []).join('\n');
    for (const expected of evidence) assert.ok(copy.includes(expected), expected);
    assert.equal(sheet.type, 'Modal');
    sheet.props.onRequestClose();
    assert.ok(!nodes(render()).some((node) => node.type?.name === 'RulesModal'));
    // With no legal move, a hand card still opens its real detail panel.
    const card = nodes(table()).find((node) => node.type?.name === 'CardView' && view.hand.includes(node.props.id));
    assert.ok(card);
    card.props.onPress();
    assert.ok(nodes(table()).some((node) => node.type?.name === 'CardText' && node.props.card === card.props.id));
  });
}

test('Home lets a saved player skip once, replay, and resume without writing the solo save', () => {
  const saved = createGame({ players: 2, countriesToWin: 3 }, 17);
  const values = new Map<string, string>();
  const writes: string[] = [];
  const paths: string[] = [];
  const h = hooks();
  const loadHome = (react: typeof h.react) => loadComponent(`${src}app/index.tsx`, {
    react, 'react-native': native, 'react-native-reanimated': animated,
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    'expo-router': { router: { push: (path: string) => paths.push(path) } },
    'expo-secure-store': {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { writes.push(key); values.set(key, value); },
    },
    '../i18n/locale.tsx': { useTranslation: () => english },
    '../solo/store.ts': { useSolo: (pick: Function) => pick({ game: { state: saved }, abandon: () => assert.fail('abandoned solo') }) },
  }).default;
  const home = loadHome(h.react);
  const render = () => h.render(home);
  assert.ok(nodes(render()).some((node) => node.type?.name === 'RulesButton'));
  const skip = button(render(), 'Skip tutorial');
  assert.ok(skip, 'first launch offers an explicit skip');
  skip.props.onPress();
  assert.ok(!button(render(), 'Skip tutorial'));
  assert.equal(writes.length, 1);
  assert.deepEqual([...values], [['atlas.tutorial-offer', 'skipped']]);
  assert.deepEqual(paths, []);
  const restarted = hooks();
  const afterRestart = restarted.render(loadHome(restarted.react));
  assert.ok(!button(afterRestart, 'Skip tutorial'));
  button(afterRestart, 'Play tutorial').props.onPress();
  button(afterRestart, english('home.resume')).props.onPress();
  assert.deepEqual(paths, ['/tutorial', '/solo/table']);
  assert.equal(writes.length, 1);
});

test('starting practice still works when the device cannot store the decision', (t) => {
  const h = hooks();
  const paths: string[] = [];
  const writes: unknown[][] = [];
  const warn = t.mock.method(console, 'warn', () => {});
  const Home = loadComponent(`${src}app/index.tsx`, {
    react: h.react, 'react-native': native, 'react-native-reanimated': animated,
    'expo-router': { router: { push: (path: string) => paths.push(path) } },
    'expo-secure-store': {
      getItem: () => { throw Error('private device read details'); },
      setItem: (...args: unknown[]) => { writes.push(args); throw Error('private device write details'); },
    },
    '../i18n/locale.tsx': { useTranslation: () => english },
    '../solo/store.ts': { useSolo: (pick: Function) => pick({ game: null }) },
  }).default;
  const render = () => h.render(Home);
  button(render(), 'Start tutorial').props.onPress();
  assert.deepEqual(paths, ['/tutorial']);
  assert.deepEqual(writes, [['atlas.tutorial-offer', 'started']]);
  assert.ok(!button(render(), 'Skip tutorial'));
  assert.ok(button(render(), 'Play tutorial'));
  assert.equal(warn.mock.callCount(), 1);
  assert.ok(!JSON.stringify(warn.mock.calls[0]?.arguments).includes('private device'));
});
