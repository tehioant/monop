import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACTIONS, CARDS, RULES, type Action, type PlayerView } from '@atlas/engine';
import { createStore, type StateCreator } from 'zustand/vanilla';
import { animated, componentLoader, hooks, native, nodes } from './componentBoundary.ts';
import { actionLabel, logLine, promptText } from '../src/table/actions.ts';
import { cardText } from '../src/table/cardText.ts';
import { cardPrompt, payPrompt, vetoPrompt } from '../src/table/prompts.ts';
import { explainOnlineError } from '../src/online/display.ts';
import { defaultName } from '../src/online/session.ts';
import { en } from '../src/i18n/en.ts';
import { fr } from '../src/i18n/fr.ts';
import { resolveLanguage, translate } from '../src/i18n/strings.ts';
import { loadSettings, saveSettings, type Storage } from '../src/settings/settings.ts';

test('system language is French only for a French primary locale; a saved choice wins', () => {
  assert.equal(resolveLanguage('system', 'fr-CA'), 'fr');
  assert.equal(resolveLanguage('system', 'FR'), 'fr');
  assert.equal(resolveLanguage('system', 'de-DE'), 'en');
  assert.equal(resolveLanguage('system', undefined), 'en');
  assert.equal(resolveLanguage('en', 'fr-FR'), 'en');
  assert.equal(resolveLanguage('fr', 'en-US'), 'fr');
});

test('language is backward compatible, validated and round-trips through settings storage', () => {
  let raw = '{"sound":false,"haptics":true}';
  const storage: Storage = { getItem: () => raw, setItem: (_, value) => { raw = value; } };
  const legacy = loadSettings(storage);
  assert.deepEqual(legacy, { sound: false, haptics: true, language: 'system' });
  saveSettings(storage, { ...legacy, language: 'fr' });
  assert.deepEqual(loadSettings(storage), { ...legacy, language: 'fr' });
  raw = '{"language":"de","sound":false}';
  assert.deepEqual(loadSettings(storage), legacy);
});

test('translations agree on keys and placeholders and keep inserted values literal', () => {
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  for (const key of Object.keys(en) as (keyof typeof en)[]) {
    const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    assert.deepEqual(placeholders(fr[key]), placeholders(en[key]), key);
  }
  assert.equal(translate('en')('home.tagline'), 'Collect countries, city by city.');
  assert.equal(translate('fr')('home.tagline'), 'Collectionnez les pays, ville après ville.');
  assert.equal(translate('fr')('board.deck', { count: '{count}' }), 'Pioche {count}');
});

const french = translate('fr');

test('each catalog card has French text; French card effects use catalog and rule numbers', () => {
  const effects = new Set<string>();
  for (const card of CARDS) {
    const { name, lines } = cardText(card.id, french);
    assert.ok(name.trim() && lines.length >= 2, card.id);
    assert.match(lines.at(-1)!, new RegExp(`vaut ${card.value} en paiement`, 'i'), card.id);
    if (card.kind === 'action') effects.add(lines[0]!);
  }
  assert.equal(effects.size, ACTIONS.length);
  assert.match(cardText('london', french).lines[0]!, /Thaïlande.*Bangkok, Chiang Mai, Phuket/);
  assert.match(cardText('cairo', french).lines[1]!, /Égypte.*1 avec 1 ville, 2 une fois le pays complet/);
  assert.match(cardText('cairo', french).lines[2]!, new RegExp(`piochez ${RULES.drawsWithPerk} cartes`));
  assert.equal(cardText('wild-egypt-italy', french).lines[0], 'Ville joker. Pays possibles : Égypte ou Italie.');
  assert.equal(cardText('wild-any-1', french).name, 'Joker universel');
  assert.equal(cardText('debt-1', french).lines[0], `Un adversaire de votre choix vous paie ${RULES.debtAmount}.`);
});

test('French city detail distinguishes the stack size, native city, valid wilds and named cities', () => {
  assert.equal(cardText('cairo', french).lines[0],
    'Pays : Égypte. Pour le compléter, réunissez 2 cartes Ville, dont au moins une ville du pays. Les jokers compatibles peuvent remplacer les autres villes. Villes du pays : Le Caire, Alexandrie.');
});

test('French Windfall specifies the deck and the rule-derived draw count', () => {
  assert.equal(cardText('windfall-1', french).lines[0], `Piochez ${RULES.windfallDraws} cartes dans la pioche.`);
});

test('French actions, log, aim, payment and Veto keep canonical intents and literal player names', () => {
  const names = ['Bot 1', 'Ana {amount}'];
  const view: PlayerView = {
    viewer: 0, options: { players: 2, countriesToWin: 3 }, hand: ['raid-1', 'veto-1'],
    players: [{ handSize: 2, bank: ['coin-5-1'], table: [] }, { handSize: 0, bank: [], table: [
      { country: 'uk', cities: ['london'], upgrades: [], complete: false, toll: 1 },
    ] }], deckSize: 0, market: [], discardTop: null, perks: [],
    turn: { player: 0, playsLeft: 2 }, phase: { kind: 'play', player: 0 }, log: [],
  };
  const raid: Action = { type: 'play', card: 'raid-1', target: 1, city: 'london' };
  const aim = cardPrompt(view, [raid], {}, names, french);
  assert.equal(aim.steps[0]?.title, 'Quelle ville prendre ?');
  assert.equal(aim.confirm, 'Prendre Bangkok à Ana {amount}');
  assert.equal(aim.chosen, raid);
  assert.equal(promptText(view, names, french), 'À vous (actions restantes : 2)');
  assert.equal(actionLabel({ type: 'endTurn' }, names, french), 'Terminer le tour');
  assert.equal(logLine({ type: 'lay', card: 'london', player: 1 }, names, french), 'Ana {amount} : Poser Bangkok');
  const pay: Action = { type: 'pay', card: 'coin-5-1' };
  const payment = payPrompt({ ...view, phase: { kind: 'pay', player: 0, receiver: 1, owed: 3, amount: 3, queue: [] } },
    [pay], ['coin-5-1'], names, french)!;
  assert.equal(payment.text, 'Vous devez 3 à Ana {amount}');
  assert.equal(payment.summary, 'Sélection : 5 sur 3 (2 en trop)');
  assert.equal(payment.actions[0], pay);
  const veto: Action = { type: 'play', card: 'veto-1' };
  const answer = vetoPrompt({ ...view, turn: { player: 1, playsLeft: 1 }, log: [{ type: 'play', card: 'debt-1', player: 1 }],
    phase: { kind: 'veto', player: 0, target: 0, vetoes: 0, effect: { amount: 3 }, queue: [] } }, [veto], names, french)!;
  assert.equal(answer.text, 'Ana {amount} joue Dette : vous payez 3. Annuler l’effet avec un véto ?');
  assert.equal(answer.veto, veto);
});

test('online display localizes generated guest names and safe error codes', () => {
  assert.match(defaultName(french), /^Invité [0-9]{4}$/);
  assert.equal(explainOnlineError('room_full', french), 'Ce salon est complet.');
  assert.equal(explainOnlineError('internal', french), 'Une erreur est survenue. Réessayez.');
});

const path = (name: string) => new URL(`../src/${name}`, import.meta.url).pathname;

test('root locale drives real Settings and card copy; language override saves and can be reset', (t) => {
  let saved: string | null = null;
  let languageTag = 'fr-CA';
  let refused = false;
  let unavailable = false;
  let reads = 0;
  const warn = t.mock.method(console, 'warn', () => {});
  const getLocales = () => {
    reads++;
    if (unavailable) throw Error('private locale details');
    return [{ languageTag }];
  };
  const storage = {
    getItem: () => saved,
    setItem: (_key: string, value: string) => { if (refused) throw Error('locked'); saved = value; },
  };
  // Render each consumer at the component boundary; React's context dispatch and native I/O are replaced.
  const fixture = () => {
    const runtime = hooks();
    let locale: string;
    let listener: ((state: string) => void) | undefined;
    const load = componentLoader({
      react: { ...runtime.react, createContext: (initial: string) => { locale = initial; return { Provider: 'Provider' }; }, useContext: () => locale },
      zustand: { create: (initializer: StateCreator<unknown>) => {
        const store = createStore(initializer);
        return Object.assign((select = (state: unknown) => state) => select(store.getState()), store);
      } },
      'expo-localization': { useLocales: getLocales, getLocales },
      'expo-secure-store': storage,
      'expo-router': { Stack: Object.assign(() => {}, { Screen() {} }), router: { back() {} } },
      'expo-haptics': {}, 'expo-audio': {},
      'react-native': { ...native, Switch: 'Switch', AppState: {
        addEventListener(event: string, fn: (state: string) => void) {
          assert.equal(event, 'change');
          listener = fn;
          return { remove() { listener = undefined; } };
        },
      } }, 'react-native-reanimated': animated,
      'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    });
    const Root = load(path('app/_layout.tsx')).default;
    const Settings = load(path('app/settings.tsx')).default;
    const { CardText } = load(path('table/Prompt.tsx'));
    return {
      render() {
        const root = Root();
        const draw = () => runtime.render(() => root.type(root.props)) as { type: string; props: { value: string; children: unknown } };
        draw();
        runtime.flush();
        const provider = draw();
        assert.equal(provider.type, 'Provider');
        assert.equal(provider.props.children, root.props.children);
        locale = provider.props.value;
        return nodes(Settings());
      },
      card: () => nodes(CardText({ card: 'debt-1' })),
      foreground: () => listener?.('active'),
      watching: () => listener !== undefined,
      unmount: runtime.unmount,
    };
  };
  const visit = fixture();
  const hasText = (tree: any[], text: string) => tree.some((node) => node.props?.children === text);
  const button = (tree: any[], label: string) => {
    const match = tree.find((node) => node.props?.label === label);
    assert.ok(match, label);
    return match.props;
  };
  const system = visit.render();
  assert.ok(hasText(system, 'Paramètres'));
  assert.equal(button(system, 'Langue de l’appareil').selected, true);
  assert.ok(hasText(visit.card(), 'Dette'));
  unavailable = true;
  visit.foreground();
  assert.ok(hasText(visit.render(), 'Settings'), 'a failed foreground read falls back to English');
  visit.foreground();
  assert.equal(warn.mock.callCount(), 1);
  assert.match(String(warn.mock.calls[0]!.arguments[0]), /locale/i);
  assert.doesNotMatch(JSON.stringify(warn.mock.calls.map((call) => call.arguments)), /private/);
  unavailable = false;
  visit.foreground();
  const recovered = visit.render();
  assert.ok(hasText(recovered, 'Paramètres'), 'foreground refresh can recover French');
  button(recovered, 'English').onPress();
  const english = visit.render();
  assert.ok(hasText(english, 'Settings'));
  assert.ok(hasText(visit.card(), 'Debt'));
  assert.equal(button(english, 'English').selected, true);
  assert.equal(visit.watching(), false, 'explicit language releases the system listener');
  const next = fixture();
  assert.ok(hasText(next.render(), 'Settings'), 'saved English overrides a French device on the next launch');
  languageTag = 'de-DE';
  button(next.render(), 'Français').onPress();
  const override = next.render();
  assert.ok(hasText(override, 'Paramètres'), 'explicit French overrides another device locale');
  assert.ok(hasText(next.card(), `Un adversaire de votre choix vous paie ${RULES.debtAmount}.`));
  unavailable = true;
  const readsBeforeOverride = reads;
  const explicit = fixture();
  assert.ok(hasText(explicit.render(), 'Paramètres'), 'saved French works with no native locale');
  explicit.foreground();
  assert.equal(reads, readsBeforeOverride, 'explicit language does not read the device locale');
  unavailable = false;
  refused = true;
  button(override, 'Langue de l’appareil').onPress();
  const unsaved = next.render();
  assert.ok(hasText(unsaved, 'Settings'), 'a failed save still applies for this session');
  assert.ok(hasText(unsaved, 'Changes apply now but could not be saved. Try changing the setting again.'));
  assert.ok(hasText(fixture().render(), 'Paramètres'), 'failed save retains the previous persisted choice');
  refused = false;
  button(unsaved, 'Device language').onPress();
  assert.ok(hasText(fixture().render(), 'Settings'), 'the restored system default persists');
  unavailable = true;
  const coldSystem = fixture();
  assert.ok(hasText(coldSystem.render(), 'Settings'), 'system startup falls back to English');
  assert.ok(coldSystem.watching());
  coldSystem.unmount();
  assert.equal(coldSystem.watching(), false, 'unmount releases the system listener');
});
