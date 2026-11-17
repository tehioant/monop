import { randomInt } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { Bot } from '@atlas/bots';
import {
  applyAction,
  legalActions,
  RULES,
  viewFor,
  type Action,
  type CardId,
  type GameOptions,
  type GameState,
  type PlayerId,
} from '@atlas/engine';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, type Deadline, type ErrorCode, type RoomPlayer, type ServerMessage } from './protocol.ts';

/** Who holds a seat: an account id, or null for a bot, and the display name it plays under. */
export interface Player {
  account: string | null;
  name: string;
}

/** A player's connection: who they are and a way to reach them. Both calls do nothing once the connection is gone. */
export interface Member extends Player {
  send(message: ServerMessage): void;
  /** Ends the connection. */
  close(): void;
}

/** A seat nobody is connected to: a bot's, or a person's in a game restored from its snapshot. */
const absent = (player: Player): Member => ({ ...player, send() {}, close() {} });

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

/** Room writes are queued in call order. Permanent leave waits for its snapshot write. */
export interface RoomStore {
  save(snapshot: Snapshot): void | Promise<void>;
  /** The game of room `code` is over: keeps its summary instead of its snapshot. */
  finish(code: string, summary: Summary): void;
  /** Removes an abandoned snapshot without recording a completed game. */
  discard(code: string): void | Promise<void>;
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
  turnEndsAt?: number;
  deadline?: Deadline;
  moveTimer?: ReturnType<typeof setTimeout>;
  abandonTimer?: ReturnType<typeof setTimeout>;
  expiring?: true;
  discarding?: Promise<boolean>;
  halted?: true;
  covered: Set<Member>;
  leaving?: { member: Member; settled: Promise<void> };
}

export interface RoomTiming {
  turnMs: number;
  responseMs: number;
  graceMs: number;
  abandonedMs: number;
}

export const DEFAULT_ROOM_TIMING: RoomTiming = { turnMs: 60_000, responseMs: 15_000, graceMs: 10_000, abandonedMs: 300_000 };

const MAX_SEATS = Math.max(...RULES.playerCounts);
const DISCARD_RETRY_MS = 1_000;

/**
 * The live rooms, held in memory and saved to `store` at each turn boundary of their game.
 * The engine is the only authority on the rules.
 */
export class Rooms {
  #newGame: (options: GameOptions) => GameState;
  #bot: Bot;
  #store: RoomStore;
  #timing: RoomTiming;
  #stopped = false;
  #grace = new Map<Member, ReturnType<typeof setTimeout>>();
  #byCode = new Map<string, Room>();
  /** The room of every connected member. A person whose seat is not in it is disconnected. */
  #byMember = new Map<Member, Room>();

  /**
   * `bot` plays the bot seats. `snapshots` are the rooms to start with, each as it was last saved, with nobody
   * connected.
   */
  constructor(
    newGame: (options: GameOptions) => GameState,
    bot: Bot,
    store: RoomStore,
    snapshots: Snapshot[] = [],
    timing = DEFAULT_ROOM_TIMING,
  ) {
    this.#newGame = newGame;
    this.#bot = bot;
    this.#store = store;
    this.#timing = timing;
    for (const { code, countriesToWin, players, startedAt, stateVersion, game } of snapshots) {
      const members = players.map(absent);
      const room: Room = { code, countriesToWin, members, game, stateVersion, startedAt: startedAt.getTime(), covered: new Set() };
      this.#byCode.set(code, room);
      this.#setDeadline(room, game);
      if (!isOver(game)) members.filter(isPerson).forEach(member => this.#startGrace(room, member));
      this.#refreshPresence(room);
    }
  }

  /** Whether the account holds a seat in a game in progress, which `resume` would put a connection back in. */
  playing(account: string): boolean {
    return this.#seatOf(account) !== undefined;
  }

  /** Before welcoming a reconnect, wait for any in-flight release of its own seat. */
  pendingDeparture(account: string): Promise<void> | undefined {
    const held = this.#seatOf(account);
    const leaving = held?.room.leaving;
    if (held && leaving?.member === held.room.members[held.seat]) return leaving?.settled;
  }

  /**
   * Puts a member who has just connected back in the seat their account holds in a game in progress, if any:
   * they receive the room, then the current state, and the other players see them connected.
   * A connection that still held the seat is told that it has been replaced, and closed: the newest one wins,
   * since the old one may be dead without the server knowing.
   */
  resume(member: Member): void {
    const held = this.#seatOf(member.account!);
    if (!held) return;
    const { room, seat } = held;
    const previous = room.members[seat]!;
    if (room.leaving?.member === previous) return;
    if (this.#byMember.delete(previous)) {
      previous.send({ type: 'replaced' });
      previous.close();
    }
    // Like the seats, the names of a game are final once it has started.
    this.#clearGrace(previous);
    room.covered.delete(previous);
    member.name = previous.name;
    room.members[seat] = member;
    this.#byMember.set(member, room);
    this.#sendRoom(room);
    member.send(stateFor(room, room.game!, seat));
    this.#refreshPresence(room);
  }

  /** The member asks for what they should already have: their room and, once the game has started, its state. */
  resync(member: Member): void {
    const room = this.#roomOf(member);
    const seat = room.members.indexOf(member);
    member.send(this.#roomFor(room, seat));
    if (room.game) member.send(stateFor(room, room.game, seat));
  }

  create(member: Member, countriesToWin: unknown): void {
    this.#requireNoRoom(member);
    if (typeof countriesToWin !== 'number' || !RULES.countriesToWin.includes(countriesToWin)) {
      throw new Rejection('bad_message', `countriesToWin must be one of ${RULES.countriesToWin.join(', ')}`);
    }
    let code: string;
    do code = Array.from({ length: ROOM_CODE_LENGTH }, () => ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)]).join('');
    while (this.#byCode.has(code));
    const room: Room = { code, countriesToWin, members: [], stateVersion: 0, startedAt: 0, covered: new Set() };
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

  /** The host seats a bot in their lobby. */
  addBot(member: Member): void {
    const room = this.#hostedLobby(member);
    if (room.members.length >= MAX_SEATS) throw new Rejection('room_full', 'The room is full');
    const taken = new Set(room.members.map(({ name }) => name));
    let number = 1;
    while (taken.has(`Bot ${number}`)) number++;
    room.members.push(absent({ account: null, name: `Bot ${number}` }));
    this.#sendRoom(room);
  }

  /** The host empties a seat of their lobby other than their own: its player is told, and is in no room any more. */
  remove(member: Member, seat: unknown): void {
    const room = this.#hostedLobby(member);
    if (typeof seat !== 'number' || seat < 1 || !room.members[seat]) {
      throw new Rejection('bad_message', 'No such seat to empty');
    }
    const [removed] = room.members.splice(seat, 1);
    this.#byMember.delete(removed!);
    removed!.send({ type: 'removed' });
    this.#sendRoom(room);
  }

  start(member: Member): void {
    const room = this.#hostedLobby(member);
    const players = room.members.length;
    if (!RULES.playerCounts.includes(players)) {
      throw new Rejection('not_enough_players', `A game needs at least ${Math.min(...RULES.playerCounts)} players`);
    }
    room.startedAt = Date.now();
    this.#advance(room, this.#newGame({ players, countriesToWin: room.countriesToWin }));
    this.#playBots(room);
  }

  /** Applies `action` for the member's seat if it is one of the engine's legal actions for the current state. */
  intent(member: Member, stateVersion: unknown, action: unknown): void {
    const room = this.#roomOf(member);
    if (!room.game) throw new Rejection('illegal_action', 'The game has not started');
    if (room.halted) throw new Rejection('internal', 'This game is paused.');
    if (room.leaving) throw new Rejection('stale', 'A seat change is in progress');
    if (stateVersion !== room.stateVersion) {
      throw new Rejection('stale', `The game is at state version ${room.stateVersion}`);
    }
    if (room.deadline && Date.now() >= room.deadline.at) {
      throw new Rejection('stale', 'The action deadline has expired');
    }
    const seat = room.members.indexOf(member);
    // The engine is given its own action back, never the client's data.
    const legal = legalActions(room.game, seat).find((candidate) => isDeepStrictEqual(candidate, action));
    if (!legal) throw new Rejection('illegal_action', 'Not a legal action for this player now');
    this.#advance(room, applyAction(room.game, seat, legal));
    this.#playBots(room);
  }

  /**
   * The member's connection is gone: frees their lobby seat and starts cleanup for an empty room.
   * A game in progress keeps its room and its seats, so that its players can come back (see `resume`); the
   * other players see the member disconnected.
   */
  leave(member: Member): void {
    const room = this.#byMember.get(member);
    if (!room) return;
    this.#byMember.delete(member);
    if (!room.game) {
      room.members.splice(room.members.indexOf(member), 1);
      // The host's seat goes to the next person, never to a bot.
      const host = room.members.findIndex(isPerson);
      if (host > 0) room.members.unshift(...room.members.splice(host, 1));
    }
    if (room.game && !isOver(room.game)) this.#startGrace(room, member);
    this.#sendRoom(room);
    this.#refreshPresence(room);
  }

  /** Releases the current socket's seat permanently, without changing its display name. */
  async depart(member: Member): Promise<void> {
    const room = this.#roomOf(member);
    if (!room.game || isOver(room.game)) {
      this.leave(member);
      member.send({ type: 'left' });
      return;
    }
    if (room.leaving) throw new Rejection('leave_failed', 'A seat change is in progress');
    const seat = room.members.indexOf(member);
    const bot = absent({ account: null, name: member.name });
    const players = room.members.map(({ account, name }) => ({ account, name }));
    players[seat] = { account: bot.account, name: bot.name };

    // No game write can overtake this snapshot while the seat change is pending.
    const { promise: settled, resolve } = Promise.withResolvers<void>();
    room.leaving = { member, settled };
    this.#scheduleMove(room);
    try {
      await this.#save(room, players);
      this.#byMember.delete(member);
      this.#clearGrace(member);
      room.covered.delete(member);
      room.members[seat] = bot;
      member.send({ type: 'left' });
      this.#sendRoom(room);
    } finally {
      delete room.leaving;
      resolve();
      this.#refreshPresence(room);
    }
  }

  #hasHumans(room: Room): boolean {
    return room.members.some(member => this.#byMember.has(member));
  }

  #clearGrace(member: Member): void {
    clearTimeout(this.#grace.get(member));
    this.#grace.delete(member);
  }

  #startGrace(room: Room, member: Member): void {
    if (this.#stopped) return;
    const timer = setTimeout(() => {
      if (this.#grace.get(member) !== timer) return;
      this.#grace.delete(member);
      if (!room.game || isOver(room.game)) return;
      room.covered.add(member);
      this.#sendRoom(room);
      this.#refreshPresence(room);
    }, this.#timing.graceMs);
    this.#grace.set(member, timer);
    timer.unref();
  }

  #refreshPresence(room: Room): void {
    if (this.#stopped || room.expiring) return;
    const occupied = this.#hasHumans(room);
    if (occupied || room.leaving) {
      clearTimeout(room.abandonTimer);
      delete room.abandonTimer;
      if (room.game && occupied) this.#playBots(room);
      this.#scheduleMove(room);
      return;
    }
    this.#scheduleMove(room); // Pause play while nobody is connected.
    if (!room.game || isOver(room.game)) {
      this.#byCode.delete(room.code);
    } else if (!room.abandonTimer) {
      this.#scheduleDiscard(room, this.#timing.abandonedMs);
    }
  }

  #scheduleDiscard(room: Room, delay: number): void {
    const timer = setTimeout(() => {
      if (room.abandonTimer !== timer || this.#byCode.get(room.code) !== room) return;
      delete room.abandonTimer;
      void this.#discard(room);
    }, delay);
    room.abandonTimer = timer;
    timer.unref();
  }

  #discard(room: Room): Promise<boolean> {
    return room.discarding ??= this.#deleteExpired(room).finally(() => { delete room.discarding; });
  }

  async #deleteExpired(room: Room): Promise<boolean> {
    const retrying = room.expiring;
    room.expiring = true;
    room.members.forEach(member => this.#clearGrace(member));
    try {
      await this.#store.discard(room.code);
    } catch {
      if (!this.#stopped) {
        if (!retrying) console.warn('[atlas:rooms] Could not delete an expired room; will retry.');
        this.#scheduleDiscard(room, DISCARD_RETRY_MS);
      }
      return false;
    }
    this.#byCode.delete(room.code);
    return true;
  }

  /**
   * The room's game is now `game`, one state version later: every player receives their new state, and the room
   * is saved if the turn has passed to another player, or replaced by a summary if the game is over.
   */
  #advance(room: Room, game: GameState): void {
    const turnPassed = room.game?.turn.player !== game.turn.player;
    this.#setDeadline(room, game, room.game);
    room.game = game;
    this.#scheduleMove(room);
    room.stateVersion++;
    room.members.forEach((member, seat) => member.send(stateFor(room, game, seat)));
    if (!turnPassed && !isOver(game)) return;

    const { code, countriesToWin } = room;
    const players = room.members.map(({ account, name }) => ({ account, name }));
    if (game.phase.kind === 'over') {
      room.members.forEach(member => this.#clearGrace(member));
      const durationSeconds = Math.round((Date.now() - room.startedAt) / 1000);
      this.#store.finish(code, { players, countriesToWin, winner: game.phase.winner, durationSeconds });
    } else {
      void this.#save(room, players);
    }
  }

  #save(room: Room, players: Player[]): void | Promise<void> {
    const { code, countriesToWin, startedAt, stateVersion, game } = room;
    return this.#store.save({ code, countriesToWin, players, startedAt: new Date(startedAt), stateVersion, game: game! });
  }

  #setDeadline(room: Room, game: GameState, previous?: GameState): void {
    const { phase } = game;
    if (phase.kind === 'over') {
      delete room.deadline;
      return;
    }
    const now = Date.now();
    if (previous?.turn.player !== game.turn.player) room.turnEndsAt = now + this.#timing.turnMs;
    if (phase.kind === 'pay' || phase.kind === 'veto') {
      const before = previous?.phase;
      if (room.deadline?.kind !== 'response' || before?.kind !== phase.kind || before.player !== phase.player) {
        room.deadline = { kind: 'response', at: now + this.#timing.responseMs };
      }
    } else {
      room.deadline = { kind: 'turn', at: room.turnEndsAt! };
    }
  }

  #scheduleMove(room: Room): void {
    clearTimeout(room.moveTimer);
    delete room.moveTimer;
    const { game, deadline } = room;
    if (this.#stopped || room.leaving || !game || !deadline || game.phase.kind === 'over') return;
    if (!this.#hasHumans(room)) return;
    const timer = setTimeout(() => {
      if (room.moveTimer !== timer || this.#byCode.get(room.code) !== room || room.game !== game) return;
      this.#playBots(room, true);
    }, Math.max(0, deadline.at - Date.now()));
    room.moveTimer = timer;
    timer.unref();
  }

  /** Cancels pending clock work before the server closes its connections and store. */
  stop(): void {
    this.#stopped = true;
    for (const room of this.#byCode.values()) {
      clearTimeout(room.moveTimer);
      clearTimeout(room.abandonTimer);
      delete room.moveTimer;
      delete room.abandonTimer;
    }
    for (const member of this.#grace.keys()) this.#clearGrace(member);
  }

  /** After stop, settle in-flight deletes and give each remaining expiry one final attempt. */
  async finishExpiry(): Promise<void> {
    const expired = [...this.#byCode.values()].filter(room => room.expiring);
    const deleted = await Promise.all(expired.map(async room => {
      if (room.discarding && await room.discarding) return true;
      return this.#discard(room);
    }));
    if (deleted.includes(false)) throw Error('Could not delete expired rooms during shutdown.');
  }

  /**
   * Plays the bots in the room's seats, one action after the other, until the game waits on a person or is over.
   * A bot sees only its seat's view and legal actions. `expired` forces the first move for a timed-out human.
   */
  #playBots(room: Room, expired = false): void {
    if (this.#stopped || room.halted || room.leaving || !this.#hasHumans(room)) return;
    const movedWilds = new Set<CardId>();
    let useFallback = false;
    try {
      for (let game = room.game!; game.phase.kind !== 'over'; game = room.game!) {
        const seat = game.phase.player;
        const actor = room.members[seat]!;
        if (!expired && isPerson(actor) && !room.covered.has(actor)) return;
        // At expiry the next move must progress. Otherwise allow each wild to move once between progressing moves.
        const legal = legalActions(game, seat).filter(action =>
          action.type !== 'reassign' || (!expired && !movedWilds.has(action.card)));
        const fallback = legal.find(action => action.type === 'endTurn') ?? legal.find(action => action.type !== 'reassign');
        if (!fallback) throw Error('No progressing move');
        let action: Action = fallback;
        if (!useFallback) {
          try {
            const choice = this.#bot(viewFor(game, seat), legal);
            const allowed = legal.find(candidate => isDeepStrictEqual(candidate, choice));
            if (!allowed) throw Error('Invalid bot move');
            action = allowed;
          } catch {
            useFallback = true;
            console.warn('[atlas:rooms] Bot decision failed; using a legal fallback.');
          }
        }
        this.#advance(room, applyAction(game, seat, action));
        if (action.type === 'reassign') movedWilds.add(action.card);
        else movedWilds.clear();
        expired = false;
      }
    } catch {
      // If the engine cannot progress even with a legal fallback, stop this room, not the timer process.
      room.halted = true;
      delete room.deadline;
      this.#scheduleMove(room);
      console.warn('[atlas:rooms] Game paused because it could not progress.');
      room.members.forEach((member, seat) => {
        if (!this.#byMember.has(member)) return;
        try { member.send(stateFor(room, room.game!, seat)); }
        catch { member.send({ type: 'error', code: 'internal', message: 'This game is paused.' }); }
      });
    }
  }

  #seat(room: Room, member: Member): void {
    room.members.push(member);
    this.#byMember.set(member, room);
    this.#sendRoom(room);
  }

  /** The seat the account holds in a game in progress, if any. */
  #seatOf(account: string): { room: Room; seat: PlayerId } | undefined {
    for (const room of this.#byCode.values()) {
      if (room.expiring || !room.game || isOver(room.game)) continue;
      const seat = room.members.findIndex((held) => held.account === account);
      if (seat >= 0) return { room, seat };
    }
    return undefined;
  }

  #sendRoom(room: Room): void {
    room.members.forEach((member, you) => member.send(this.#roomFor(room, you)));
  }

  #roomFor(room: Room, you: PlayerId): ServerMessage {
    const players = room.members.map((member): RoomPlayer => ({
      name: member.name,
      bot: !isPerson(member),
      status: room.covered.has(member) ? 'bot-replaced' : !isPerson(member) || this.#byMember.has(member) ? 'connected' : 'disconnected',
    }));
    return { type: 'room', code: room.code, countriesToWin: room.countriesToWin, players, you };
  }

  #roomOf(member: Member): Room {
    const room = this.#byMember.get(member);
    if (!room) throw new Rejection('bad_message', 'Not in a room');
    return room;
  }

  /** The room of the member, who must be its host and still in the lobby. */
  #hostedLobby(member: Member): Room {
    const room = this.#roomOf(member);
    if (room.game) throw new Rejection('game_started', 'The game has already started');
    if (room.members[0] !== member) throw new Rejection('not_host', 'Only the host can do this');
    return room;
  }

  #requireNoRoom(member: Member): void {
    if (this.#byMember.has(member)) throw new Rejection('bad_message', 'Already in a room');
  }
}

function isPerson(player: Player): boolean {
  return player.account !== null;
}

function isOver(game: GameState): boolean {
  return game.phase.kind === 'over';
}

/** A player gets their own view and legal actions; the full state never leaves the server. */
function stateFor(room: Room, game: GameState, seat: PlayerId): ServerMessage {
  return {
    type: 'state',
    stateVersion: room.stateVersion,
    view: viewFor(game, seat),
    legalActions: room.halted ? [] : legalActions(game, seat),
    ...(room.halted && { paused: room.halted }),
    ...(room.deadline && { deadline: room.deadline, serverTime: Date.now() }),
  };
}
