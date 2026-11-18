import assert from 'node:assert/strict';
import test from 'node:test';
import { identityStore, type Sql } from '../src/db.ts';

test('SQL link preserves the binding observed for that verification', async () => {
  const identity = { provider: 'google', subject: 'verified-subject' } as const;
  for (const { observed, linked, result, insert } of [
    { observed: null, linked: undefined, result: true, insert: true },
    { observed: 'owner', linked: identity.subject, result: true, insert: false },
    { observed: 'owner', linked: undefined, result: false, insert: false },
    { observed: 'owner', linked: 'different-subject', result: false, insert: false },
    { observed: null, linked: identity.subject, result: false, insert: false },
  ]) {
    const events: string[] = [];
    const sql = Object.assign(async (parts: TemplateStringsArray, ...values: unknown[]) => {
      const query = parts.join('?').replace(/\s+/g, ' ').trim();
      if (query === 'select id from accounts where id = ? for update') {
        assert.deepEqual(values, ['owner']);
        events.push('lock');
        return [{ id: 'owner' }];
      }
      if (query === 'select subject from account_identities where account_id = ? and provider = ?') {
        assert.deepEqual(values, ['owner', 'google']);
        events.push('read');
        return linked ? [{ subject: linked }] : [];
      }
      if (query.startsWith('insert into account_identities') && query.endsWith('on conflict do nothing returning account_id')) {
        assert.deepEqual(values.slice(0, 3), ['owner', 'google', identity.subject]);
        events.push('insert');
        return [{ account_id: 'owner' }];
      }
      assert.fail(`Unexpected SQL: ${query}`);
    }, { begin: (fn: (tx: Sql) => unknown) => fn(sql) }) as unknown as Sql;
    assert.equal(await identityStore(sql).link('owner', identity, observed), result);
    assert.deepEqual(events, insert ? ['lock', 'read', 'insert'] : ['lock', 'read']);
  }
});