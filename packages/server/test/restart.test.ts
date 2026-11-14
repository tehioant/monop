import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Client, newGame, startTestServer, type TestServer } from './helpers.ts';

let server: TestServer;
const clients: Client[] = [];

before(async () => {
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
  const { token } = await client.next('welcome');
  return { client, token };
}

type Players = readonly [Client, Client];

/** The next message of each player, which must be a state. */
async function nextStates([host, friend]: Players) {
  return [await host.next('state'), await friend.next('state')] as const;
}
type States = Awaited<ReturnType<typeof nextStates>>;

/** The player the game is waiting on sends an intent; seat 0 lays every city it can, seat 1 only draws and passes. */
async function act(players: Players, states: States): Promise<States> {
  const preferred = [['lay', 'draw', 'endTurn'], ['draw', 'endTurn']];
  const seat = states.findIndex((state) => state.legalActions.length > 0);
  const { stateVersion, legalActions } = states[seat]!;
  const action = preferred[seat]!.map((type) => legalActions.find((a) => a.type === type)).find(Boolean);
  players[seat]!.send({ type: 'intent', stateVersion, action: action ?? legalActions[0]! });
  return nextStates(players);
}

test('a game survives a server restart in mid-turn, is finished by its players, and leaves only a summary', async (t) => {
  // Only the clock is scripted, for the duration of the game.
  const startedAt = Date.UTC(2026, 0, 1);
  t.mock.timers.enable({ apis: ['Date'], now: startedAt });

  const ada = await hello({ name: 'Ada' });
  const bo = await hello({ name: 'Bo' });
  ada.client.send({ type: 'createRoom', countriesToWin: 3 });
  const { code } = await ada.client.next('room');
  bo.client.send({ type: 'joinRoom', code });
  await ada.client.next('room');
  const lobby = await bo.client.next('room');
  ada.client.send({ type: 'startGame' });

  // Seat 0 plays its first turn; seat 1 starts its own, then acts once more: that last action is not saved.
  let players: Players = [ada.client, bo.client];
  let states = await nextStates(players);
  while (states[0].view.turn.player === 0) states = await act(players, states);
  const turnStart = states;
  states = await act(players, states);
  assert.equal(states[0].view.turn.player, 1);

  await server.restart();

  // Each player is back in their seat, whoever connects first, with the game as it was when the turn passed.
  const boAgain = await hello({ token: bo.token });
  const adaAgain = await hello({ token: ada.token });
  players = [adaAgain.client, boAgain.client];
  assert.deepEqual(await players[0].next('room'), { ...lobby, you: 0 });
  assert.deepEqual(await players[1].next('room'), lobby);
  states = await nextStates(players);
  assert.deepEqual(states, turnStart);

  t.mock.timers.setTime(startedAt + 754_000);
  for (let step = 0; states[0].view.phase.kind !== 'over'; step++) {
    assert.ok(step < 100, 'the scripted game is short');
    states = await act(players, states);
  }
  assert.deepEqual(states[0].view.phase, { kind: 'over', winner: 0 });

  // A finished game is not restored: after another restart its players are in no room.
  await server.restart();
  const later = await hello({ token: ada.token });
  later.client.send({ type: 'createRoom', countriesToWin: 5 });
  assert.equal((await later.client.next('room')).countriesToWin, 5);

  assert.equal((await server.db`select from room_snapshots`).length, 0);
  const accounts = await server.db<{ id: string; name: string }[]>`select id, name from accounts`;
  const player = (name: string) => ({ account: accounts.find((account) => account.name === name)!.id, name });
  const summaries = await server.db`select players, countries_to_win, winner, duration_seconds from game_summaries`;
  assert.deepEqual(
    [...summaries],
    [{ players: [player('Ada'), player('Bo')], countries_to_win: 3, winner: 0, duration_seconds: 754 }],
  );
});
