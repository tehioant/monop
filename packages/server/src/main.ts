// `npm start -w @atlas/server`. Settings and room durations come from the environment.

import { LOCAL_DATABASE_URL } from './db.ts';
import { configuredProviders } from './account/oidc.ts';
import { startServer } from './server.ts';
import { DEFAULT_ROOM_TIMING } from './rooms.ts';

function duration(key: string, fallback: number): number {
  const value = Number(process.env[key] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1 || value > 2 ** 31 - 1) throw Error(`${key} must be a positive timer duration in milliseconds`);
  return value;
}

const timing = {
  turnMs: duration('TURN_MS', DEFAULT_ROOM_TIMING.turnMs),
  responseMs: duration('RESPONSE_MS', DEFAULT_ROOM_TIMING.responseMs),
  graceMs: duration('DISCONNECT_GRACE_MS', DEFAULT_ROOM_TIMING.graceMs),
  abandonedMs: duration('ABANDONED_ROOM_MS', DEFAULT_ROOM_TIMING.abandonedMs),
};
if (timing.responseMs >= timing.turnMs) throw Error('RESPONSE_MS must be shorter than TURN_MS');

const host = process.env.HOST ?? '127.0.0.1';
const { port } = await startServer({
  databaseUrl: process.env.DATABASE_URL ?? LOCAL_DATABASE_URL,
  port: Number(process.env.PORT ?? 3000),
  host,
  timing,
  providers: configuredProviders(process.env),
});
console.log(`Atlas server listening on ws://${host}:${port}/ws`);
