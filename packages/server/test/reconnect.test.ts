import assert from 'node:assert/strict';
import { after, before, mock, test } from 'node:test';
import { applyAction, legalActions, viewFor } from '@atlas/engine';
import { HEARTBEAT_MS, PROTOCOL_VERSION as v } from '../src/protocol.ts';
import { Client, newGame, nextStates, person, startTestServer, type TestServer } from './helpers.ts';

let server: TestServer;
const clients: Client[] = [];

before(async () => {
  // The server's sweep of silent connections runs only when a test moves the clock.
  mock.timers.enable({ apis: ['setInterval'] });
  server = await startTestServer({ newGame });
});

after(async () => {
  for (const client of clients) client.close();
  await server.close();
});

/** A new connection that has said hello, as a new guest or with the token of an earlier one. */
async function hello(who: { name: string } | { token: string }) {
  const client = await Client.connect(server.url);
  clients.push(client);
  client.send({ type: 'hello', ...who });
  return { client, welcome: await client.next('welcome') };
}

/** Ada and Bo in a started game: Bo's token, the room as Bo sees it, and the first state each received. */
async function startedGame() {
  const ada = await hello({ name: 'Ada' });
  const bo = await hello({ name: 'Bo' });
  ada.client.send({ type: 'createRoom', countriesToWin: 3 });
  const { code } = await ada.client.next('room');
  bo.client.send({ type: 'joinRoom', code });
  await ada.client.next('room');
  const room = await bo.client.next('room');
  ada.client.send({ type: 'startGame' });
  const states = await nextStates([ada.client, bo.client]);
  return { ada: ada.client, bo: bo.client, token: bo.welcome.token, room, states };
}

const away = (name: string) => ({ ...person(name), status: 'disconnected' });

test('a player who loses the connection keeps the seat, is seen disconnected, and is back with the current state', async () => {
  const { ada, bo, token, room, states } = await startedGame();

  bo.close();
  assert.deepEqual(await ada.next('room'), { ...room, players: [person('Ada'), away('Bo')], you: 0 });

  // The game goes on in the meantime.
  const { stateVersion } = states[0];
  const action = states[0].legalActions[0]!;
  ada.send({ type: 'intent', stateVersion, action });
  const current = await ada.next('state');
  const game = applyAction(newGame({ players: 2, countriesToWin: 3 }), 0, action);

  const back = await hello({ token });
  assert.equal(back.welcome.resumed, true);
  assert.deepEqual(await back.client.next('room'), room);
  assert.deepEqual(await back.client.next('state'), {
    v,
    type: 'state',
    stateVersion: stateVersion + 1,
    view: viewFor(game, 1),
    legalActions: legalActions(game, 1),
  });
  assert.deepEqual(await ada.next('room'), { ...room, you: 0 });

  // A connection can be dead without the server knowing: the newest one of an account takes its seat.
  const newer = await hello({ token });
  assert.deepEqual(await newer.client.next('room'), room);
  assert.equal((await newer.client.next('state')).stateVersion, stateVersion + 1);
  await back.client.next('replaced');
  await back.client.closed;

  // A resync gives again what the last messages gave. Ada was told of each connection of Bo's.
  assert.deepEqual(await ada.next('room'), { ...room, you: 0 });
  ada.send({ type: 'resync' });
  assert.deepEqual(await ada.next('room'), { ...room, you: 0 });
  assert.deepEqual(await ada.next('state'), current);
});

test('a resync in a lobby gives the room; outside a room it is refused', async () => {
  const { client } = await hello({ name: 'Cy' });
  client.send({ type: 'resync' });
  assert.equal((await client.next('error')).code, 'bad_message');
  client.send({ type: 'createRoom', countriesToWin: 3 });
  const room = await client.next('room');
  client.send({ type: 'resync' });
  assert.deepEqual(await client.next('room'), room);
});

test('a client speaking another protocol version is told so, whatever it sends', async () => {
  const outdated = await Client.connect(server.url);
  clients.push(outdated);
  for (const type of ['hello', 'ping', 'no such message']) {
    outdated.sendRaw({ v: v - 1, type });
    const refusal = await outdated.next('error');
    assert.equal(refusal.code, 'unsupported_version');
    assert.equal(refusal.v, v);
  }
});

test('a connection that stays silent is closed and its player seen disconnected; a ping keeps one open', async () => {
  const { ada, bo, room } = await startedGame();

  // Both have been heard from since the last sweep. From here on, only Bo is.
  mock.timers.tick(2 * HEARTBEAT_MS);
  bo.send({ type: 'ping' });
  await bo.next('pong');
  mock.timers.tick(2 * HEARTBEAT_MS);

  await ada.closed;
  assert.deepEqual(await bo.next('room'), { ...room, players: [away('Ada'), person('Bo')] });
});
