// An online session, pure (no socket, no storage): what the app knows from the server's messages and what it
// sends back. The store (`store.ts`) owns the connection and keeps the token on the device.

import type { Action } from '@atlas/engine';
import { PROTOCOL_VERSION, type ClientMessage, type ErrorCode, type ServerMessage } from '@atlas/server/protocol';

export type Room = Extract<ServerMessage, { type: 'room' }>;
export type Game = Extract<ServerMessage, { type: 'state' }>;
/** What a player goes online for. */
export type Request = Extract<ClientMessage, { type: 'createRoom' | 'joinRoom' }>;

export interface Session {
  /** The guest token the server issued; null until the first welcome. */
  token: string | null;
  /** The request the server has not answered yet. */
  request: Request | null;
  /** The last lobby received. The players' names by seat come from it, during the game too. */
  room: Room | null;
  /** The last state received: the table is drawn from its view and legal actions. */
  game: Game | null;
  /** Why the last message was refused (the server's code), or `disconnected` when the connection was lost. */
  error: ErrorCode | 'disconnected' | null;
}

/** Not connected, in no room. */
export function offline(token: string | null): Session {
  return { token, request: null, room: null, game: null, error: null };
}

/** The first message on a new connection. */
export function hello(token: string | null): ClientMessage {
  return token === null ? { type: 'hello' } : { type: 'hello', token };
}

/** The session after a message from the server, and the messages to send in answer. */
export function receive(session: Session, message: ServerMessage): { session: Session; send: ClientMessage[] } {
  switch (message.type) {
    case 'welcome':
      return { session: { ...session, token: message.token }, send: session.request ? [session.request] : [] };
    case 'room':
      return { session: { ...session, request: null, room: message }, send: [] };
    case 'state':
      // Always a full view, and it replaces the previous one even with a lower version (a restarted server).
      return { session: { ...session, game: message }, send: [] };
    case 'error':
      // The server does not know the stored token: start again as a new guest.
      if (message.code === 'invalid_token') return { session: { ...session, token: null }, send: [hello(null)] };
      return { session: { ...session, request: null, error: message.code }, send: [] };
  }
}

/** The session once its connection is lost: back to no room, except that a finished game keeps its final state. */
export function disconnected(session: Session): Session {
  if (session.game?.view.phase.kind === 'over') return session;
  return { ...offline(session.token), error: 'disconnected' };
}

/** `action` is one of `game.legalActions`. */
export function intent(game: Game, action: Action): ClientMessage {
  return { type: 'intent', stateVersion: game.stateVersion, action };
}

export function encode(message: ClientMessage): string {
  return JSON.stringify({ v: PROTOCOL_VERSION, ...message });
}

export function decode(text: string): ServerMessage {
  return JSON.parse(text) as ServerMessage;
}
