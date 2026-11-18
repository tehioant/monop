import assert from 'node:assert/strict';
import test from 'node:test';
import { accountFlows, sha256url, type IdentityStore, type ProviderAdapter } from '../src/account/flows.ts';

const verifier = 'v'.repeat(43);
const challenge = sha256url(verifier);
const state = 's'.repeat(43);
const code = 'c'.repeat(43);
const otherCode = 'o'.repeat(43);
const begin = { provider: 'google', mode: 'link', challenge };
const body = { state, code: 'fixture-result' };
const identity = { provider: 'google', subject: 'fixture-subject' } as const;
const attempt = { provider: 'google' as const, nonce: 'fixture-nonce', pkce: 'fixture-pkce', challenge, deadline: 300_000, revision: 0 };
const restore = { owner: 'first', link: false, challenge, identity, deadline: 60_000 };
type Memory = NonNullable<Parameters<typeof accountFlows>[3]>;

function fixture({ pending = new Map(), verified = new Map() }: Partial<Memory> = {},
  store: Partial<IdentityStore> = {}, exchange?: ProviderAdapter['exchange']) {
  let now = 0;
  const flows = accountFlows({ google: {
    authorize: ({ state }) => `https://accounts.example.test/?state=${state}`,
    exchange: exchange ?? (async input => {
      assert.equal(input.nonce, attempt.nonce);
      assert.equal(input.pkce, attempt.pkce);
      return identity;
    }),
  } }, {
    account: async token => token === 'first' ? { id: 'first', name: 'Guest' } : undefined,
    providers: async id => id === 'first' ? ['google'] : [],
    ownerOf: async () => undefined,
    link: async () => assert.fail('callback must not link an account'),
    restore: async () => assert.fail('callback must not issue a session'),
    ...store,
  }, () => now, { pending, verified });
  return { flows, pending, verified, expire: () => { now = 300_000; } };
}

test('starting a link requires an authorized owner and pending entries expire without traffic', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  assert.equal(await f.flows.begin(begin, 'wrong-token'), undefined);
  const url = await f.flows.begin(begin, 'first');
  assert.ok(url);
  const state = new URL(url).searchParams.get('state')!;
  assert.equal(f.pending.get(state)?.owner, 'first');
  t.mock.timers.tick(300_000);
  assert.equal(f.pending.size, 0);
  assert.ok(await f.flows.begin(begin, 'first'));
  f.flows.close();
  assert.equal(f.pending.size, 0);
  assert.equal(await f.flows.begin(begin, 'first'), undefined);
});

test('status reports linked providers for the authorized account', async () => {
  assert.deepEqual(await fixture().flows.status('first'), { providers: ['google'], linked: ['google'], authenticated: true });
});

test('wrong provider, unknown state, cancelled, replayed and expired callbacks cannot produce claims', async () => {
  const pending: Memory['pending'] = new Map([[state, { ...attempt, owner: 'first' }]]);
  const f = fixture({ pending }, {}, async () => assert.fail('unexpected provider exchange'));
  assert.equal(await f.flows.callback('apple', body), undefined);
  assert.equal(await f.flows.callback('google', { ...body, state: 'x'.repeat(43) }), undefined);
  assert.equal(await f.flows.callback('google', { state, error: 'access_denied' }), undefined);
  assert.equal(await f.flows.callback('google', body), undefined);
  pending.set(state, { ...attempt, owner: 'first' });
  f.expire();
  assert.equal(await f.flows.callback('google', body), undefined);
  assert.equal(f.verified.size, 0);
});

test('verified ownership authorizes only ordinary new links, same-owner links and exact restores', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const { initiator, bound, owner } of [
    { initiator: 'first', bound: undefined, owner: 'first' },
    { initiator: 'first', bound: 'first', owner: 'first' },
    { initiator: 'first', bound: 'second', owner: undefined },
    { initiator: undefined, bound: 'second', owner: 'second' },
    { initiator: undefined, bound: undefined, owner: undefined },
  ]) {
    const pending = new Map([[state, { ...attempt, owner: initiator }]]);
    const f = fixture({ pending }, { ownerOf: async verified => { assert.deepEqual(verified, identity); return bound; } });
    const code = await f.flows.callback('google', body);
    assert.equal(f.pending.size, 0);
    assert.equal(code ? f.verified.get(code)?.owner : undefined, owner);
    assert.equal(f.verified.size, owner ? 1 : 0);
    if (code) {
      assert.equal(f.verified.get(code)?.link, !!initiator);
      t.mock.timers.tick(60_000);
      assert.equal(f.verified.size, 0);
    }
  }
});

test('committed erasure discards its pending link and verified restore while preserving another account', () => {
  const another = 'a'.repeat(43);
  const pending = new Map([[state, { ...attempt, owner: 'first' }], [another, { ...attempt, owner: 'second' }]]);
  const verified = new Map([[code, restore], [otherCode, { ...restore, owner: 'second' }]]);
  const f = fixture({ pending, verified });
  f.flows.erase('first');
  assert.deepEqual([...pending.keys()], [another]);
  assert.deepEqual([...verified.keys()], [otherCode]);
});

test('a deferred provider completion for an erased account is discarded', async () => {
  const exchange = Promise.withResolvers<typeof identity>();
  const f = fixture({ pending: new Map([[state, attempt]]) }, { ownerOf: async () => undefined }, () => exchange.promise);
  const callback = f.flows.callback('google', body);
  f.flows.erase('first');
  exchange.resolve(identity);
  assert.equal(await callback, undefined);
  assert.equal(f.verified.size, 0);
});
