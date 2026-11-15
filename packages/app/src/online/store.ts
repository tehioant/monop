// The online session in progress, shared with the online screen. It owns the connection to the game server
// and keeps the guest token and the display name on the device; what the messages mean is in `session.ts`.

import type { Action } from '@atlas/engine';
import type { ClientMessage } from '@atlas/server/protocol';
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';
import {
  decode,
  defaultName,
  disconnected,
  encode,
  hello,
  intent,
  offline,
  receive,
  type RoomRequest,
  type Session,
} from './session.ts';

/**
 * The game server's WebSocket endpoint. Set EXPO_PUBLIC_SERVER_URL when starting or building the app;
 * without it the app talks to a server started on this machine (`npm start -w @atlas/server`).
 */
const SERVER_URL = process.env.EXPO_PUBLIC_SERVER_URL ?? 'ws://127.0.0.1:3000/ws';

/** Where the guest token is kept, so that the next launch plays under the same account. */
const TOKEN_KEY = 'atlas.token';
/** Where the display name is kept, once the player has gone online under it. */
const NAME_KEY = 'atlas.name';

interface OnlineStore {
  session: Session;
  /** The display name to go online under next. A blank one is replaced by a generated name. */
  setName: (name: string) => void;
  createRoom: (countriesToWin: number) => void;
  joinRoom: (code: string) => void;
  /** Host only, in the lobby. */
  addBot: () => void;
  /** Host only, in the lobby: empties the seat of a player or a bot. */
  removePlayer: (seat: number) => void;
  /** Host only. */
  startGame: () => void;
  /** `action` is one of the legal actions of the current state. */
  play: (action: Action) => void;
  /** Closes the connection and forgets the room and its game. */
  leave: () => void;
}

export const useOnline = create<OnlineStore>((set, get) => {
  let socket: WebSocket | null = null;
  const send = (message: ClientMessage) => socket?.send(encode(message));

  /** Opens a new connection, says hello, and sends `request` once welcomed. */
  const connect = (request: RoomRequest) => {
    get().leave();
    const name = get().session.name.trim() || defaultName();
    SecureStore.setItem(NAME_KEY, name);
    const token = get().session.token ?? SecureStore.getItem(TOKEN_KEY);
    set({ session: { ...offline(name, token), request } });

    const opened = new WebSocket(SERVER_URL);
    socket = opened;
    opened.onopen = () => send(hello(get().session));
    opened.onmessage = (event) => {
      if (opened !== socket) return;
      const { token: known } = get().session;
      const { session, send: answers } = receive(get().session, decode(String(event.data)));
      if (session.token !== null && session.token !== known) SecureStore.setItem(TOKEN_KEY, session.token);
      set({ session });
      answers.forEach(send);
    };
    // Also how a connection that could not be opened ends.
    opened.onclose = () => {
      if (opened !== socket) return;
      socket = null;
      set({ session: disconnected(get().session) });
    };
  };

  return {
    session: offline(SecureStore.getItem(NAME_KEY) ?? defaultName(), null),
    setName: (name) => set({ session: { ...get().session, name } }),
    createRoom: (countriesToWin) => connect({ type: 'createRoom', countriesToWin }),
    joinRoom: (code) => connect({ type: 'joinRoom', code }),
    addBot: () => send({ type: 'addBot' }),
    removePlayer: (seat) => send({ type: 'removePlayer', seat }),
    startGame: () => send({ type: 'startGame' }),
    play: (action) => {
      const { game } = get().session;
      if (game) send(intent(game, action));
    },
    leave: () => {
      const open = socket;
      socket = null;
      open?.close();
      const { name, token } = get().session;
      set({ session: offline(name, token) });
    },
  };
});
