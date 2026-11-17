import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGame, legalActions, viewFor, type PlayerId } from '@atlas/engine';
import { PROTOCOL_VERSION, type ServerMessage } from '@atlas/server/protocol';
import {
  backoff,
  decode,
  defaultName,
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
const resync: RoomRequest = { type: 'resync' };
const welcome: ServerMessage = { type: 'welcome', token: 'issued', name: 'Bo', resumed: false };
const back: ServerMessage = { ...welcome, resumed: true };
const seat = (name: string, bot = false) => ({ name, bot, status: 'connected' as const });
const players = [seat('Ada'), seat('Bo')];
const room: Room = { type: 'room', code: 'BCDFG', countriesToWin: 3, players, you: 1 };
const refusal = (code: 'room_not_found' | 'unsupported_version'): ServerMessage => ({ type: 'error', code, message: '' });
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

test('a first launch says hello under its name without a token, keeps the one it is given, then sends its request', () => {
  assert.match(defaultName(), /^Guest \d{4}$/);
  assert.deepEqual(hello(offline('Bo', null)), { type: 'hello', name: 'Bo' });
  const { session, sent } = after({ ...offline('Bo', null), request: create }, welcome);
  assert.equal(session.token, 'issued');
  assert.deepEqual(sent, [create]);
  // The name goes with every hello: that is how it is changed.
  assert.deepEqual(hello({ ...session, name: 'Bo B' }), { type: 'hello', token: 'issued', name: 'Bo B' });
});

test('a token the server does not know is dropped and hello is said again as a new guest', () => {
  const refused = after({ ...offline('Bo', 'old'), request: join }, { type: 'error', code: 'invalid_token', message: '' });
  assert.equal(refused.session.token, null);
  assert.deepEqual(refused.sent, [{ type: 'hello', name: 'Bo' }]);
  const { session, sent } = after(refused.session, welcome);
  assert.equal(session.token, 'issued');
  assert.deepEqual(sent, [join]);
});

test('the lobby answers the request and follows every change; each state replaces the one before', () => {
  const grown: Room = { ...room, players: [...players, seat('Bot 1', true)] };
  let { session, sent } = after({ ...offline('Bo', 'issued'), request: join }, welcome, room, grown);
  assert.equal(session.request, null);
  assert.deepEqual(session.room, grown);
  assert.equal(session.game, null);

  // The first state is taken whatever its version: the game may have been joined in the middle (a seat taken back).
  ({ session, sent } = after(session, state(4, 1), state(5, 1)));
  assert.deepEqual(session.game, state(5, 1));
  assert.deepEqual(session.room, grown);
  assert.deepEqual(sent, []);
});

test('a state that does not follow the known one is not taken: a resync is asked, and its answer is', () => {
  const playing: Session = { ...offline('Bo', 'issued'), room, game: state(4, 1), synced: true };

  // A gap forward. A state that was on its way is taken, and so is the answer that repeats it.
  let { session, sent } = after(playing, state(6, 1));
  assert.deepEqual(session.game, state(4, 1));
  assert.deepEqual(sent, [resync]);
  ({ session, sent } = after(session, state(7, 1), state(7, 1), state(8, 1)));
  assert.deepEqual(session.game, state(8, 1));
  assert.deepEqual(sent, []);

  // A version going back on the same connection is a gap as well; the server's answer is the truth.
  ({ session, sent } = after(playing, state(2, 1), state(2, 1)));
  assert.deepEqual(session.game, state(2, 1));
  assert.deepEqual(sent, [resync]);
});

test('accepting the same deadline packet is deterministic regardless of the device clock', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const prepared = { ...offline('Bo', 'issued'), room };
  const packet = { ...state(3, 1), deadline: { kind: 'turn', at: 1200 } as const, serverTime: 1000 };
  const before = receive(prepared, packet);
  t.mock.timers.setTime(1600);
  assert.deepEqual(receive(prepared, packet), before);
  assert.deepEqual(before.session.game, packet);
});

test('a refused request is over and reports the server code', () => {
  const { session, sent } = after(
    { ...offline('Bo', 'issued'), request: join },
    welcome,
    refusal('room_not_found'),
  );
  assert.deepEqual(session, { ...offline('Bo', 'issued'), error: 'room_not_found' });
  assert.deepEqual(sent, [join]);
});

test('a player removed by the host, replaced by another device or with an outdated app is in no room, and knows why', () => {
  const playing = after({ ...offline('Bo', 'issued'), request: join }, welcome, room, state(1, 1)).session;
  for (const [message, error] of [
    [{ type: 'removed' }, 'removed'],
    [{ type: 'replaced' }, 'replaced'],
    [refusal('unsupported_version'), 'unsupported_version'],
  ] as const) {
    assert.deepEqual(after(playing, message), { session: { ...offline('Bo', 'issued'), error }, sent: [] });
  }
});

test('opening the online screen goes back to the game in progress, if the account has one', () => {
  const asking: Session = { ...offline('Bo', 'issued'), request: resync };
  assert.deepEqual(after(asking, welcome), { session: offline('Bo', 'issued'), sent: [] });

  // The server puts the account back in its seat by itself: nothing is sent, not even a room request.
  for (const request of [resync, create]) {
    const { session, sent } = after({ ...asking, request }, back, room, state(6, 1));
    assert.deepEqual(session, { ...offline('Bo', 'issued'), room, game: state(6, 1), synced: true });
    assert.deepEqual(sent, []);
  }
});

test('an intent carries the version of the state it was chosen from, and every message the protocol version', () => {
  const current = state(7, 0);
  const action = current.legalActions[0]!;
  assert.deepEqual(intent(current, action), { type: 'intent', stateVersion: 7, action });
  assert.deepEqual(JSON.parse(encode(intent(current, action))), { v: PROTOCOL_VERSION, type: 'intent', stateVersion: 7, action });
  assert.deepEqual(decode(JSON.stringify({ v: PROTOCOL_VERSION, ...room })), { v: PROTOCOL_VERSION, ...room });
});

test('a connection lost during a game is opened again: the game stays on screen until the server gives it again', () => {
  const playing = after({ ...offline('Bo', 'issued'), request: join }, welcome, room, state(3, 1)).session;
  const lost = disconnected(playing);
  assert.deepEqual(lost, { ...playing, synced: false, request: resync, lost: 0 });
  // Each failed attempt counts, and the wait before the next one grows up to a limit.
  assert.equal(disconnected(disconnected(lost)).lost, 2);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 9].map(backoff), [500, 1000, 2000, 4000, 8000, 8000, 8000]);

  // Back in the seat. A restarted server may be at an older version: its state is the truth.
  const away: Room = { ...room, players: [{ ...seat('Ada'), status: 'disconnected' }, seat('Bo')] };
  const { session, sent } = after(lost, back, away, state(2, 1));
  assert.deepEqual(session, { ...playing, room: away, game: state(2, 1) });
  assert.deepEqual(sent, []);

  // The game ended in the meantime: there is no seat to come back to.
  assert.deepEqual(after(lost, welcome), { session: { ...offline('Bo', 'issued'), error: 'ended' }, sent: [] });
});

test('a connection lost in a lobby joins the room again, if it is still there', () => {
  const waiting = after({ ...offline('Bo', 'issued'), request: create }, welcome, room).session;
  const lost = disconnected(waiting);
  const again: RoomRequest = { type: 'joinRoom', code: 'BCDFG' };
  assert.deepEqual(lost, { ...waiting, request: again, lost: 0 });
  assert.deepEqual(after(lost, welcome, room), { session: waiting, sent: [again] });
  assert.deepEqual(after(lost, welcome, refusal('room_not_found')).session, { ...offline('Bo', 'issued'), error: 'room_not_found' });
  // An explicit leave whose reply was lost must not re-seat the player in the lobby.
  assert.deepEqual(disconnected({ ...waiting, leaving: true }), { ...offline('Bo', 'issued'), error: 'disconnected' });
});

test('after a lost leave acknowledgement, no held seat is reported honestly and a held seat can retry', () => {
  const playing = { ...offline('Bo', 'issued'), room, game: state(3, 1), synced: true };
  assert.equal(receive(playing, { type: 'left' }).session, playing, 'an unsolicited acknowledgement is ignored');
  const pending = { ...playing, leaving: true };
  assert.equal(receive(pending, { type: 'left' }).session.left, true);
  const lost = disconnected(disconnected(pending));
  assert.equal(lost.leaving, true);
  assert.deepEqual(after(lost, welcome), { session: { ...offline('Bo', 'issued'), error: 'seat_unavailable' }, sent: [] });
  const resumed = after(lost, back, room, state(3, 1));
  assert.deepEqual(resumed, { session: { ...playing, leaving: false, error: 'leave_failed' }, sent: [] });
});

test('a connection lost before any room is given up, and one lost after the game is over changes nothing', () => {
  assert.deepEqual(disconnected({ ...offline('Bo', 'issued'), request: create }), { ...offline('Bo', 'issued'), error: 'disconnected' });

  const final = state(9, 1);
  const over: Game = { ...final, view: { ...final.view, phase: { kind: 'over', winner: 0 } } };
  const finished = after({ ...offline('Bo', 'issued'), request: join }, welcome, room, over).session;
  assert.equal(disconnected(finished), finished);
});
