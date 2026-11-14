// `npm start -w @atlas/server`. Settings come from the environment: DATABASE_URL, PORT, HOST.

import { LOCAL_DATABASE_URL } from './db.ts';
import { startServer } from './server.ts';

const host = process.env.HOST ?? '127.0.0.1';
const { port } = await startServer({
  databaseUrl: process.env.DATABASE_URL ?? LOCAL_DATABASE_URL,
  port: Number(process.env.PORT ?? 3000),
  host,
});
console.log(`Atlas server listening on ws://${host}:${port}/ws`);
