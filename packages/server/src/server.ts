import { randomInt } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import websocket from '@fastify/websocket';
import { createGame, type GameOptions, type GameState } from '@atlas/engine';
import Fastify from 'fastify';
import type { WebSocket } from 'ws';
import { createAccount, findAccountName, openDatabase, type Sql } from './db.ts';
import { PROTOCOL_VERSION, type ServerMessage } from './protocol.ts';
import { Rejection, Rooms, type Member } from './rooms.ts';

export interface ServerOptions {
  databaseUrl: string;
  /** 0 picks a free port. */
  port: number;
  host: string;
  /** How a room's game is created. Defaults to a randomly seeded game; scripted games pass their own. */
  newGame?: (options: GameOptions) => GameState;
}

export interface Server {
  port: number;
  close(): Promise<void>;
}

const MAX_NAME_LENGTH = 20;
const MAX_MESSAGE_BYTES = 16 * 1024;

/** Starts the game server: one WebSocket endpoint, `/ws`, speaking the protocol of `protocol.ts`. */
export async function startServer(options: ServerOptions): Promise<Server> {
  const { port, host } = options;
  const sql = await openDatabase(options.databaseUrl);
  const rooms = new Rooms(options.newGame ?? ((gameOptions) => createGame(gameOptions, randomInt(2 ** 32))));

  const app = Fastify();
  app.addHook('onClose', () => sql.end());
  await app.register(websocket, { options: { maxPayload: MAX_MESSAGE_BYTES } });
  app.get('/ws', { websocket: true }, (socket) => serve(socket, sql, rooms));
  await app.listen({ port, host });
  return { port: (app.server.address() as AddressInfo).port, close: () => app.close() };
}

/** One client connection. Its messages are handled strictly one after the other. */
function serve(socket: WebSocket, sql: Sql, rooms: Rooms): void {
  let member: Member | undefined;
  let queue = Promise.resolve();

  const send = (message: ServerMessage): void => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ v: PROTOCOL_VERSION, ...message }));
  };

  const hello = async (token: unknown, name: unknown): Promise<void> => {
    if (member) throw new Rejection('bad_message', 'Already said hello');
    let account: { token: string; name: string };
    if (typeof token === 'string') {
      const known = await findAccountName(sql, token);
      if (known === undefined) throw new Rejection('invalid_token', 'Unknown token');
      account = { token, name: known };
    } else {
      const guest = typeof name === 'string' && name.trim() ? name.trim().slice(0, MAX_NAME_LENGTH) : 'Guest';
      account = { token: await createAccount(sql, guest), name: guest };
    }
    member = { name: account.name, send };
    send({ type: 'welcome', ...account });
  };

  const handle = async (text: string): Promise<void> => {
    const message = parse(text);
    if (message.type === 'hello') return hello(message.token, message.name);
    if (!member) throw new Rejection('bad_message', 'Say hello first');
    switch (message.type) {
      case 'createRoom':
        return rooms.create(member, message.countriesToWin);
      case 'joinRoom':
        return rooms.join(member, message.code);
      case 'startGame':
        return rooms.start(member);
      case 'intent':
        return rooms.intent(member, message.stateVersion, message.action);
      default:
        throw new Rejection('bad_message', 'Unknown message type');
    }
  };

  socket.on('message', (data) => {
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
