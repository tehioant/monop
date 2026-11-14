import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import {
  applyAction,
  CARDS,
  COUNTRIES,
  createGame,
  RULES,
  viewFor,
  type CardId,
  type GameOptions,
} from '@atlas/engine';
import { PROTOCOL_VERSION as v } from '../src/protocol.ts';
import { Client, startTestServer, type TestServer } from './helpers.ts';

// Every game of this file is dealt from the same stacked deck: seat 0 starts with cities of the three smallest
// countries and draws the missing ones first, so it can win a 3-country game in a few turns.
const winning: CardId[] = [...COUNTRIES]
  .sort((a, b) => a.cities.length - b.cities.length)
  .slice(0, 3)
  .flatMap((country) => country.cities);
const others = CARDS.map((card) => card.id).filter((card) => !winning.includes(card));
const deck = [
  ...winning.slice(0, RULES.startingHand),
  ...others.slice(0, RULES.startingHand),
  ...winning.slice(RULES.startingHand),
  ...others.slice(RULES.startingHand),
];
const newGame = (options: GameOptions) => createGame(options, 1, { deck });

let server: TestServer;
const clients: Client[] = [];

before(async () => {
  server = await startTestServer({ newGame });
});

after(async () => {
  for (const client of clients) client.close();
  await server.close();
});

async function connect(): Promise<Client> {
  const client = await Client.connect(server.url);
  clients.push(client);
  return client;
}

async function guest(name: string): Promise<Client> {
  const client = await connect();
  client.send({ type: 'hello', name });
  await client.next('welcome');
  return client;
}

type Players = readonly [Client, Client];

/** The next message of each player, which must be a state. */
async function nextStates([host, friend]: Players) {
  return [await host.next('state'), await friend.next('state')] as const;
}

/** Two guests in a started game, in seat order, with the first state each of them received. */
async function startedGame() {
  const players: Players = [await guest('Ada'), await guest('Bo')];
  players[0].send({ type: 'createRoom', countriesToWin: 3 });
  const { code } = await players[0].next('room');
  players[1].send({ type: 'joinRoom', code });
  await players[0].next('room');
  await players[1].next('room');
  players[0].send({ type: 'startGame' });
  return { players, states: await nextStates(players) };
}

test('a first hello creates a guest account stored in Postgres; its token identifies it afterwards', async () => {
  const stored = () => server.db`select name from accounts where name = 'Zed'`;

  const first = await connect();
  first.send({ type: 'hello', name: 'Zed' });
  const welcome = await first.next('welcome');
  assert.deepEqual(welcome, { v, type: 'welcome', token: welcome.token, name: 'Zed' });
  assert.equal((await stored()).length, 1);

  const again = await connect();
  again.send({ type: 'hello', token: welcome.token });
  assert.deepEqual(await again.next('welcome'), welcome);
  assert.equal((await stored()).length, 1);

  const stranger = await connect();
  stranger.send({ type: 'hello', token: 'not-a-token' });
  assert.equal((await stranger.next('error')).code, 'invalid_token');
  stranger.sendRaw({ v: v + 1, type: 'hello' });
  assert.equal((await stranger.next('error')).code, 'unsupported_version');
});

test('a guest creates a private room, another joins by its code, and the host starts with two seats filled', async () => {
  const host = await guest('Ada');
  const friend = await guest('Bo');

  host.send({ type: 'createRoom', countriesToWin: 3 });
  const room = await host.next('room');
  assert.match(room.code, /^[A-Z]{5}$/);
  assert.deepEqual(room, { v, type: 'room', code: room.code, countriesToWin: 3, players: [{ name: 'Ada' }], you: 0 });

  host.send({ type: 'startGame' });
  assert.equal((await host.next('error')).code, 'not_enough_players');

  friend.send({ type: 'joinRoom', code: room.code });
  const lobby = { ...room, players: [{ name: 'Ada' }, { name: 'Bo' }] };
  assert.deepEqual(await host.next('room'), lobby);
  assert.deepEqual(await friend.next('room'), { ...lobby, you: 1 });

  friend.send({ type: 'startGame' });
  assert.equal((await friend.next('error')).code, 'not_host');

  host.send({ type: 'startGame' });
  for (const [seat, player] of [host, friend].entries()) {
    const state = await player.next('state');
    assert.equal(state.stateVersion, 1);
    assert.deepEqual(state.view, viewFor(newGame({ players: 2, countriesToWin: 3 }), seat));
    assert.equal(state.legalActions.length > 0, seat === 0);
  }
});

test('scripted clients play a full game to a win, each receiving only its own view', async () => {
  const { players, states: first } = await startedGame();
  // Seat 0 lays every city it can; seat 1 only draws and passes.
  const preferred = [['lay', 'draw', 'endTurn'], ['draw', 'endTurn']];

  let states = first;
  for (let step = 0; states[0].view.phase.kind !== 'over'; step++) {
    assert.ok(step < 100, 'the scripted game is short');
    const seat = states.findIndex((state) => state.legalActions.length > 0);
    const { stateVersion, legalActions } = states[seat]!;
    const action = preferred[seat]!.map((type) => legalActions.find((a) => a.type === type)).find(Boolean);
    players[seat]!.send({ type: 'intent', stateVersion, action: action ?? legalActions[0]! });

    states = await nextStates(players);
    states.forEach((state, viewer) => {
      assert.deepEqual(Object.keys(state).sort(), ['legalActions', 'stateVersion', 'type', 'v', 'view']);
      assert.equal(state.stateVersion, stateVersion + 1);
      assert.equal(state.view.viewer, viewer);
    });
  }
  for (const state of states) {
    assert.deepEqual(state.view.phase, { kind: 'over', winner: 0 });
    assert.deepEqual(state.legalActions, []);
  }

  // A card dealt face down and never played, or still in the deck, appears in no message to another player.
  const sentTo = (player: Client) => player.raw.join('\n');
  const kept = (seat: number) => first[seat]!.view.hand.filter((card) => states[seat]!.view.hand.includes(card));
  assert.ok(kept(1).length > 0);
  for (const card of kept(1)) assert.ok(!sentTo(players[0]).includes(`"${card}"`), card);
  for (const card of kept(0)) assert.ok(!sentTo(players[1]).includes(`"${card}"`), card);
  for (const player of players) assert.ok(!sentTo(player).includes(`"${deck.at(-1)}"`));
});

test('illegal, out-of-turn and stale intents are rejected without changing the game', async () => {
  const { players, states } = await startedGame();
  const [host, friend] = players;
  const { stateVersion, legalActions } = states[0];
  const action = legalActions[0]!;

  friend.send({ type: 'intent', stateVersion, action }); // not the player the game is waiting on
  assert.equal((await friend.next('error')).code, 'illegal_action');
  host.sendRaw({ v, type: 'intent', stateVersion, action: { ...action, more: true } }); // not exactly a legal action
  assert.equal((await host.next('error')).code, 'illegal_action');
  host.send({ type: 'intent', stateVersion: stateVersion - 1, action });
  assert.equal((await host.next('error')).code, 'stale');

  // Nothing else was sent, and the next legal intent leads where it would have led in an untouched game.
  host.send({ type: 'intent', stateVersion, action });
  const expected = applyAction(newGame({ players: 2, countriesToWin: 3 }), 0, action);
  for (const [seat, player] of players.entries()) {
    const state = await player.next('state');
    assert.equal(state.stateVersion, stateVersion + 1);
    assert.deepEqual(state.view, viewFor(expected, seat));
  }
});
