import { randomInt } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  applyAction,
  legalActions,
  RULES,
  viewFor,
  type GameOptions,
  type GameState,
  type PlayerId,
} from '@atlas/engine';
import type { ErrorCode, ServerMessage } from './protocol.ts';

/** Who holds a seat: an account id and the display name it plays under. */
export interface Player {
  account: string;
  name: string;
}

/** A player's connection: who they are and a way to reach them. `send` does nothing once the connection is gone. */
export interface Member extends Player {
  send(message: ServerMessage): void;
}

/** A room whose game is in progress, as saved at a turn boundary. */
export interface Snapshot {
  code: string;
  countriesToWin: number;
  /** In seat order. */
  players: Player[];
  startedAt: Date;
  stateVersion: number;
  /** The engine's state, stored whole and never looked into. */
  game: GameState;
}

/** What is kept of a finished game. */
export interface Summary {
  /** In seat order. */
  players: Player[];
  countriesToWin: number;
  /** A seat, or null when the game ended without a winner. */
  winner: PlayerId | null;
  durationSeconds: number;
}

/** Where rooms are saved. Both calls return at once; the writes are done later, in the order of the calls. */
export interface RoomStore {
  save(snapshot: Snapshot): void;
  /** The game of room `code` is over: keeps its summary instead of its snapshot. */
  finish(code: string, summary: Summary): void;
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
  /** When the game started, in milliseconds since the epoch; 0 in the lobby. */
  startedAt: number;
}

// No vowels, so a code never spells a word; no I, L or O either.
const CODE_LETTERS = 'BCDFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 5;
const MAX_SEATS = Math.max(...RULES.playerCounts);

/**
 * The live rooms, held in memory and saved to `store` at each turn boundary of their game.
 * The engine is the only authority on the rules.
 */
export class Rooms {
  #newGame: (options: GameOptions) => GameState;
  #store: RoomStore;
  #byCode = new Map<string, Room>();
  /** The room of every connected member. */
  #byMember = new Map<Member, Room>();

  /** `snapshots` are the rooms to start with, each as it was last saved, with nobody connected. */
  constructor(newGame: (options: GameOptions) => GameState, store: RoomStore, snapshots: Snapshot[] = []) {
    this.#newGame = newGame;
    this.#store = store;
    for (const { code, countriesToWin, players, startedAt, stateVersion, game } of snapshots) {
      const members = players.map((player) => ({ ...player, send() {} }));
      this.#byCode.set(code, { code, countriesToWin, members, game, stateVersion, startedAt: startedAt.getTime() });
    }
  }

  /**
   * Puts a member who has just connected back in the seat their account holds in a game in progress, if nobody
   * is connected to that seat: they receive the room, then the current state.
   */
  resume(member: Member): void {
    for (const room of this.#byCode.values()) {
      if (!room.game || isOver(room.game)) continue;
      const seat = room.members.findIndex((held) => held.account === member.account && !this.#byMember.has(held));
      if (seat < 0) continue;
      room.members[seat] = member;
      this.#byMember.set(member, room);
      member.send(lobbyFor(room, seat));
      member.send(stateFor(room, room.game, seat));
      return;
    }
  }

  create(member: Member, countriesToWin: unknown): void {
    this.#requireNoRoom(member);
    if (typeof countriesToWin !== 'number' || !RULES.countriesToWin.includes(countriesToWin)) {
      throw new Rejection('bad_message', `countriesToWin must be one of ${RULES.countriesToWin.join(', ')}`);
    }
    let code: string;
    do code = Array.from({ length: CODE_LENGTH }, () => CODE_LETTERS[randomInt(CODE_LETTERS.length)]).join('');
    while (this.#byCode.has(code));
    const room: Room = { code, countriesToWin, members: [], stateVersion: 0, startedAt: 0 };
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
    room.startedAt = Date.now();
    this.#advance(room, this.#newGame({ players, countriesToWin: room.countriesToWin }));
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
    this.#advance(room, applyAction(room.game, seat, legal));
  }

  /**
   * The member's connection is gone: frees their lobby seat, and drops a room nobody is connected to.
   * A game in progress keeps its room and its seats, so that its players can come back (see `resume`).
   */
  leave(member: Member): void {
    const room = this.#byMember.get(member);
    if (!room) return;
    this.#byMember.delete(member);
    if (!room.game) {
      room.members.splice(room.members.indexOf(member), 1);
      sendLobby(room);
    }
    const inProgress = room.game && !isOver(room.game);
    if (!inProgress && !room.members.some((other) => this.#byMember.has(other))) this.#byCode.delete(room.code);
  }

  /**
   * The room's game is now `game`, one state version later: every player receives their new state, and the room
   * is saved if the turn has passed to another player, or replaced by a summary if the game is over.
   */
  #advance(room: Room, game: GameState): void {
    const turnPassed = room.game?.turn.player !== game.turn.player;
    room.game = game;
    room.stateVersion++;
    room.members.forEach((member, seat) => member.send(stateFor(room, game, seat)));

    const { code, countriesToWin, stateVersion } = room;
    const players = room.members.map(({ account, name }) => ({ account, name }));
    if (game.phase.kind === 'over') {
      const durationSeconds = Math.round((Date.now() - room.startedAt) / 1000);
      this.#store.finish(code, { players, countriesToWin, winner: game.phase.winner, durationSeconds });
    } else if (turnPassed) {
      this.#store.save({ code, countriesToWin, players, startedAt: new Date(room.startedAt), stateVersion, game });
    }
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

function isOver(game: GameState): boolean {
  return game.phase.kind === 'over';
}

function sendLobby(room: Room): void {
  room.members.forEach((member, you) => member.send(lobbyFor(room, you)));
}

function lobbyFor(room: Room, you: PlayerId): ServerMessage {
  const players = room.members.map(({ name }) => ({ name }));
  return { type: 'room', code: room.code, countriesToWin: room.countriesToWin, players, you };
}

/** A player gets their own view and legal actions; the full state never leaves the server. */
function stateFor(room: Room, game: GameState, seat: PlayerId): ServerMessage {
  return {
    type: 'state',
    stateVersion: room.stateVersion,
    view: viewFor(game, seat),
    legalActions: legalActions(game, seat),
  };
}
