import { randomInt } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import websocket from '@fastify/websocket';
import { createBot, type Bot, type Difficulty } from '@atlas/bots';
import { createGame, type GameOptions, type GameState } from '@atlas/engine';
import Fastify from 'fastify';
import type { WebSocket } from 'ws';
import type { ProviderAdapters } from './account/flows.ts';
import { accountRoutes } from './account/routes.ts';
import {
  createAccount,
  discardSnapshot,
  findAccount,
  finishGame,
  identityStore,
  loadSnapshots,
  openDatabase,
  renameAccount,
  saveSnapshot,
  type Sql,
} from './db.ts';
import { HEARTBEAT_MS, MAX_NAME_LENGTH, PROTOCOL_VERSION, type ServerMessage } from './protocol.ts';
import { Rejection, Rooms, type Member, type RoomStore, type RoomTiming } from './rooms.ts';

export interface ServerOptions {
  databaseUrl: string;
  /** 0 picks a free port. */
  port: number;
  host: string;
  /** How a room's game is created. Defaults to a randomly seeded game; scripted games pass their own. */
  newGame?: (options: GameOptions) => GameState;
  /** Who plays the bot seats. Defaults to bots of level `BOT_LEVEL`, seeded at random; scripted games pass their own. */
  bot?: Bot;
  timing?: RoomTiming;
  providers?: ProviderAdapters;
}

export interface Server {
  port: number;
  close(): Promise<void>;
}

/** The level of the bots a host seats: the middle one, as a solo game starts with. */
const BOT_LEVEL: Difficulty = 'normal';
const MAX_MESSAGE_BYTES = 16 * 1024;

/** Serializes snapshot writes, finalization and deletion on the same queue. */
export function roomWrites(sql: Sql): RoomStore & { drain(): Promise<void> } {
  let queued = Promise.resolve();
  const write = (query: () => Promise<void>, reportFailure = true): Promise<void> => {
    const result = queued.then(query);
    queued = result.catch(() => {
      if (reportFailure) console.warn('[atlas:rooms] Room write failed.');
    });
    return result;
  };
  return {
    save: (snapshot) => write(() => saveSnapshot(sql, snapshot)),
    finish: (code, summary) => write(() => finishGame(sql, code, summary)),
    discard: (code) => write(() => discardSnapshot(sql, code), false),
    drain: () => queued,
  };
}

/**
 * Starts the game server: one WebSocket endpoint, `/ws`, speaking the protocol of `protocol.ts`.
 * The games that were in progress when the previous server stopped are restored from their last snapshot.
 */
export async function startServer(options: ServerOptions): Promise<Server> {
  const { port, host } = options;
  const sql = await openDatabase(options.databaseUrl);

  const store = roomWrites(sql);
  const rooms = new Rooms(
    options.newGame ?? ((gameOptions) => createGame(gameOptions, randomInt(2 ** 32))),
    // A bot keeps nothing from one decision to the next, so one is made for each, with its own seed.
    options.bot ?? ((view, legal) => createBot(BOT_LEVEL, randomInt(2 ** 32))(view, legal)),
    store,
    await loadSnapshots(sql),
    options.timing,
  );

  const app = Fastify();
  await app.register(websocket, { options: { maxPayload: MAX_MESSAGE_BYTES } });
  await app.register(async (account) => {
    account.setErrorHandler((error, _req, reply) => {
      const clientError = typeof error === 'object' && error && 'statusCode' in error &&
        typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500;
      reply.header('cache-control', 'no-store').code(clientError ? 400 : 503).send({ error: 'account_unavailable' });
    });
    accountRoutes(account, options.providers ?? {}, identityStore(sql));
  });
  // The connections heard from since the last sweep. One that is not among them at the next sweep is taken for
  // dead and closed, which is how the server learns of a connection lost without a goodbye.
  const heard = new Set<WebSocket>();
  app.get('/ws', { websocket: true }, (socket) => serve(socket, sql, rooms, () => heard.add(socket)));
  const sweep = setInterval(() => {
    for (const socket of app.websocketServer.clients) if (!heard.has(socket)) socket.terminate();
    heard.clear();
  }, 2 * HEARTBEAT_MS);
  await app.listen({ port, host });
  return {
    port: (app.server.address() as AddressInfo).port,
    async close() {
      clearInterval(sweep);
      await closeRoomResources(rooms, store, () => app.close(), () => sql.end());
    },
  };
}

export async function closeRoomResources(
  rooms: Rooms,
  store: ReturnType<typeof roomWrites>,
  closeConnections: () => Promise<void>,
  closeStore: () => Promise<void>,
): Promise<void> {
  rooms.stop();
  try {
    await closeConnections();
  } finally {
    try {
      await rooms.finishExpiry();
    } finally {
      await store.drain();
      await closeStore();
    }
  }
}

/** One client connection. Commands run in order; transport heartbeats are independent. */
export function serve(socket: WebSocket, sql: Sql, rooms: Rooms, alive: () => void): void {
  let member: Member | undefined;
  let queue = Promise.resolve();
  alive();

  let warned = false;
  const warn = () => {
    if (warned) return;
    warned = true;
    console.warn('[atlas:socket] Connection operation failed.');
  };
  const close = () => { try { socket.close(); } catch { warn(); } };
  const send = (message: ServerMessage): void => {
    try {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ v: PROTOCOL_VERSION, ...message }));
    } catch { warn(); close(); }
  };

  const hello = async (token: unknown, name: unknown): Promise<void> => {
    if (member) throw new Rejection('bad_message', 'Already said hello');
    const wanted = typeof name === 'string' ? name.trim().slice(0, MAX_NAME_LENGTH) : '';
    let account: { id: string; token: string; name: string };
    if (typeof token === 'string') {
      const known = await findAccount(sql, token);
      if (!known) throw new Rejection('invalid_token', 'Unknown token');
      if (wanted && wanted !== known.name) await renameAccount(sql, known.id, wanted);
      account = { token, id: known.id, name: wanted || known.name };
    } else {
      const guest = wanted || 'Guest';
      account = { name: guest, ...(await createAccount(sql, guest)) };
    }
    for (let pending = rooms.pendingDeparture(account.id); pending; pending = rooms.pendingDeparture(account.id)) {
      await pending;
      if (socket.readyState !== socket.OPEN) return;
    }
    if (socket.readyState !== socket.OPEN) return;
    member = { account: account.id, name: account.name, send, close };
    send({ type: 'welcome', token: account.token, name: account.name, resumed: rooms.playing(account.id) });
    rooms.resume(member);
  };

  const handle = async (message: Record<string, unknown>): Promise<void> => {
    if (message.type === 'hello') return hello(message.token, message.name);
    if (!member) throw new Rejection('bad_message', 'Say hello first');
    switch (message.type) {
      case 'createRoom':
        return rooms.create(member, message.countriesToWin);
      case 'joinRoom':
        return rooms.join(member, message.code);
      case 'addBot':
        return rooms.addBot(member);
      case 'removePlayer':
        return rooms.remove(member, message.seat);
      case 'startGame':
        return rooms.start(member);
      case 'leaveRoom':
        try { await rooms.depart(member); }
        catch { send({ type: 'error', code: 'leave_failed', message: 'Could not leave the room. Try again.' }); }
        return;
      case 'intent':
        return rooms.intent(member, message.stateVersion, message.action);
      case 'resync':
        return rooms.resync(member);
      default:
        throw new Rejection('bad_message', 'Unknown message type');
    }
  };

  const report = (error: unknown): void => {
    if (error instanceof Rejection) return send({ type: 'error', code: error.code, message: error.message });
    warn();
    send({ type: 'error', code: 'internal', message: 'Internal error' });
  };
  socket.on('message', (data) => {
    alive();
    let message: Record<string, unknown>;
    try { message = parse(data.toString()); }
    catch (error) {
      queue = queue.then(() => report(error));
      return;
    }
    if (message.type === 'ping') return send({ type: 'pong' });
    queue = queue.then(() => handle(message)).catch(report);
  });
  socket.on('close', () => {
    queue = queue.then(() => {
      if (member) rooms.leave(member);
    }).catch(() => { warn(); });
  });
}

function parse(text: string): Record<string, unknown> {
  let message: unknown;
  try {
    message = JSON.parse(text);
  } catch {
    throw new Rejection('bad_message', 'Not JSON');
  }
  if (typeof message !== 'object' || message === null) throw new Rejection('bad_message', 'Not a JSON object');
  if ((message as Record<string, unknown>).v !== PROTOCOL_VERSION) {
    throw new Rejection('unsupported_version', `This server speaks protocol version ${PROTOCOL_VERSION}`);
  }
  return message as Record<string, unknown>;
}
