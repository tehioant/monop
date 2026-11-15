import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGame, legalActions, viewFor, type PlayerId } from '@atlas/engine';
import type { ServerMessage } from '@atlas/server/protocol';
import {
  decode,
  disconnected,
  encode,
  hello,
  intent,
  offline,
  receive,
  type Game,
  type RoomRequest,
  type Room,
  type Session,
} from '../src/online/session.ts';

// Message fixtures, as the server sends them.
const create: RoomRequest = { type: 'createRoom', countriesToWin: 3 };
const join: RoomRequest = { type: 'joinRoom', code: 'bcdfg' };
const welcome: ServerMessage = { type: 'welcome', token: 'issued', name: 'Guest' };
const room: Room = { type: 'room', code: 'BCDFG', countriesToWin: 3, players: [{ name: 'Ada' }, { name: 'Bo' }], you: 1 };
const game = createGame({ players: 2, countriesToWin: 3 }, 1);
const state = (stateVersion: number, seat: PlayerId): Game => ({
  type: 'state',
  stateVersion,
  view: viewFor(game, seat),
  legalActions: legalActions(game, seat),
});

/** The session after `messages`, with everything sent in answer. */
function after(session: Session, ...messages: ServerMessage[]) {
  const sent = [];
  for (const message of messages) {
    const step = receive(session, message);
    session = step.session;
    sent.push(...step.send);
  }
  return { session, sent };
}

test('a first launch says hello without a token, keeps the one it is given, then sends its request', () => {
  assert.deepEqual(hello(null), { type: 'hello' });
  const { session, sent } = after({ ...offline(null), request: create }, welcome);
  assert.equal(session.token, 'issued');
  assert.deepEqual(sent, [create]);
  assert.deepEqual(hello(session.token), { type: 'hello', token: 'issued' });
});

test('a token the server does not know is dropped and hello is said again as a new guest', () => {
  const refused = after({ ...offline('old'), request: join }, { type: 'error', code: 'invalid_token', message: '' });
  assert.equal(refused.session.token, null);
  assert.deepEqual(refused.sent, [{ type: 'hello' }]);
  const { session, sent } = after(refused.session, welcome);
  assert.equal(session.token, 'issued');
  assert.deepEqual(sent, [join]);
});

test('the lobby answers the request and follows every change; states replace each other', () => {
  const grown: Room = { ...room, players: [...room.players, { name: 'Cy' }] };
  let { session, sent } = after({ ...offline('issued'), request: join }, welcome, room, grown);
  assert.equal(session.request, null);
  assert.deepEqual(session.room, grown);
  assert.equal(session.game, null);

  // A lower version (a restarted server) replaces the state all the same.
  ({ session, sent } = after(session, state(4, 1), state(2, 1)));
  assert.deepEqual(session.game, state(2, 1));
  assert.deepEqual(session.room, grown);
  assert.deepEqual(sent, []);
});

test('a refused request is over and reports the server code', () => {
  const { session, sent } = after(
    { ...offline('issued'), request: join },
    welcome,
    { type: 'error', code: 'room_not_found', message: 'No room has this code' },
  );
  assert.deepEqual(session, { ...offline('issued'), error: 'room_not_found' });
  assert.deepEqual(sent, [join]);
});

test('an intent carries the version of the state it was chosen from, and every message the protocol version', () => {
  const current = state(7, 0);
  const action = current.legalActions[0]!;
  assert.deepEqual(intent(current, action), { type: 'intent', stateVersion: 7, action });
  assert.deepEqual(JSON.parse(encode(intent(current, action))), { v: 1, type: 'intent', stateVersion: 7, action });
  assert.deepEqual(decode(JSON.stringify({ v: 1, ...room })), { v: 1, ...room });
});

test('a lost connection ends a lobby or a game in progress but keeps the token and a finished game', () => {
  const playing: Session = { ...offline('issued'), room, game: state(3, 1) };
  assert.deepEqual(disconnected(playing), { ...offline('issued'), error: 'disconnected' });
  assert.deepEqual(disconnected({ ...offline('issued'), request: create }), { ...offline('issued'), error: 'disconnected' });

  const final = state(9, 1);
  const finished: Session = { ...playing, game: { ...final, view: { ...final.view, phase: { kind: 'over', winner: 0 } } } };
  assert.equal(disconnected(finished), finished);
});
