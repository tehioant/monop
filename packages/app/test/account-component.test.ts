import assert from 'node:assert/strict';
import test from 'node:test';
import { english, translate } from '../src/i18n/strings.ts';
import { animated, hooks, loadComponent, native, nodes } from './componentBoundary.ts';

const src = new URL('../src/', import.meta.url).pathname;
const button = (tree: unknown, label: string) => nodes(tree).find((node) => node.props.label === label);
const copy = (tree: unknown) => nodes(tree).flatMap((node) => typeof node.props.children === 'string' ? [node.props.children] : []);

function fixture(url?: string, t = english, linked: string[] = []) {
  const h = hooks();
  const opened: string[] = [];
  const paths: string[] = [];
  let refuse = false;
  let replacement: unknown;
  const signIns: unknown[][] = [];
  const token = 'guest-token';
  const load = (screen: string) => loadComponent(`${src}app/${screen}.tsx`, {
    react: h.react, 'react-native': { ...native, Switch: 'Switch' }, 'react-native-reanimated': animated,
    'expo-router': { router: { push: (path: string) => paths.push(path) } },
    'expo-linking': { openURL: async (address: string) => {
      opened.push(address);
      if (refuse) throw Error('private native error');
    } },
    '../i18n/locale.tsx': { useTranslation: () => t },
    '../settings/store.ts': { useSettings: () => ({ settings: { language: 'en' } }) },
    '../settings/feedback.ts': { signal: () => {} },
    '../account/config.ts': { privacyPolicyUrl: url },
    '../account/client.ts': { accountClient: () => ({
      status: async () => ({ providers: ['google'], linked, authenticated: true }),
      signIn: async (...args: unknown[]) => { signIns.push(args); return { token: 'restored-token', name: 'Guest' }; },
    }) },
    '../online/store.ts': { useOnline: { getState: () => ({
      accountToken: () => token,
      replaceAccount: (...args: unknown[]) => { replacement = args; return true; },
    }) } },
  }).default;
  return { opened, paths, load, render: h.render, flush: h.flush, signIns, replacement: () => replacement, refuse: () => { refuse = true; } };
}

test('Settings opens Account, where a guest can open the configured privacy policy and retry a native refusal', async () => {
  const f = fixture('https://atlas.example/privacy');
  const entry = button(f.render(f.load('settings')), 'Account');
  assert.ok(entry, 'Account is a visible Settings action');
  entry.props.onPress();
  assert.deepEqual(f.paths, ['/account']);
  const account = f.load('account');
  const render = () => f.render(account);
  assert.ok(copy(render()).includes('Playing as a guest'));
  f.refuse();
  await button(render(), 'Privacy policy').props.onPress();
  assert.deepEqual(f.opened, ['https://atlas.example/privacy']);
  assert.ok(copy(render()).includes('Could not open the privacy policy. Try again.'));
  assert.ok(!copy(render()).includes('private native error'));
  assert.ok(button(render(), 'Privacy policy'));
});

test('Account keeps offline guest access and never opens an absent or unsafe policy URL', () => {
  for (const url of [undefined, 'http://atlas.example/privacy', 'https://name:secret@atlas.example/privacy', 'atlas://privacy']) {
    const f = fixture(url, translate('fr'));
    const screen = f.render(f.load('account'));
    assert.ok(copy(screen).includes('Vous jouez en tant qu’invité'));
    assert.ok(copy(screen).includes('Politique de confidentialité indisponible.'));
    assert.ok(!button(screen, 'Politique de confidentialité'));
    assert.deepEqual(f.opened, []);
  }
});

test('Account shows its linked provider and uses restored credentials for the online session', async () => {
  const f = fixture(undefined, english, ['google']);
  const screen = f.load('account');
  const render = () => f.render(screen);
  render();
  f.flush();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(copy(render()).includes('Linked: Google'));
  assert.ok(!button(render(), 'Link Google'));
  const restore = button(render(), 'Restore with Google');
  assert.ok(restore, 'restoration is reachable from Account');
  await restore.props.onPress();
  assert.deepEqual(f.signIns, [['google', 'restore', 'guest-token']]);
  assert.deepEqual(f.replacement(), ['guest-token', { token: 'restored-token', name: 'Guest' }]);
});
