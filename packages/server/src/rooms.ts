import { randomInt } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { applyAction, legalActions, RULES, viewFor, type GameOptions, type GameState } from '@atlas/engine';
import type { ErrorCode, ServerMessage } from './protocol.ts';

/** A player's connection: a display name and a way to reach them. `send` does nothing once the connection is gone. */
export interface Member {
  name: string;
  send(message: ServerMessage): void;
}

/** A refused client message. Refusing never changes a room. */
export class Rejection extends Error {
  code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

interface Room {
  code: string;
  countriesToWin: number;
  /** In seat order; the host is seat 0. Seats are fixed once the game has started. */
  members: Member[];
  game?: GameState;
  stateVersion: number;
}

// No vowels, so a code never spells a word; no I, L or O either.
const CODE_LETTERS = 'BCDFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 5;
const MAX_SEATS = Math.max(...RULES.playerCounts);

/** The live rooms, held in memory. The engine is the only authority on the rules. */
export class Rooms {
  #newGame: (options: GameOptions) => GameState;
  #byCode = new Map<string, Room>();
  #byMember = new Map<Member, Room>();

  constructor(newGame: (options: GameOptions) => GameState) {
    this.#newGame = newGame;
  }

  create(member: Member, countriesToWin: unknown): void {
    this.#requireNoRoom(member);
    if (typeof countriesToWin !== 'number' || !RULES.countriesToWin.includes(countriesToWin)) {
      throw new Rejection('bad_message', `countriesToWin must be one of ${RULES.countriesToWin.join(', ')}`);
    }
    let code: string;
    do code = Array.from({ length: CODE_LENGTH }, () => CODE_LETTERS[randomInt(CODE_LETTERS.length)]).join('');
    while (this.#byCode.has(code));
    const room: Room = { code, countriesToWin, members: [], stateVersion: 0 };
    this.#byCode.set(code, room);
    this.#seat(room, member);
  }

  join(member: Member, code: unknown): void {
    this.#requireNoRoom(member);
    const room = typeof code === 'string' ? this.#byCode.get(code.trim().toUpperCase()) : undefined;
    if (!room) throw new Rejection('room_not_found', 'No room has this code');
    if (room.game) throw new Rejection('game_started', 'The game has already started');
    if (room.members.length >= MAX_SEATS) throw new Rejection('room_full', 'The room is full');
    this.#seat(room, member);
  }

  start(member: Member): void {
    const room = this.#roomOf(member);
    if (room.game) throw new Rejection('game_started', 'The game has already started');
    if (room.members[0] !== member) throw new Rejection('not_host', 'Only the host starts the game');
    const players = room.members.length;
    if (!RULES.playerCounts.includes(players)) {
      throw new Rejection('not_enough_players', `A game needs at least ${Math.min(...RULES.playerCounts)} players`);
    }
    room.game = this.#newGame({ players, countriesToWin: room.countriesToWin });
    room.stateVersion = 1;
    sendState(room, room.game);
  }

  /** Applies `action` for the member's seat if it is one of the engine's legal actions for the current state. */
  intent(member: Member, stateVersion: unknown, action: unknown): void {
    const room = this.#roomOf(member);
    if (!room.game) throw new Rejection('illegal_action', 'The game has not started');
    if (stateVersion !== room.stateVersion) {
      throw new Rejection('stale', `The game is at state version ${room.stateVersion}`);
    }
    const seat = room.members.indexOf(member);
    // The engine is given its own action back, never the client's data.
    const legal = legalActions(room.game, seat).find((candidate) => isDeepStrictEqual(candidate, action));
    if (!legal) throw new Rejection('illegal_action', 'Not a legal action for this player now');
    room.game = applyAction(room.game, seat, legal);
    room.stateVersion++;
    sendState(room, room.game);
  }

  /** The member's connection is gone: frees their lobby seat, and drops a room nobody is connected to. */
  leave(member: Member): void {
    const room = this.#byMember.get(member);
    if (!room) return;
    this.#byMember.delete(member);
    if (!room.game) {
      room.members.splice(room.members.indexOf(member), 1);
      sendLobby(room);
    }
    if (!room.members.some((other) => this.#byMember.has(other))) this.#byCode.delete(room.code);
  }

  #seat(room: Room, member: Member): void {
    room.members.push(member);
    this.#byMember.set(member, room);
    sendLobby(room);
  }

  #roomOf(member: Member): Room {
    const room = this.#byMember.get(member);
    if (!room) throw new Rejection('bad_message', 'Not in a room');
    return room;
  }

  #requireNoRoom(member: Member): void {
    if (this.#byMember.has(member)) throw new Rejection('bad_message', 'Already in a room');
  }
}

function sendLobby(room: Room): void {
  const players = room.members.map(({ name }) => ({ name }));
  room.members.forEach((member, you) => {
    member.send({ type: 'room', code: room.code, countriesToWin: room.countriesToWin, players, you });
  });
}

/** Every player gets their own view and legal actions; the full state never leaves the server. */
function sendState(room: Room, game: GameState): void {
  room.members.forEach((member, seat) => {
    member.send({
      type: 'state',
      stateVersion: room.stateVersion,
      view: viewFor(game, seat),
      legalActions: legalActions(game, seat),
    });
  });
}
