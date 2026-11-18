import { hash, randomBytes } from 'node:crypto';
import postgres from 'postgres';
import type { IdentityStore, Provider } from './account/flows.ts';
import { redactPlayers, type Player, type Snapshot, type Summary } from './rooms.ts';

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
    await anonymizeLegacyPlayers(sql);
  } catch (error) {
    await sql.end();
    throw error;
  }
  return sql;
}

export async function anonymizeLegacyPlayers(sql: Sql): Promise<void> {
  // Older snapshots discarded the owner of a released seat but kept its name. Those legacy names cannot
  // be attributed safely, so anonymize them before loading any room. New releases retain the erasure tag.
  for (const table of ['room_snapshots', 'game_summaries']) {
    await sql`update ${sql(table)} set players = (
      select jsonb_agg(case when player->>'account' is null and player->>'departedAccount' is null
        and player->>'name' is distinct from ('Bot ' || seat)
        then jsonb_build_object('account', null::text, 'name', 'Bot ' || seat) else player end order by seat)
      from jsonb_array_elements(players) with ordinality as p(player, seat)
    ) where exists (select 1 from jsonb_array_elements(players) with ordinality as p(player, seat)
      where player->>'account' is null and player->>'departedAccount' is null
        and player->>'name' is distinct from ('Bot ' || seat))`;
  }
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

/** Caller serializes this transaction with room writes. The row lock also excludes link and restore. */
export function eraseAccount(sql: Sql, token: string, revokeApple?: (encrypted: string) => Promise<void>): Promise<string | undefined> {
  const digest = hashOf(token);
  return sql.begin(async (tx) => {
    const [account] = await tx<{ id: string }[]>`
      select a.id from accounts a where a.token_hash = ${digest} or exists (
        select 1 from account_sessions s where s.account_id = a.id and s.token_hash = ${digest}) for update`;
    if (!account) return;
    const { id } = account;
    const [apple] = await tx<{ revocation: string | null }[]>`
      select revocation from account_identities where account_id = ${id} and provider = 'apple'`;
    if (apple) {
      if (!apple.revocation || !revokeApple) throw Error('Apple revocation unavailable');
      await revokeApple(apple.revocation);
    }
    const owner = tx.json([{ account: id }]), released = tx.json([{ departedAccount: id }]);
    const snapshots = await tx<{ code: string; players: Player[] }[]>`
      select code, players from room_snapshots where players @> ${owner} or players @> ${released} for update`;
    for (const { code, players } of snapshots) {
      await tx`update room_snapshots set players = ${tx.json(redactPlayers(players, id))} where code = ${code}`;
    }
    const summaries = await tx<{ id: string; players: Player[] }[]>`
      select id, players from game_summaries where players @> ${owner} or players @> ${released} for update`;
    for (const summary of summaries) {
      await tx`update game_summaries set players = ${tx.json(redactPlayers(summary.players, id))} where id = ${summary.id}`;
    }
    await tx`delete from accounts where id = ${id}`;
    return id;
  });
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
