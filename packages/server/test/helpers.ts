// Shared test helpers. Tests drive the server through its WebSocket protocol only, with scripted clients.

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { LOCAL_DATABASE_URL, type Sql } from '../src/db.ts';
import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage, type Versioned } from '../src/protocol.ts';
import { startServer, type ServerOptions } from '../src/server.ts';

export interface TestServer {
  /** The WebSocket endpoint. */
  url: string;
  /** The server's database, for the few facts the protocol cannot show. */
  db: Sql;
  close(): Promise<void>;
}

/**
 * Starts the server in-process on a free port, against a database created for the occasion in the Postgres
 * server of DATABASE_URL (by default the local development container) and dropped by `close`.
 * Call once per test file.
 */
export async function startTestServer(options: Pick<ServerOptions, 'newGame'> = {}): Promise<TestServer> {
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
  const server = await startServer({ ...options, databaseUrl: databaseUrl.href, port: 0, host: '127.0.0.1' });
  const db = postgres(databaseUrl.href, { max: 1 });
  return {
    url: `ws://127.0.0.1:${server.port}/ws`,
    db,
    async close() {
      await Promise.all([server.close(), db.end()]);
      await admin.unsafe(`drop database ${name}`);
      await admin.end();
    },
  };
}

type Received<Type extends ServerMessage['type']> = Versioned<Extract<ServerMessage, { type: Type }>>;

/** A scripted client: sends messages and reads what the server sends back, strictly in order. */
export class Client {
  /** Every message received so far, as sent on the wire. */
  readonly raw: string[] = [];
  #read = 0;
  #wake = (): void => {};
  #socket: WebSocket;

  private constructor(socket: WebSocket) {
    this.#socket = socket;
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
