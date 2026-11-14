import { createHash, randomBytes } from 'node:crypto';
import postgres from 'postgres';

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
  } catch (error) {
    await sql.end();
    throw error;
  }
  return sql;
}

/** Creates a guest account and returns its token. Only a hash of the token is stored. */
export async function createAccount(sql: Sql, name: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await sql`insert into accounts (token_hash, name) values (${hash(token)}, ${name})`;
  return token;
}

/** The display name of the account identified by `token`, if there is one. */
export async function findAccountName(sql: Sql, token: string): Promise<string | undefined> {
  const [account] = await sql<{ name: string }[]>`select name from accounts where token_hash = ${hash(token)}`;
  return account?.name;
}

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
