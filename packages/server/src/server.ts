import { randomInt } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import websocket from '@fastify/websocket';
import { createBot, type Bot, type Difficulty } from '@atlas/bots';
import { createGame, type GameOptions, type GameState } from '@atlas/engine';
import Fastify from 'fastify';
import type { WebSocket } from 'ws';
import {
  createAccount,
  findAccount,
  finishGame,
  loadSnapshots,
  openDatabase,
  renameAccount,
  saveSnapshot,
  type Sql,
} from './db.ts';
import { HEARTBEAT_MS, MAX_NAME_LENGTH, PROTOCOL_VERSION, type ServerMessage } from './protocol.ts';
import { Rejection, Rooms, type Member } from './rooms.ts';

export interface ServerOptions {
  databaseUrl: string;
  /** 0 picks a free port. */
  port: number;
  host: string;
  /** How a room's game is created. Defaults to a randomly seeded game; scripted games pass their own. */
  newGame?: (options: GameOptions) => GameState;
  /** Who plays the bot seats. Defaults to bots of level `BOT_LEVEL`, seeded at random; scripted games pass their own. */
  bot?: Bot;
}

export interface Server {
  port: number;
  close(): Promise<void>;
}

/** The level of the bots a host seats: the middle one, as a solo game starts with. */
const BOT_LEVEL: Difficulty = 'normal';
const MAX_MESSAGE_BYTES = 16 * 1024;

/**
 * Starts the game server: one WebSocket endpoint, `/ws`, speaking the protocol of `protocol.ts`.
 * The games that were in progress when the previous server stopped are restored from their last snapshot.
 */
export async function startServer(options: ServerOptions): Promise<Server> {
  const { port, host } = options;
  const sql = await openDatabase(options.databaseUrl);

  // Rooms are saved in the background, one write at a time, so that the writes reach the database in order.
  let saved: Promise<unknown> = Promise.resolve();
  const write = (query: () => Promise<void>): void => {
    saved = saved.then(query).catch(console.error);
  };
  const rooms = new Rooms(
    options.newGame ?? ((gameOptions) => createGame(gameOptions, randomInt(2 ** 32))),
    // A bot keeps nothing from one decision to the next, so one is made for each, with its own seed.
    options.bot ?? ((view, legal) => createBot(BOT_LEVEL, randomInt(2 ** 32))(view, legal)),
    {
      save: (snapshot) => write(() => saveSnapshot(sql, snapshot)),
      finish: (code, summary) => write(() => finishGame(sql, code, summary)),
    },
    await loadSnapshots(sql),
  );

  const app = Fastify();
  await app.register(websocket, { options: { maxPayload: MAX_MESSAGE_BYTES } });
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
      await app.close();
      await saved;
      await sql.end();
    },
  };
}

/** One client connection. Its messages are handled strictly one after the other. `alive` is called for each. */
function serve(socket: WebSocket, sql: Sql, rooms: Rooms, alive: () => void): void {
  let member: Member | undefined;
  let queue = Promise.resolve();
  alive();

  const send = (message: ServerMessage): void => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ v: PROTOCOL_VERSION, ...message }));
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
    member = { account: account.id, name: account.name, send, close: () => socket.close() };
    send({ type: 'welcome', token: account.token, name: account.name, resumed: rooms.playing(account.id) });
    rooms.resume(member);
  };

  const handle = async (text: string): Promise<void> => {
    const message = parse(text);
    if (message.type === 'hello') return hello(message.token, message.name);
    if (message.type === 'ping') return send({ type: 'pong' });
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
      case 'intent':
        return rooms.intent(member, message.stateVersion, message.action);
      case 'resync':
        return rooms.resync(member);
      default:
        throw new Rejection('bad_message', 'Unknown message type');
    }
  };

  socket.on('message', (data) => {
    alive();
    queue = queue
      .then(() => handle(data.toString()))
      .catch((error: unknown) => {
        if (error instanceof Rejection) return send({ type: 'error', code: error.code, message: error.message });
        console.error(error);
        send({ type: 'error', code: 'internal', message: 'Internal error' });
      });
  });
  socket.on('close', () => {
    queue = queue.then(() => {
      if (member) rooms.leave(member);
    });
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
