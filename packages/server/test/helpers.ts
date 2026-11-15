// Shared test helpers. Tests drive the server through its WebSocket protocol only, with scripted clients.

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  CARDS,
  COUNTRIES,
  createGame,
  RULES,
  type Action,
  type CardId,
  type GameOptions,
  type GameState,
} from '@atlas/engine';
import postgres from 'postgres';
import { LOCAL_DATABASE_URL, type Sql } from '../src/db.ts';
import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage, type Versioned } from '../src/protocol.ts';
import { startServer, type ServerOptions } from '../src/server.ts';

// The stacked deck of the scripted games (hands by seat, then the Market, then the draws): seat 0 starts with
// cities of the three smallest countries and draws the missing ones first, so it can win a 3-country game in a
// few turns.
const winning: CardId[] = [...COUNTRIES]
  .sort((a, b) => a.cities.length - b.cities.length)
  .slice(0, 3)
  .flatMap((country) => country.cities);
const others = CARDS.map((card) => card.id).filter((card) => !winning.includes(card));
const dealt = RULES.startingHand + RULES.marketSize;
export const deck = [
  ...winning.slice(0, RULES.startingHand),
  ...others.slice(0, dealt),
  ...winning.slice(RULES.startingHand),
  ...others.slice(dealt),
];
/** A game dealt from `deck`, for `startTestServer({ newGame })`. */
export const newGame = (options: GameOptions): GameState => createGame(options, 1, { deck });

export interface TestServer {
  /** The WebSocket endpoint. It changes when the server restarts. */
  readonly url: string;
  /** The server's database, for the few facts the protocol cannot show. */
  db: Sql;
  /**
   * Stops the server and starts a new one on the same database, as restarting its process would.
   * Every connection is lost, and everything the server had to write is in the database.
   */
  restart(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Starts the server in-process on a free port, against a database created for the occasion in the Postgres
 * server of DATABASE_URL (by default the local development container) and dropped by `close`.
 * Call once per test file.
 */
export async function startTestServer(options: Pick<ServerOptions, 'newGame' | 'bot'> = {}): Promise<TestServer> {
  const adminUrl = process.env.DATABASE_URL ?? LOCAL_DATABASE_URL;
  const admin = postgres(adminUrl, { max: 1, connect_timeout: 5, onnotice: () => {} });
  const name = `atlas_test_${randomBytes(6).toString('hex')}`;
  try {
    await admin.unsafe(`create database ${name}`);
  } catch (error) {
    await admin.end();
    throw new Error(`Cannot create a test database in the Postgres server of ${adminUrl}; is it running?`, {
      cause: error,
    });
  }
  const databaseUrl = new URL(adminUrl);
  databaseUrl.pathname = `/${name}`;
  const start = () => startServer({ ...options, databaseUrl: databaseUrl.href, port: 0, host: '127.0.0.1' });
  let server = await start();
  const db = postgres(databaseUrl.href, { max: 1 });
  return {
    get url() {
      return `ws://127.0.0.1:${server.port}/ws`;
    },
    db,
    async restart() {
      await server.close();
      server = await start();
    },
    async close() {
      await Promise.all([server.close(), db.end()]);
      await admin.unsafe(`drop database ${name}`);
      await admin.end();
    },
  };
}

/** A seat held by a person, as a `room` message lists it. */
export const person = (name: string) => ({ name, bot: false, status: 'connected' });
/** A seat held by a bot. */
export const seated = (name: string) => ({ name, bot: true, status: 'connected' });

export type Received<Type extends ServerMessage['type']> = Versioned<Extract<ServerMessage, { type: Type }>>;

/** A scripted client: sends messages and reads what the server sends back, strictly in order. */
export class Client {
  /** Every message received so far, as sent on the wire. */
  readonly raw: string[] = [];
  /** Settles once the connection is closed, by either end. */
  readonly closed: Promise<void>;
  #read = 0;
  #wake = (): void => {};
  #socket: WebSocket;

  private constructor(socket: WebSocket) {
    this.#socket = socket;
    this.closed = new Promise((resolve) => socket.addEventListener('close', () => resolve()));
    socket.addEventListener('message', (event) => {
      this.raw.push(event.data as string);
      this.#wake();
    });
  }

  static connect(url: string): Promise<Client> {
    const socket = new WebSocket(url);
    return new Promise((resolve, reject) => {
      socket.addEventListener('open', () => resolve(new Client(socket)));
      socket.addEventListener('error', () => reject(new Error(`Cannot connect to ${url}`)));
    });
  }

  send(message: ClientMessage): void {
    this.sendRaw({ v: PROTOCOL_VERSION, ...message });
  }

  /** For messages a well-behaved client would never send. */
  sendRaw(message: unknown): void {
    this.#socket.send(JSON.stringify(message));
  }

  /** The next unread message, which must be of the given type. Waits for it if needed. */
  async next<Type extends ServerMessage['type']>(type: Type): Promise<Received<Type>> {
    while (this.#read === this.raw.length) await new Promise<void>((resolve) => (this.#wake = resolve));
    const text = this.raw[this.#read++]!;
    const message = JSON.parse(text) as Received<ServerMessage['type']>;
    assert.equal(message.type, type, text);
    return message as Received<Type>;
  }

  close(): void {
    this.#socket.close();
  }
}

/** The two players of a scripted game, in seat order. */
export type Players = readonly [Client, Client];

/** The next message of each player, which must be a state. */
export async function nextStates([host, friend]: Players) {
  return [await host.next('state'), await friend.next('state')] as const;
}

type States = Awaited<ReturnType<typeof nextStates>>;

/**
 * One step of a scripted game: the player the game is waiting on sends an intent, and everyone reads the state
 * that follows. Seat 0 lays every city it can; seat 1 only draws and passes.
 */
export async function act(players: Players, states: States): Promise<States> {
  const preferred = [['lay', 'draw', 'endTurn'], ['draw', 'endTurn']] as const;
  const seat = states.findIndex((state) => state.legalActions.length > 0);
  const { stateVersion, legalActions } = states[seat]!;
  players[seat]!.send({ type: 'intent', stateVersion, action: prefer(legalActions, preferred[seat]!) });
  return nextStates(players);
}

/** The legal action of the first of `types` that has one, or else the first legal action. */
export function prefer(legalActions: readonly Action[], types: readonly Action['type'][]): Action {
  return types.map((type) => legalActions.find((action) => action.type === type)).find(Boolean) ?? legalActions[0]!;
}
