import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createBot, type Bot } from '@atlas/bots';
import { CARDS, createGame, RULES, type Action, type PlayerView } from '@atlas/engine';
import { PROTOCOL_VERSION as v } from '../src/protocol.ts';
import { Client, newGame, person, prefer, startTestServer, type TestServer } from './helpers.ts';

let server: TestServer;
const clients: Client[] = [];
// How the games are dealt and who plays the bot seats: a test that needs its own sets them before starting.
let deal = newGame;
let bot: Bot = createBot('normal', 1);

before(async () => {
  server = await startTestServer({ newGame: (options) => deal(options), bot: (view, legal) => bot(view, legal) });
});

after(async () => {
  for (const client of clients) client.close();
  await server.close();
});

/** A new connection that has said hello, as a new guest or with the token of an earlier one. */
async function hello(who: { name?: string; token?: string }) {
  const client = await Client.connect(server.url);
  clients.push(client);
  client.send({ type: 'hello', ...who });
  const { token, name } = await client.next('welcome');
  return { client, token, name };
}

const guest = async (name: string) => (await hello({ name })).client;

/** A guest in the lobby of the room they have just created. */
async function host(name: string) {
  const client = await guest(name);
  client.send({ type: 'createRoom', countriesToWin: 3 });
  const { code } = await client.next('room');
  return { client, code };
}

/** The players of the lobby, as each of `members` is told next. */
async function lobby(...members: Client[]) {
  const rooms = [];
  for (const member of members) rooms.push(await member.next('room'));
  for (const room of rooms) assert.deepEqual(room.players, rooms[0]!.players);
  return rooms[0]!.players;
}

/** A seat held by a bot, as a `room` message lists it. */
const seated = (name: string) => ({ name, bot: true });

type State = Awaited<ReturnType<typeof Client.prototype.next<'state'>>>;

/** Sends the preferred legal action of `state`, if it has any, and reads the state that follows. */
async function step(client: Client, state: State, types: Action['type'][]): Promise<State> {
  const { stateVersion, legalActions } = state;
  if (legalActions.length > 0) client.send({ type: 'intent', stateVersion, action: prefer(legalActions, types) });
  const next = await client.next('state');
  assert.equal(next.stateVersion, stateVersion + 1);
  return next;
}

test('a player is known to the others by a name they can change, and a room by the setting its host chose', async () => {
  const first = await hello({ name: '  Ada of the very long name ' });
  assert.equal(first.name, 'Ada of the very long');
  // The same account, later: under a new name, then under no name in particular.
  assert.equal((await hello({ token: first.token, name: 'Ada' })).name, 'Ada');
  const ada = await hello({ token: first.token, name: ' ' });
  assert.equal(ada.name, 'Ada');
  assert.equal((await hello({})).name, 'Guest');

  ada.client.send({ type: 'createRoom', countriesToWin: 4 });
  assert.equal((await ada.client.next('error')).code, 'bad_message');
  ada.client.send({ type: 'createRoom', countriesToWin: 5 });
  const { code } = await ada.client.next('room');

  const friend = await guest('Bo');
  friend.send({ type: 'joinRoom', code });
  const room = await friend.next('room');
  assert.equal(room.countriesToWin, 5);
  assert.deepEqual(room.players, [person('Ada'), person('Bo')]);
});

test('a wrong code, a full room and a started game each refuse a player in their own way', async () => {
  const { client, code } = await host('Ada');
  const friend = await guest('Bo');
  const join = async (to: string) => {
    friend.send({ type: 'joinRoom', code: to });
    return (await friend.next('error')).code;
  };

  assert.equal(await join('AEIOU'), 'room_not_found'); // no code has a vowel

  const bots = ['Bot 1', 'Bot 2', 'Bot 3', 'Bot 4'].map(seated);
  for (const seats of bots.keys()) {
    client.send({ type: 'addBot' });
    assert.deepEqual(await lobby(client), [person('Ada'), ...bots.slice(0, seats + 1)]);
  }
  client.send({ type: 'addBot' });
  assert.equal((await client.next('error')).code, 'room_full');
  assert.equal(await join(code), 'room_full');

  client.send({ type: 'startGame' });
  await client.next('state');
  assert.equal(await join(code), 'game_started');
});

test('only the host seats bots and removes players; a removed player is told, and the host is never a bot', async () => {
  const { client: ada, code } = await host('Ada');
  const bo = await guest('Bo');
  bo.send({ type: 'joinRoom', code });
  await lobby(ada, bo);

  for (const message of [{ type: 'addBot' }, { type: 'removePlayer', seat: 0 }] as const) {
    bo.send(message);
    assert.equal((await bo.next('error')).code, 'not_host');
  }
  for (const seat of [0, 2, 'Bo']) {
    ada.sendRaw({ v, type: 'removePlayer', seat });
    assert.equal((await ada.next('error')).code, 'bad_message');
  }

  ada.send({ type: 'addBot' });
  ada.send({ type: 'addBot' });
  await lobby(ada, bo);
  assert.deepEqual(await lobby(ada, bo), [person('Ada'), person('Bo'), seated('Bot 1'), seated('Bot 2')]);
  ada.send({ type: 'removePlayer', seat: 2 });
  assert.deepEqual(await lobby(ada, bo), [person('Ada'), person('Bo'), seated('Bot 2')]);

  ada.send({ type: 'removePlayer', seat: 1 });
  await bo.next('removed');
  assert.deepEqual(await lobby(ada), [person('Ada'), seated('Bot 2')]);

  // Removed is not banned: the same connection is in no room, and may join again.
  bo.send({ type: 'joinRoom', code });
  await lobby(ada, bo);
  ada.send({ type: 'addBot' });
  assert.deepEqual(await lobby(ada, bo), [person('Ada'), seated('Bot 2'), person('Bo'), seated('Bot 1')]);

  ada.close();
  const room = await bo.next('room');
  assert.deepEqual(room.players, [person('Bo'), seated('Bot 2'), seated('Bot 1')]);
  assert.equal(room.you, 0);
});

test('a bot seat is played at once, from the view of its seat only, to the end of the game', async () => {
  const normal = createBot('normal', 1);
  const asked: PlayerView[] = [];
  bot = (view, legal) => {
    asked.push(view);
    return normal(view, legal);
  };
  const { client } = await host('Ada');
  client.send({ type: 'addBot' });
  await lobby(client);
  client.send({ type: 'startGame' });

  let state = await client.next('state');
  for (let steps = 0; state.view.phase.kind !== 'over'; steps++) {
    assert.ok(steps < 1000, 'the game ends');
    state = await step(client, state, ['lay', 'draw', 'endTurn']);
  }
  assert.ok(asked.length > 0);
  for (const view of asked) assert.equal(view.viewer, 1);
});

test('a bot seat survives a restart, and the turn it was playing is played again', async () => {
  // The host banks on its first turn. The bot holds a Levy and plays every card it can: its first turn stops
  // on the host, who has to pay.
  const levy = CARDS.find((card) => card.kind === 'action' && card.action === 'levy')!.id;
  const cards = CARDS.map((card) => card.id).filter((card) => card !== levy);
  cards.splice(RULES.startingHand, 0, levy);
  deal = (options) => createGame(options, 1, { deck: cards });
  bot = (_view, legal) => prefer(legal, ['play', 'draw', 'endTurn']);

  const ada = await hello({ name: 'Ada' });
  ada.client.send({ type: 'createRoom', countriesToWin: 3 });
  ada.client.send({ type: 'addBot' });
  ada.client.send({ type: 'startGame' });
  await lobby(ada.client);
  await lobby(ada.client);
  let state = await ada.client.next('state');
  while (state.view.turn.player === 0) state = await step(ada.client, state, ['bank', 'draw', 'endTurn']);
  while (state.legalActions.length === 0) state = await step(ada.client, state, []);
  assert.deepEqual([state.view.turn.player, state.view.phase.kind], [1, 'pay']);

  await server.restart();

  // Back under another name: like the seats, the names of a game in progress do not change.
  const { client } = await hello({ token: ada.token, name: 'Zoe' });
  assert.deepEqual(await lobby(client), [person('Ada'), seated('Bot 1')]);
  assert.deepEqual(await client.next('state'), state);
  while (state.view.turn.player === 1) state = await step(client, state, ['pay']);
});
