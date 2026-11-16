// An online session, pure (no socket, no storage): what the app knows from the server's messages and what it
// sends back. The store (`store.ts`) owns the connection and keeps the token on the device.

import type { Action } from '@atlas/engine';
import { PROTOCOL_VERSION, type ClientMessage, type ErrorCode, type ServerMessage } from '@atlas/server/protocol';

export type Room = Extract<ServerMessage, { type: 'room' }>;
export type Game = Extract<ServerMessage, { type: 'state' }>;
/**
 * What a connection is opened for: a new room, a room to join, or with `resync` the game the account already
 * holds a seat in, if any.
 */
export type RoomRequest = Extract<ClientMessage, { type: 'createRoom' | 'joinRoom' | 'resync' }>;

export interface Session {
  /** The display name the other players see, sent with every hello. The player may change it between rooms. */
  name: string;
  /** The guest token the server issued; null until the first welcome. */
  token: string | null;
  /** The request the server has not answered yet. */
  request: RoomRequest | null;
  /** The last room received. The players' names and connection status by seat come from it, during the game too. */
  room: Room | null;
  /** The last state received: the table is drawn from its view and legal actions. */
  game: Game | null;
  /**
   * False until the state that follows a new connection or a resync request: that state is taken whatever its
   * version. Once true, a state is taken only if its version follows the known one.
   */
  synced: boolean;
  /**
   * Set while the connection to a room is lost and being opened again: how many attempts have failed so far.
   * The room and the game stay as they were last known until the server gives them again.
   */
  lost: number | null;
  /**
   * Why the player is not in a room: the server's code for a refused message (`unsupported_version`: the app
   * must be updated), `disconnected` when the server could not be reached, `removed` when the host removed them
   * from the lobby, `replaced` when their account took its seat from another device, `ended` when the game they
   * were coming back to is no longer there.
   */
  error: ErrorCode | 'disconnected' | 'removed' | 'replaced' | 'ended' | null;
}

/** Not connected, in no room: only what the device keeps. */
export function offline(name: string, token: string | null): Session {
  return { name, token, request: null, room: null, game: null, synced: false, lost: null, error: null };
}

/** The name a player has until they choose one. */
export function defaultName(): string {
  return `Guest ${1000 + Math.floor(Math.random() * 9000)}`;
}

/** The first message on a new connection. */
export function hello({ name, token }: Pick<Session, 'name' | 'token'>): ClientMessage {
  return token === null ? { type: 'hello', name } : { type: 'hello', token, name };
}

/**
 * The session after a message from the server, and the messages to send in answer.
 * A session that ends up with neither a room nor a request has no use for its connection any more.
 */
export function receive(session: Session, message: ServerMessage): { session: Session; send: ClientMessage[] } {
  const out = (error: Session['error']) => ({ session: { ...offline(session.name, session.token), error }, send: [] });
  switch (message.type) {
    case 'welcome': {
      // On a new connection the server may know the game at an older version than this device (a restart).
      const welcomed = { ...session, token: message.token, synced: false };
      // Back in a seat: the room and the state follow, and answer the request whatever it was.
      if (message.resumed) return { session: welcomed, send: [] };
      if (session.request?.type !== 'resync') return { session: welcomed, send: session.request ? [session.request] : [] };
      // No game to come back to: it ended while the connection was lost, or there was none.
      return out(session.game ? 'ended' : null);
    }
    case 'room':
      return { session: { ...session, request: null, room: message, lost: session.game ? session.lost : null }, send: [] };
    case 'removed':
    case 'replaced':
      return out(message.type);
    case 'state': {
      // Every state is a full view. One that neither follows the known one nor repeats it (the answer to a
      // resync) is a gap: it is not trusted, and the server is asked for the current one.
      const known = session.game?.stateVersion ?? message.stateVersion;
      const follows = message.stateVersion === known || message.stateVersion === known + 1;
      if (session.synced && !follows) return { session: { ...session, synced: false }, send: [{ type: 'resync' }] };
      return { session: { ...session, game: message, synced: true, lost: null }, send: [] };
    }
    case 'pong':
      return { session, send: [] };
    case 'error':
      // The server does not know the stored token: start again as a new guest.
      if (message.code === 'invalid_token') {
        const guest = { ...session, token: null };
        return { session: guest, send: [hello(guest)] };
      }
      // A refused request, or an app too old for this server: no room.
      if (session.request || message.code === 'unsupported_version') return out(message.code);
      return { session: { ...session, error: message.code }, send: [] };
  }
}

/**
 * The session once its connection is lost. In a room, it is to be opened again (`lost`), to come back to the
 * seat of a game in progress or to join the lobby again. A finished game keeps its final state, and a connection
 * that was not in a room yet is given up.
 */
export function disconnected(session: Session): Session {
  const { room, game, lost } = session;
  if (game?.view.phase.kind === 'over') return session;
  if (!room) return { ...offline(session.name, session.token), error: 'disconnected' };
  const request: RoomRequest = game ? { type: 'resync' } : { type: 'joinRoom', code: room.code };
  return { ...session, synced: false, request, lost: lost === null ? 0 : lost + 1 };
}

/** How long to wait before opening the connection again, in milliseconds, after `failed` attempts in a row. */
export function backoff(failed: number): number {
  return Math.min(500 * 2 ** failed, 8000);
}

/** `action` is one of `game.legalActions`. */
export function intent(game: Game, action: Action): ClientMessage {
  return { type: 'intent', stateVersion: game.stateVersion, action };
}

export function encode(message: ClientMessage): string {
  return JSON.stringify({ v: PROTOCOL_VERSION, ...message });
}

export function decode(text: string): ServerMessage {
  const message = JSON.parse(text);
  if (!message || typeof message !== 'object' || Array.isArray(message)) throw Error('Invalid message');
  // Version refusal retains its wire shape across versions.
  if (message.type === 'error' && message.code === 'unsupported_version') return message;
  if (message.v !== PROTOCOL_VERSION) return { type: 'error', code: 'unsupported_version', message: '' };
  const valid = (() => {
    switch (message.type) {
      case 'welcome': return typeof message.token === 'string' && typeof message.name === 'string' && typeof message.resumed === 'boolean';
      case 'room': return typeof message.code === 'string' && Number.isInteger(message.you) &&
        Array.isArray(message.players) && message.you >= 0 && message.you < message.players.length &&
        message.players.every((p: any) => p && typeof p.name === 'string' && typeof p.bot === 'boolean' && ['connected', 'disconnected'].includes(p.status));
      case 'state': return Number.isSafeInteger(message.stateVersion) && message.stateVersion >= 0 &&
        message.view && Array.isArray(message.view.players) && Array.isArray(message.view.hand) &&
        Array.isArray(message.view.log) && message.view.phase && typeof message.view.phase.kind === 'string' &&
        Array.isArray(message.legalActions);
      case 'error': return typeof message.code === 'string' && typeof message.message === 'string';
      case 'removed': case 'replaced': case 'pong': return true;
      default: return false;
    }
  })();
  if (!valid) throw Error('Invalid message');
  return message as ServerMessage;
}
