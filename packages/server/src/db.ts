import { hash, randomBytes } from 'node:crypto';
import postgres from 'postgres';
import type { Snapshot, Summary } from './rooms.ts';

export type Sql = postgres.Sql;

/** The database of the local development container (see the server notes). */
export const LOCAL_DATABASE_URL = 'postgres://atlas:atlas@127.0.0.1:5432/atlas';

/** Connects and creates the tables that are missing. */
export async function openDatabase(url: string): Promise<Sql> {
  const sql = postgres(url, { connect_timeout: 5, onnotice: () => {} });
  try {
    await sql`
      create table if not exists accounts (
        id uuid primary key default gen_random_uuid(),
        token_hash text not null unique,
        name text not null,
        created_at timestamptz not null default now()
      )`;
    // `game` is json, not jsonb: jsonb reorders object keys, and a restored game must be the game that was saved.
    await sql`
      create table if not exists room_snapshots (
        code text primary key,
        countries_to_win integer not null,
        players jsonb not null,
        started_at timestamptz not null,
        state_version integer not null,
        game json not null
      )`;
    await sql`
      create table if not exists game_summaries (
        id uuid primary key default gen_random_uuid(),
        players jsonb not null,
        countries_to_win integer not null,
        winner integer,
        duration_seconds integer not null,
        finished_at timestamptz not null default now()
      )`;
  } catch (error) {
    await sql.end();
    throw error;
  }
  return sql;
}

/** Creates a guest account and returns its id and its token. Only a hash of the token is stored. */
export async function createAccount(sql: Sql, name: string): Promise<{ id: string; token: string }> {
  const token = randomBytes(32).toString('base64url');
  const [account] = await sql<{ id: string }[]>`
    insert into accounts (token_hash, name) values (${hashOf(token)}, ${name}) returning id`;
  return { id: account!.id, token };
}

/** The account identified by `token`, if there is one. */
export async function findAccount(sql: Sql, token: string): Promise<{ id: string; name: string } | undefined> {
  const [account] = await sql<{ id: string; name: string }[]>`
    select id, name from accounts where token_hash = ${hashOf(token)}`;
  return account;
}

/** Saves a room over its previous snapshot. The players and the start time of a room never change. */
export async function saveSnapshot(sql: Sql, snapshot: Snapshot): Promise<void> {
  const { code, countriesToWin, players, startedAt, stateVersion, game } = snapshot;
  await sql`
    insert into room_snapshots (code, countries_to_win, players, started_at, state_version, game)
    values (${code}, ${countriesToWin}, ${sql.json(players)}, ${startedAt}, ${stateVersion}, ${sql.json(game)})
    on conflict (code) do update set state_version = excluded.state_version, game = excluded.game`;
}

/** Every room whose game was in progress when the server last saved it. */
export async function loadSnapshots(sql: Sql): Promise<Snapshot[]> {
  return sql<Snapshot[]>`
    select code, countries_to_win as "countriesToWin", players, started_at as "startedAt",
      state_version as "stateVersion", game
    from room_snapshots`;
}

/** The game of room `code` is over: stores its summary and removes its snapshot. */
export async function finishGame(sql: Sql, code: string, summary: Summary): Promise<void> {
  const { players, countriesToWin, winner, durationSeconds } = summary;
  await sql.begin(async (tx) => {
    await tx`
      insert into game_summaries (players, countries_to_win, winner, duration_seconds)
      values (${tx.json(players)}, ${countriesToWin}, ${winner}, ${durationSeconds})`;
    await tx`delete from room_snapshots where code = ${code}`;
  });
}

function hashOf(token: string): string {
  return hash('sha256', token);
}
