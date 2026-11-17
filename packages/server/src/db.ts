import { hash, randomBytes } from 'node:crypto';
import postgres from 'postgres';
import type { IdentityStore, Provider } from './account/flows.ts';
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
    await sql`
      create table if not exists account_sessions (
        token_hash text primary key,
        account_id uuid not null references accounts (id) on delete cascade
      )`;
    await sql`
      create table if not exists account_identities (
        provider text not null,
        subject text not null,
        account_id uuid not null references accounts (id) on delete cascade,
        revocation text,
        primary key (provider, subject),
        unique (account_id, provider)
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
    select id, name from accounts where token_hash = ${hashOf(token)}
    union all
    select a.id, a.name from accounts a join account_sessions s on s.account_id = a.id
    where s.token_hash = ${hashOf(token)}`;
  return account;
}

/** Verified subject bindings never overwrite or move an existing identity. */
export function identityStore(sql: Sql): IdentityStore {
  return {
    account: token => findAccount(sql, token),
    async providers(id) {
      const rows = await sql<{ provider: Provider }[]>`
        select provider from account_identities where account_id = ${id} order by provider`;
      return rows.map(row => row.provider);
    },
    link: (id, { provider, subject, revocation }) => sql.begin(async (tx) => {
      const [owner] = await tx`select id from accounts where id = ${id} for update`;
      if (!owner) return false;
      const [linked] = await tx`
        select subject from account_identities where account_id = ${id} and provider = ${provider}`;
      if (linked) return linked.subject === subject;
      if (provider === 'apple' && !revocation) return false;
      const [inserted] = await tx`
        insert into account_identities (account_id, provider, subject, revocation)
        values (${id}, ${provider}, ${subject}, ${revocation ?? null}) on conflict do nothing returning account_id`;
      return !!inserted;
    }),
    restore: ({ provider, subject }) => sql.begin(async (tx) => {
      const [account] = await tx<{ id: string; name: string }[]>`
        select a.id, a.name from accounts a join account_identities i on i.account_id = a.id
        where i.provider = ${provider} and i.subject = ${subject} for update of a`;
      if (!account) return;
      const token = randomBytes(32).toString('base64url');
      await tx`insert into account_sessions (token_hash, account_id) values (${hashOf(token)}, ${account.id})`;
      return { token, name: account.name };
    }),
  };
}

/** The account plays under `name` from now on. */
export async function renameAccount(sql: Sql, id: string, name: string): Promise<void> {
  await sql`update accounts set name = ${name} where id = ${id}`;
}

/** Saves a room over its previous snapshot, including any permanent seat release. */
export async function saveSnapshot(sql: Sql, snapshot: Snapshot): Promise<void> {
  const { code, countriesToWin, players, startedAt, stateVersion, game } = snapshot;
  await sql`
    insert into room_snapshots (code, countries_to_win, players, started_at, state_version, game)
    values (${code}, ${countriesToWin}, ${sql.json(players)}, ${startedAt}, ${stateVersion}, ${sql.json(game)})
    on conflict (code) do update set players = excluded.players, state_version = excluded.state_version, game = excluded.game`;
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

export async function discardSnapshot(sql: Sql, code: string): Promise<void> {
  await sql`delete from room_snapshots where code = ${code}`;
}

function hashOf(token: string): string {
  return hash('sha256', token);
}
