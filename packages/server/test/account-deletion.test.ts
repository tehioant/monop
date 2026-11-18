import assert from 'node:assert/strict';
import { hash } from 'node:crypto';
import test from 'node:test';
import { createGame } from '@atlas/engine';
import type { VerifiedIdentity } from '../src/account/flows.ts';
import { anonymizeLegacyPlayers, eraseAccount, identityStore, type Sql } from '../src/db.ts';
import { roomWrites } from '../src/server.ts';
import { Rooms, type Member, type Player, type Snapshot } from '../src/rooms.ts';

const target = { account: 'target-id', name: 'Private name' };
const departed = { account: null, departedAccount: 'target-id', name: 'Private name' };
const other = { account: 'other-id', name: 'Other player' };
const redacted = { account: null, name: 'Bot 1' };
const token = 't'.repeat(43);
const game = createGame({ players: 2, countriesToWin: 3 }, 3);
const snapshot: Snapshot = { code: 'BCDFG', players: [target, other], countriesToWin: 3, startedAt: new Date(0), stateVersion: 1, game };

function database() {
  const accounts = new Set(['target-id', 'other-id']);
  const sessions = new Set(['target-id', 'other-id']);
  const bindings = new Map([['target-id', 'encrypted-refresh'], ['other-id', 'other-refresh']]);
  const snapshots = new Map([['BCDFG', [target, other]], ['OTHER', [other, other]]]);
  const summaries = new Map([['finished', [departed, other]]]);
  const events: string[] = [];
  const sql = Object.assign(async (parts: TemplateStringsArray, ...values: any[]) => {
    const command = parts.join('?').replace(/\s+/g, ' ').trim();
    if (command.startsWith('select a.id from accounts')) return accounts.has('target-id') && allowed(values)
      ? [{ id: 'target-id' }] : [];
    if (command.startsWith('select id from accounts') && command.endsWith('for update')) {
      events.push('lock link owner');
      return accounts.has(values[0]) ? [{ id: values[0] }] : [];
    }
    if (command.startsWith('select subject from account_identities')) {
      return bindings.has(values[0]) && values[1] === 'apple' ? [{ subject: 'apple-subject' }] : [];
    }
    if (command.startsWith('select a.id, a.name from accounts')) {
      assert.ok(command.endsWith('and a.id = ? for update of a'));
      assert.equal(values[2], 'target-id');
      events.push('lock restore owner');
      return values[0] === 'apple' && values[1] === 'apple-subject' && bindings.has('target-id')
        ? [{ id: 'target-id', name: 'Private name' }] : [];
    }
    if (command.startsWith('update account_identities set revocation')) {
      assert.equal(command, "update account_identities set revocation = ? where account_id = ? and provider = 'apple' and subject = ?");
      assert.equal(values[2], 'apple-subject');
      assert.match(events.at(-1) ?? '', /^lock (link|restore) owner$/);
      events.push('update Apple binding');
      bindings.set(values[1], values[0]);
      return [];
    }
    if (command.startsWith('insert into account_sessions')) {
      assert.equal(values[1], 'target-id');
      return [];
    }
    if (command.startsWith('select revocation from account_identities')) return [{ revocation: bindings.get(values[0]) }];
    if (command.startsWith('select code, players from room_snapshots')) return selected(snapshots, 'code', values);
    if (command.startsWith('select id, players from game_summaries')) return selected(summaries, 'id', values);
    if (command.startsWith('update room_snapshots set players')) { snapshots.set(values[1], values[0]); return []; }
    if (command.startsWith('update game_summaries set players')) { summaries.set(values[1], values[0]); return []; }
    if (command.startsWith('delete from accounts')) {
      events.push('delete account');
      for (const table of [accounts, sessions, bindings]) table.delete(values[0]); // production FKs cascade
      return [];
    }
    if (command.startsWith('insert into room_snapshots')) { snapshots.set(values[0], values[2]); return []; }
    throw Error(`Unexpected SQL: ${command}`);
  }, { begin: (fn: (tx: Sql) => unknown) => fn(sql as unknown as Sql), json: (value: unknown) => value }) as unknown as Sql;
  return { sql, accounts, sessions, bindings, snapshots, summaries, events };
}

const allowed = (values: unknown[]) => values[0] === hash('sha256', token) && values[1] === values[0];
const selected = (table: Map<string, Player[]>, key: string, values: any[]) => [...table].flatMap(([id, players]) => {
  const owner = values[0]?.[0]?.account;
  assert.equal(values[1]?.[0]?.departedAccount, owner);
  return players.some(player => player.account === owner || player.departedAccount === owner) ? [{ [key]: id, players }] : [];
});

test('transaction refuses an unknown bearer and a failed Apple revoke; success erases attributable data and preserves other players', async () => {
  const f = database();
  assert.equal(await eraseAccount(f.sql, 'not-owner', async () => assert.fail('unauthorized revoke')), undefined);
  assert.deepEqual(f.events, []);
  await assert.rejects(eraseAccount(f.sql, token, async () => { throw Error('revocation unavailable'); }), /revocation unavailable/);
  assert.deepEqual(f.events, []);
  assert.deepEqual(f.snapshots.get('BCDFG'), [target, other]);
  const erased = await eraseAccount(f.sql, token, async encrypted => {
    assert.equal(encrypted, 'encrypted-refresh');
    f.events.push('revoke Apple');
  });
  assert.equal(erased, 'target-id');
  assert.deepEqual(f.events, ['revoke Apple', 'delete account']);
  for (const table of [f.accounts, f.sessions, f.bindings]) {
    assert.ok(!table.has('target-id'));
    assert.ok(table.has('other-id'));
  }
  assert.deepEqual(f.snapshots.get('BCDFG'), [redacted, other]);
  assert.deepEqual(f.snapshots.get('OTHER'), [other, other]);
  assert.deepEqual(f.summaries.get('finished'), [redacted, other]);
});

test('room writes queued during erasure cannot recreate the deleted account data', async () => {
  const f = database();
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const writes = roomWrites(f.sql);
  const erase = writes.erase(async () => {
    const id = await eraseAccount(f.sql, token, async () => { started.resolve(); await release.promise; });
    assert.ok(id);
    return id;
  }, id => assert.equal(id, 'target-id'));
  await started.promise;
  const dirty = writes.save({ ...snapshot, players: [departed, other] });
  release.resolve();
  assert.equal(await erase, true);
  await dirty;
  assert.deepEqual(f.snapshots.get('BCDFG'), [redacted, other]);
});

test('room erasure keeps the other player and revokes the deleted seat before the next room write', t => {
  const rooms = new Rooms(() => game, (_view, legal) => legal.find(action => action.type === 'endTurn') ?? legal[0]!,
    { save(s) { assert.deepEqual(s.players, [redacted, other]); }, finish() {}, discard() {} }, [snapshot]);
  t.after(() => rooms.stop());
  const targetMember: Member = { ...target, send() {}, close() {} };
  const messages: any[] = [];
  rooms.resume(targetMember);
  rooms.resume({ ...other, send: message => messages.push(message), close() {} });
  rooms.eraseAccount('target-id');
  assert.equal(rooms.playing('target-id'), false);
  assert.equal(rooms.playing('other-id'), true);
  assert.throws(() => rooms.resync(targetMember), /Not in a room/);
  const room = messages.findLast(m => m.type === 'room');
  assert.deepEqual(room.players.map((p: any) => p.name), ['Bot 1', 'Other player']);
});


test('legacy roster migration canonicalizes anonymous seats by position without rewriting current rosters', async () => {
  const generated = { account: null, name: 'Bot 1' };
  const misnumbered = { account: null, name: 'Bot 907' };
  const labelMissing = { account: null };
  const tables = new Map<string, Array<{ account: string | null; name?: string; departedAccount?: string }>>(
    ['room_snapshots', 'game_summaries'].map(table => [table, [generated, misnumbered, other, departed, labelMissing]]),
  );
  const writes: string[] = [];
  const sql = ((parts: TemplateStringsArray | string, table?: string) => {
    if (typeof parts === 'string') return parts;
    assert.ok(table);
    const query = parts.join('?').replace(/\s+/g, ' ').trim();
    assert.ok(query.startsWith('update ? set players ='));
    assert.match(query, /jsonb_agg\(case when player->>'account' is null and player->>'departedAccount' is null/);
    assert.match(query, /else player end order by seat/);
    assert.match(query, /where exists .*where player->>'account' is null and player->>'departedAccount' is null/);
    assert.equal((query.match(/with ordinality as p\(player, seat\)/g) ?? []).length, 2,
      'both replacement and no-op selection must use roster ordinality');
    assert.equal((query.match(/player->>'name' is distinct from \('Bot ' \|\| seat\)/g) ?? []).length, 2);
    const before = tables.get(table)!;
    const after = before.map((p, i) => !p.account && !('departedAccount' in p) && p.name !== `Bot ${i + 1}`
      ? { account: null, name: `Bot ${i + 1}` } : p);
    if (after.some((p, i) => p !== before[i])) { writes.push(table); tables.set(table, after); }
    return [];
  }) as unknown as Sql;
  await anonymizeLegacyPlayers(sql);
  for (const roster of tables.values()) {
    assert.deepEqual(roster, [generated, { account: null, name: 'Bot 2' }, other, departed, { account: null, name: 'Bot 5' }]);
  }
  assert.deepEqual(writes, ['room_snapshots', 'game_summaries']);
  await anonymizeLegacyPlayers(sql);
  assert.deepEqual(writes, ['room_snapshots', 'game_summaries']);
});


test('the locked Apple binding retains the newest verified revocation material for erasure', async () => {
  for (const operation of ['link', 'restore'] as const) {
    const f = database();
    const store = identityStore(f.sql);
    const apple = { provider: 'apple', subject: 'apple-subject' } as const;
    const apply = (identity: VerifiedIdentity) => operation === 'link'
      ? store.link('target-id', identity, 'target-id') : store.restore(identity, 'target-id');
    assert.ok(await apply(apple));
    assert.equal(f.bindings.get('target-id'), 'encrypted-refresh', 'absent material never overwrites');
    assert.ok(!await apply({ ...apple, subject: 'different-subject', revocation: 'different-material' }));
    assert.equal(f.bindings.get('target-id'), 'encrypted-refresh');
    assert.ok(await apply({ ...apple, revocation: 'fresh-encrypted-refresh' }));
    assert.equal(f.bindings.get('target-id'), 'fresh-encrypted-refresh');
    assert.equal(f.bindings.get('other-id'), 'other-refresh');
    const revoked: string[] = [];
    assert.equal(await eraseAccount(f.sql, token, async encrypted => { revoked.push(encrypted); }), 'target-id');
    assert.deepEqual(revoked, ['fresh-encrypted-refresh']);
  }
});
