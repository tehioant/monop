// The online session in progress, shared with the online screen. It keeps the guest token and the display name
// on the device; the connection to the game server is in `connection.ts`, what the messages mean in `session.ts`.

import type { Action } from '@atlas/engine';
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';
import { serverUrl } from '../account/config.ts';
import type { RestoredAccount } from '../account/client.ts';
import { readLanguage } from '../i18n/deviceLanguage.ts';
import { translate } from '../i18n/strings.ts';
import { useSettings } from '../settings/store.ts';
import { connection, type Socket } from './connection.ts';
import { defaultName, intent, offline, type RoomRequest, type Session } from './session.ts';

/** Where the guest token is kept, so that the next launch plays under the same account. */
const TOKEN_KEY = 'atlas.token';
/** Where the display name is kept, once the player has gone online under it. */
const NAME_KEY = 'atlas.name';

interface OnlineStore {
  session: Session;
  accountToken: () => string | null;
  clearAccount: (expected: string) => boolean;
  replaceAccount: (previous: string | null, account: RestoredAccount) => boolean;
  /** The display name to go online under next. A blank one is replaced by a generated name. */
  setName: (name: string) => void;
  /** Goes back to the game in progress this device's account holds a seat in, if there is one. */
  resume: () => void;
  createRoom: (countriesToWin: number) => void;
  joinRoom: (code: string, options?: { fromInvite: boolean }) => void;
  /** Host only, in the lobby. */
  addBot: () => void;
  /** Host only, in the lobby: empties the seat of a player or a bot. */
  removePlayer: (seat: number) => void;
  /** Host only. */
  startGame: () => void;
  /** `action` is one of the legal actions of the current state. */
  play: (action: Action) => void;
  /** Deliberately releases the current seat; waits for the server before leaving the screen. */
  leaveRoom: () => void;
  /** Closes the connection on unmount without relinquishing the seat. */
  leave: () => void;
}

export const useOnline = create<OnlineStore>((set, get) => {
  let warned = false;
  const warn = () => {
    if (warned) return;
    warned = true;
    console.warn('[atlas:online] Device storage unavailable; session remains in memory.');
  };
  const read = (key: string) => { try { return SecureStore.getItem(key); } catch { warn(); return null; } };
  const write = (key: string, value: string) => { try { SecureStore.setItem(key, value); } catch { warn(); } };
  let forgetStoredToken = false;
  const accountToken = () => get().session.token ?? (forgetStoredToken ? null : read(TOKEN_KEY) || null);
  const server = connection(
    () => new WebSocket(serverUrl) as Socket,
    () => get().session,
    (session) => {
      const { token } = get().session;
      if (session.token !== null && session.token !== token) write(TOKEN_KEY, session.token);
      set({ session });
    },
  );

  /** Opens a new connection, which says hello and sends `request` once welcomed. */
  const connect = (request: RoomRequest) => {
    let name = get().session.name.trim();
    if (!name) {
      const choice = useSettings.getState().settings.language;
      name = defaultName(translate(readLanguage(choice)));
    }
    write(NAME_KEY, name);
    const token = accountToken();
    set({ session: { ...offline(name, token), request } });
    server.open();
  };

  return {
    session: offline(read(NAME_KEY) ?? '', null),
    accountToken,
    clearAccount: (expected) => {
      if (accountToken() !== expected) return false;
      server.close();
      forgetStoredToken = true;
      set({ session: offline('', null) });
      try { SecureStore.setItem(TOKEN_KEY, ''); SecureStore.setItem(NAME_KEY, ''); }
      catch { warn(); return false; }
      return true;
    },
    replaceAccount: (previous, account) => {
      const { request, room } = get().session;
      if (request || room || accountToken() !== previous) return false;
      try { SecureStore.setItem(TOKEN_KEY, account.token); } catch { warn(); return false; }
      server.close();
      write(NAME_KEY, account.name);
      set({ session: offline(account.name, account.token) });
      return true;
    },
    setName: (name) => set({ session: { ...get().session, name } }),
    resume: () => {
      // Only an account the server has already issued can hold a seat.
      if (accountToken()) connect({ type: 'resync' });
    },
    createRoom: (countriesToWin) => connect({ type: 'createRoom', countriesToWin }),
    joinRoom: (code, options) => {
      const session = get().session;
      const { room, game, request, lost, leaving, left } = session;
      if (room || game || lost !== null || leaving || left) return;
      const join: RoomRequest = { type: 'joinRoom', code };
      if (!request) connect(join);
      else if (options?.fromInvite && request.type === 'resync') {
        // Use the hello already in flight. Welcome only sends the join if it did not recover a seat.
        set({ session: { ...session, request: join } });
      }
    },
    addBot: () => server.send({ type: 'addBot' }),
    removePlayer: (seat) => server.send({ type: 'removePlayer', seat }),
    startGame: () => server.send({ type: 'startGame' }),
    play: (action) => {
      const { game, synced, lost, leaving } = get().session;
      if (game && synced && lost === null && !leaving) server.send(intent(game, action));
    },
    leaveRoom: () => {
      const { session } = get();
      if (!session.room || session.lost !== null || session.leaving || (session.game && !session.synced)) return;
      set({ session: { ...session, error: null, leaving: true } });
      server.send({ type: 'leaveRoom' });
    },
    leave: () => {
      server.close();
      const { name, token } = get().session;
      set({ session: offline(name, token) });
    },
  };
});
