// The WebSocket protocol: JSON text messages, one object per message.
// Types only (plus the version number and a limit), so a client can import this file without the server's
// dependencies.

import type { Action, PlayerId, PlayerView } from '@atlas/engine';

/**
 * Bumped on every incompatible change. Every message, in both directions, carries it as `v`.
 * A client message with another `v` is refused with the error `unsupported_version`, which tells an outdated app
 * to update: that error keeps its shape in every version.
 */
// Version 2 requires welcome.resumed and per-seat status, and supports resync.
// A v2 client cannot safely recover against v1 (which rejects resync).
export const PROTOCOL_VERSION = 2;

/**
 * A client sends something, a `ping` if nothing else, at least this often. The server closes a connection it has
 * not heard from for twice as long; a client that has heard nothing for as long can take its connection for lost.
 */
export const HEARTBEAT_MS = 5000;

/** A display name is trimmed and cut to this many characters. */
export const MAX_NAME_LENGTH = 20;

export type Versioned<Message> = Message & { v: number };

export interface Deadline {
  kind: 'turn' | 'response';
  /** Milliseconds since the epoch on the server. */
  at: number;
}

export type ClientMessage =
  /**
   * Always first. Without a token a guest account is created. `name` is the display name to play under from now
   * on, kept with the account; without it the account keeps the name it has.
   */
  | { type: 'hello'; token?: string; name?: string }
  /** Answered with `pong`, at any time. Keeps the connection open (see `HEARTBEAT_MS`). */
  | { type: 'ping' }
  | { type: 'createRoom'; countriesToWin: number }
  | { type: 'joinRoom'; code: string }
  /** Host only, in the lobby: a bot takes the next seat. */
  | { type: 'addBot' }
  /** Host only, in the lobby: empties seat `seat`, a player's or a bot's, never the host's own. */
  | { type: 'removePlayer'; seat: PlayerId }
  /** Host only. */
  | { type: 'startGame' }
  /** `action` must be one of the legal actions received with the state numbered `stateVersion`. */
  | { type: 'intent'; stateVersion: number; action: Action }
  /**
   * In a room: asks for the `room` and, once the game has started, the current `state` again. For a client that
   * received a `state` whose version does not follow the one it had.
   */
  | { type: 'resync' };

export type ServerMessage =
  /**
   * Answer to `hello`. The client keeps `token` and sends it in later hellos. `resumed` tells whether the account
   * holds a seat in a game in progress: the client is then put back in it, and a `room` and a `state` follow.
   */
  | { type: 'welcome'; token: string; name: string; resumed: boolean }
  /**
   * The room, sent to everyone in it whenever it changes: in the lobby, and during the game when a player's
   * connection is lost or comes back. `players` is in seat order; seat 0 is the host.
   */
  | { type: 'room'; code: string; countriesToWin: number; players: RoomPlayer[]; you: PlayerId }
  /** The host has removed the receiver from the lobby: they are in no room any more. */
  | { type: 'removed' }
  /**
   * Another connection of the receiver's account has taken its seat (the same player, connected again): this
   * connection is in no room any more, and the server closes it.
   */
  | { type: 'replaced' }
  /** Answer to `ping`. */
  | { type: 'pong' }
  /**
   * The game as the receiving player may see it, sent to every player when the game starts and after every
   * applied intent. `stateVersion` starts at 1 and grows by 1 each time. After a server restart the game is back
   * at the start of the turn in progress, so the `state` that follows a `welcome` may have a lower `stateVersion`
   * than the last one received: it replaces whatever the client knew.
   */
  | { type: 'state'; stateVersion: number; view: PlayerView; legalActions: Action[]; deadline?: Deadline }
  /** The client's last message was refused and changed nothing. */
  | { type: 'error'; code: ErrorCode; message: string };

export interface RoomPlayer {
  name: string;
  bot: boolean;
  /** Whether the player's connection is there. A bot is always `connected`; so is everyone in a lobby. */
  status: 'connected' | 'disconnected';
}

export type ErrorCode =
  | 'bad_message'
  | 'unsupported_version'
  | 'invalid_token'
  | 'room_not_found'
  | 'room_full'
  | 'game_started'
  | 'not_host'
  | 'not_enough_players'
  | 'stale'
  | 'illegal_action'
  | 'internal';
