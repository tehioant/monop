import assert from 'node:assert/strict';
import { test } from 'node:test';
import { offline, type Room } from '../src/online/session.ts';
import { englishLocale, hooks, loadComponent, native, nodes } from './componentBoundary.ts';

const room: Room = { type: 'room', code: 'BCDFG', countriesToWin: 3, you: 0, players: [{ name: 'Ada', bot: false, status: 'connected' }] };
const onlineScreen = new URL('../src/app/online.tsx', import.meta.url).pathname;

test('host lobby shares its room link with native Share; dismissal is quiet and errors are local', async () => {
  const screenHooks = hooks();
  const lobbyHooks = hooks();
  const platform = { OS: 'ios' };
  const payloads: unknown[] = [];
  let rejectShare = false;
  let session = { ...offline('Ada', 'issued'), room };
  const Online = loadComponent(onlineScreen, {
    '../i18n/locale.tsx': englishLocale, react: { ...screenHooks.react, useState: lobbyHooks.react.useState },
    '../table/parts.tsx': { Button() {}, Panel() {}, shared: {} }, '../table/Choice.tsx': { Choice() {} },
    'react-native': { ...native, Platform: platform, Share: { async share(content: unknown) {
      payloads.push(content);
      if (rejectShare) throw new Error('private native detail');
      return { action: 'dismissedAction' };
    } } },
    'expo-router': { router: {} }, '../online/store.ts': { useOnline: () => ({ session }) },
    '../table/usePaced.ts': {}, '../table/Table.tsx': {}, '../table/Results.tsx': {},
  }).default;
  const draw = () => {
    const screen: any = screenHooks.render(Online);
    return nodes(lobbyHooks.render(() => screen.type(screen.props)));
  };
  const share = () => draw().find(node => node.props?.label === 'Share invite link');
  assert.ok(draw().some(node => node.props?.children === 'BCDFG' && node.props.selectable));
  const shareButton = share();
  assert.ok(shareButton, 'the host has a share action');
  await shareButton.props.onPress();
  assert.deepEqual(payloads, [{ url: 'atlas:///invite?code=BCDFG' }]);
  assert.ok(!draw().some(node => node.props?.children === 'Could not share the invite link. Try again.'));

  platform.OS = 'android';
  rejectShare = true;
  await share().props.onPress();
  assert.deepEqual(payloads[1], { message: 'atlas:///invite?code=BCDFG' });
  assert.ok(draw().some(node => node.props?.children === 'Could not share the invite link. Try again.'));
  assert.doesNotMatch(JSON.stringify(draw()), /private native detail/);
  rejectShare = false;
  await share().props.onPress();
  assert.ok(!draw().some(node => node.props?.children === 'Could not share the invite link. Try again.'));

  session = { ...session, room: { ...room, you: 1 } };
  assert.equal(share(), undefined);
});
