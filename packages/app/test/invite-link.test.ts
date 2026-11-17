import assert from 'node:assert/strict';
import { test } from 'node:test';
import { offline, receive, type Room, type Session } from '../src/online/session.ts';
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
    '../i18n/locale.tsx': englishLocale,
    react: { ...screenHooks.react, useState: (initial: unknown) => active.useState(initial) },
    '../table/parts.tsx': { Button() {}, Panel() {}, shared: {} }, '../table/Choice.tsx': { Choice() {} },
    'react-native': { ...native, Platform: platform, Share: { async share(content: unknown) {
      payloads.push(content);
      if (rejectShare) throw new Error('private native detail');
      return { action: 'dismissedAction' };
    } } },
    'expo-router': { router: {}, useLocalSearchParams: () => ({}) }, '../online/store.ts': { useOnline: () => ({ session }) },
    '../table/usePaced.ts': {}, '../table/Table.tsx': {}, '../table/Results.tsx': {},
  }).default;
  let active = screenHooks.react;
  const draw = () => {
    active = screenHooks.react;
    const screen: any = screenHooks.render(Online);
    active = lobbyHooks.react;
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

test('native invite intake isolates malformed links and gives each cold or warm delivery its own identity', async () => {
  const { redirectSystemPath } = await import('../src/app/+native-intent.ts');
  const route = (path: string, initial = false) => redirectSystemPath({ path, initial });
  const cold = route('atlas:///invite?code=%62cdfg', true);
  const warm = route('atlas:///invite?code=BCDFG');
  assert.match(cold, /^\/online\?inviteDelivery=\d+&inviteCode=BCDFG$/);
  assert.match(warm, /^\/online\?inviteDelivery=\d+&inviteCode=BCDFG$/);
  assert.notEqual(cold, warm, 'two taps on the same link remain distinct');
  for (const query of ['', '?code=', '?code=ABCDE', '?code=BCDFG%0A', '?code=BCDFG&code=BCDFG', '?code=BCDFG&%63ode=HJKMN', '?code=%ZZ', '?code=BCDFG#HJKMN']) {
    assert.match(route(`atlas:///invite${query}`), /^\/online\?inviteDelivery=\d+$/, query);
  }
  assert.equal(route('atlas:///settings?source=menu'), 'atlas:///settings?source=menu');
});

function entryFixture(initialParams: Record<string, unknown> = {}) {
  const screen = hooks();
  const entry = hooks();
  let active = screen.react;
  let params = initialParams;
  let session: Session = offline('Ada', 'issued');
  const requests: string[] = [];
  const Online = loadComponent(onlineScreen, {
    '../i18n/locale.tsx': englishLocale,
    react: { ...screen.react, useState: (initial: unknown) => active.useState(initial) },
    '../table/parts.tsx': { Button() {}, Panel() {}, shared: {} }, '../table/Choice.tsx': { Choice() {} },
    'react-native': { ...native, TextInput: 'TextInput' },
    'expo-router': { router: {}, useLocalSearchParams: () => params },
    '../online/store.ts': { useOnline: () => ({ session, ...actions }) },
    '../table/usePaced.ts': {}, '../table/Table.tsx': {}, '../table/Results.tsx': {},
  }).default;
  const actions = { resume: () => requests.push('resume'), joinRoom: (code: string) => requests.push(code), leave: () => requests.push('close') };
  return {
    requests,
    params(next: Record<string, unknown>) { params = next; },
    session(next: Session) { session = next; },
    draw() {
      active = screen.react;
      screen.render(Online);
      screen.flush();
      const view: any = screen.render(Online);
      active = entry.react;
      return nodes(entry.render(() => view.type(view.props)));
    },
    unmount: screen.unmount,
  };
}

test('online screen dispatches once per delivery, skips competing cold resume, and keeps by-code errors and controls', () => {
  const view = entryFixture({ inviteDelivery: '1', inviteCode: 'BCDFG' });
  const textIs = (text: string) => (node: { props?: { children?: unknown } }) => node.props?.children === text;
  view.draw();
  assert.deepEqual(view.requests, ['BCDFG']);
  const pending: Session = { ...offline('Ada', 'issued'), request: { type: 'joinRoom', code: 'BCDFG' } };
  for (const [code, message] of [
    ['room_full', 'This room is full.'],
    ['game_started', 'This game has already started.'],
    ['room_not_found', 'No room has this code. Check it with your host.'],
  ] as const) {
    view.session(receive(pending, { type: 'error', code, message: 'private server detail' }).session);
    const rendered = view.draw();
    assert.ok(rendered.some(textIs(message)), code);
    assert.ok(rendered.some(node => node.props?.label === 'Join'));
    assert.ok(!rendered.some(textIs('private server detail')));
  }
  assert.deepEqual(view.requests, ['BCDFG'], 'settlement does not replay a link');
  view.params({ inviteDelivery: '2', inviteCode: 'BCDFG' });
  view.draw();
  assert.deepEqual(view.requests, ['BCDFG', 'BCDFG']);
  view.session(offline('Ada', 'issued'));
  view.params({ inviteDelivery: '3', inviteCode: ['BCDFG', 'HJKMN'] });
  assert.ok(view.draw().some(textIs('This invite link is invalid. You can still join by room code.')));
  assert.deepEqual(view.requests, ['BCDFG', 'BCDFG']);
  view.draw().find(node => node.props?.accessibilityLabel === 'Room code').props.onChangeText('HJKMN');
  view.draw().find(node => node.props?.label === 'Join').props.onPress();
  assert.ok(!view.draw().some(textIs('This invite link is invalid. You can still join by room code.')));
  assert.deepEqual(view.requests, ['BCDFG', 'BCDFG', 'HJKMN']);
  view.unmount();
  assert.deepEqual(view.requests, ['BCDFG', 'BCDFG', 'HJKMN', 'close']);

  const ordinary = entryFixture();
  ordinary.draw();
  ordinary.params({ inviteDelivery: '4', inviteCode: 'HJKMN' });
  ordinary.draw();
  assert.deepEqual(ordinary.requests, ['resume', 'HJKMN']);
});

test('by-code store dispatch reuses the saved token, cannot replace busy sessions, and permits an explicit retry', () => {
  const opens: Session[] = [];
  const writes: [string, string][] = [];
  const stored = new Map([['atlas.token', 'saved'], ['atlas.name', 'Ada']]);
  const { useOnline } = loadComponent(new URL('../src/online/store.ts', import.meta.url).pathname, {
    'expo-secure-store': {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => writes.push([key, value]),
    },
    'expo-localization': {},
    './connection.ts': { connection: (_socket: unknown, get: () => Session) => ({ open: () => opens.push(get()) }) },
  });
  const join = useOnline.getState().joinRoom;
  join('BCDFG');
  assert.equal(opens.length, 1);
  assert.equal(opens[0]?.token, 'saved');
  assert.deepEqual(opens[0]?.request, { type: 'joinRoom', code: 'BCDFG' });
  assert.deepEqual(writes, [['atlas.name', 'Ada']]);
  const pending = opens[0]!;
  const welcomed = { type: 'welcome' as const, name: 'Ada', token: 'saved' };
  assert.deepEqual(receive(pending, { ...welcomed, resumed: false }).send, [{ type: 'joinRoom', code: 'BCDFG' }]);
  assert.deepEqual(receive(pending, { ...welcomed, resumed: true }).send, [], 'a saved game takes priority');

  const idle = offline('Ada', 'saved');
  const busy: Session[] = [pending, { ...idle, request: { type: 'resync' } }, { ...idle, room }, { ...idle, room, lost: 0 },
    { ...idle, room, leaving: true }, { ...idle, left: true }];
  for (const snapshot of busy) {
    useOnline.setState({ session: snapshot });
    join('HJKMN');
    assert.equal(useOnline.getState().session, snapshot);
  }
  assert.equal(opens.length, 1);
  assert.equal(writes.length, 1);

  useOnline.setState({ session: receive(pending, { type: 'error', code: 'room_full', message: '' }).session });
  join('BCDFG');
  assert.equal(opens.length, 2);
  assert.deepEqual(opens[1]?.request, { type: 'joinRoom', code: 'BCDFG' });
});
