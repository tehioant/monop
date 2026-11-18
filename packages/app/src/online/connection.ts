// The connection of an online session: it opens the socket, says hello, keeps the connection alive, and opens
// another one when it is lost. What the messages mean is in `session.ts`; `store.ts` plugs this into the app.

import { HEARTBEAT_MS, type ClientMessage, type ServerMessage } from '@atlas/server/protocol';
import { backoff, decode, disconnected, encode, hello, receive, type Session } from './session.ts';

/** What is used of a WebSocket. */
export interface Socket {
  readyState: number;
  send(text: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
}

const OPEN = 1;
/** Heartbeats in a row the server may leave unanswered before the connection is taken for lost. */
const MISSED_BEATS = 2;

export interface Connection {
  /** Opens a new connection for the session as it is: it says hello, then sends the session's request. */
  open(): void;
  /** Does nothing while the connection is not open. */
  send(message: ClientMessage): void;
  /** Closes the connection, if any, and leaves the session as it is. */
  close(): void;
}

/**
 * `socket` opens a WebSocket to the game server; `get` and `set` read and replace the session, which this
 * connection moves on with every message and every loss.
 */
export function connection(socket: () => Socket, get: () => Session, set: (session: Session, packet?: ServerMessage) => void): Connection {
  let current: Socket | null = null;
  let beat: ReturnType<typeof setInterval> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const warned = new Set<string>();
  const warn = (kind: string) => {
    if (warned.has(kind)) return;
    warned.add(kind);
    console.warn(`[atlas:online] ${kind}; connection unavailable.`);
  };
  const send = (message: ClientMessage) => {
    const session = get();
    if (message.type === 'intent' && (!session.synced || session.lost !== null)) return;
    try {
      if (current?.readyState === OPEN) current.send(encode(message));
    } catch { warn('Send failed'); lost(); }
  };

  const close = () => {
    clearInterval(beat);
    clearTimeout(retry);
    const closed = current;
    current = null;
    try { closed?.close(); } catch { warn('Close failed'); }
  };

  /** The connection is gone: the session says whether another one is to be opened. */
  const lost = () => {
    close();
    const session = disconnected(get());
    set(session);
    if (session.lost !== null) retry = setTimeout(open, backoff(session.lost));
  };

  const open = () => {
    close();
    let opened: Socket;
    try { opened = socket(); } catch { warn('Open failed'); lost(); return; }
    current = opened;
    /** Heartbeats since the server was last heard from. */
    let missed = 0;
    opened.onopen = () => opened === current && send(hello(get()));
    opened.onmessage = (event) => {
      if (opened !== current) return;
      missed = 0;
      let packet, result;
      try {
        packet = decode(String(event.data));
        result = receive(get(), packet);
      }
      catch { warn('Invalid message'); lost(); return; }
      const { session, send: answers } = result;
      set(session, packet);
      answers.forEach(send);
      if (!session.room && !session.request) close();
    };
    // Also how a connection that could not be opened ends.
    opened.onclose = () => opened === current && lost();
    // A connection can die without a close: one that stays silent, or never opens, is given up as well.
    beat = setInterval(() => {
      if (missed === MISSED_BEATS) return lost();
      missed++;
      send({ type: 'ping' });
    }, HEARTBEAT_MS);
  };

  return { open, send, close };
}
