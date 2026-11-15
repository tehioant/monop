// The WebSocket protocol: JSON text messages, one object per message.
// Types only (plus the version number and a limit), so a client can import this file without the server's
// dependencies.

import type { Action, PlayerId, PlayerView } from '@atlas/engine';

/** Bumped on every incompatible change. Every message, in both directions, carries it as `v`. */
export const PROTOCOL_VERSION = 1;

/** A display name is trimmed and cut to this many characters. */
export const MAX_NAME_LENGTH = 20;

export type Versioned<Message> = Message & { v: number };

export type ClientMessage =
  /**
   * Always first. Without a token a guest account is created. `name` is the display name to play under from now
   * on, kept with the account; without it the account keeps the name it has.
   */
  | { type: 'hello'; token?: string; name?: string }
  | { type: 'createRoom'; countriesToWin: number }
  | { type: 'joinRoom'; code: string }
  /** Host only, in the lobby: a bot takes the next seat. */
  | { type: 'addBot' }
  /** Host only, in the lobby: empties seat `seat`, a player's or a bot's, never the host's own. */
  | { type: 'removePlayer'; seat: PlayerId }
  /** Host only. */
  | { type: 'startGame' }
  /** `action` must be one of the legal actions received with the state numbered `stateVersion`. */
  | { type: 'intent'; stateVersion: number; action: Action };

export type ServerMessage =
  /**
   * Answer to `hello`. The client keeps `token` and sends it in later hellos. If the account holds a seat in a
   * game in progress and nobody is connected to that seat, the client is put back in it: a `room` and a `state`
   * follow.
   */
  | { type: 'welcome'; token: string; name: string }
  /** The lobby, sent to everyone in it whenever it changes. `players` is in seat order; seat 0 is the host. */
  | { type: 'room'; code: string; countriesToWin: number; players: { name: string; bot: boolean }[]; you: PlayerId }
  /** The host has removed the receiver from the lobby: they are in no room any more. */
  | { type: 'removed' }
  /**
   * The game as the receiving player may see it, sent to every player when the game starts and after every
   * applied intent. `stateVersion` starts at 1 and grows by 1 each time. After a server restart the game is back
   * at the start of the turn in progress, so the `state` that follows a `welcome` may have a lower `stateVersion`
   * than the last one received: it replaces whatever the client knew.
   */
  | { type: 'state'; stateVersion: number; view: PlayerView; legalActions: Action[] }
  /** The client's last message was refused and changed nothing. */
  | { type: 'error'; code: ErrorCode; message: string };

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
