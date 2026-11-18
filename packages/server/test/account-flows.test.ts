import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { accountFlows, type IdentityStore, type ProviderAdapter } from '../src/account/flows.ts';

const verifier = 'v'.repeat(43);
const challenge = createHash('sha256').update(verifier).digest('base64url');

function fixture() {
  let now = 0;
  const bindings = new Map<string, string>();
  const issued: string[] = [];
  let verifications = 0;
  const store: IdentityStore = {
    account: async (token) => token === 'guest-token' ? { id: 'guest-id', name: 'Guest' } : undefined,
    providers: async (id) => [...bindings].filter(([, owner]) => owner === id).map(() => 'google'),
    link: async (id, identity) => {
      if (bindings.has(identity.subject)) return bindings.get(identity.subject) === id;
      bindings.set(identity.subject, id);
      return true;
    },
    ownerOf: async identity => bindings.get(identity.subject),
    restore: async (identity, owner) => {
      const id = bindings.get(identity.subject);
      if (!id || id !== owner) return;
      issued.push(id);
      return { token: 'recovery-token', name: 'Guest' };
    },
  };
  const google: ProviderAdapter = {
    authorize: ({ state, nonce }) => `https://accounts.example.test/?state=${state}&nonce=${nonce}`,
    exchange: async ({ code, nonce }) => {
      verifications++;
      assert.ok(nonce);
      return code === 'verified-code' ? { provider: 'google', subject: 'verified-subject' } : undefined;
    },
  };
  return { store, bindings, issued, count: () => verifications, expire: () => { now += 600_001; },
    flows: accountFlows({ google }, store, () => now) };
}

const begin = { provider: 'google', mode: 'link', challenge };
const state = (url: string) => new URL(url).searchParams.get('state')!;
const callback = (url: string) => ({ state: state(url), code: 'verified-code' });

test('verified link requires existing ownership; restore issues a token for that exact account', async () => {
  const f = fixture();
  assert.equal(await f.flows.begin(begin, 'wrong-token'), undefined);
  const link = await f.flows.begin(begin, 'guest-token');
  assert.ok(link, 'an authorized guest can start linking');
  const claim = await f.flows.callback('google', callback(link));
  assert.ok(claim);
  assert.deepEqual([...f.bindings], []);
  assert.equal(await f.flows.redeem({ code: claim, verifier }, 'wrong-token'), undefined);
  assert.equal(await f.flows.redeem({ code: claim, verifier: 'w'.repeat(43) }, 'guest-token'), undefined);
  assert.deepEqual(await f.flows.redeem({ code: claim, verifier }, 'guest-token'), { linked: true });
  assert.deepEqual(await f.flows.status('guest-token'), { providers: ['google'], linked: ['google'], authenticated: true });
  assert.equal(await f.flows.redeem({ code: claim, verifier }, 'guest-token'), undefined);
  const recovery = await f.flows.begin({ ...begin, mode: 'restore' });
  const recoveryClaim = await f.flows.callback('google', callback(recovery!));
  assert.deepEqual(await f.flows.redeem({ code: recoveryClaim, verifier }), { token: 'recovery-token', name: 'Guest' });
  assert.deepEqual(f.issued, ['guest-id']);
});

test('wrong provider, unknown state, cancelled, replayed and expired callbacks cannot bind accounts', async () => {
  const f = fixture();
  const link = await f.flows.begin(begin, 'guest-token');
  assert.ok(link);
  assert.equal(await f.flows.callback('apple', callback(link)), undefined);
  assert.equal(await f.flows.callback('google', { state: 'invented', code: 'verified-code' }), undefined);
  assert.equal(await f.flows.callback('google', { state: state(link), error: 'access_denied' }), undefined);
  assert.equal(await f.flows.callback('google', callback(link)), undefined);
  const expired = await f.flows.begin(begin, 'guest-token');
  f.expire();
  assert.equal(await f.flows.callback('google', callback(expired!)), undefined);
  assert.equal(f.count(), 0);
  assert.deepEqual([...f.bindings], []);
});


function scopedFlows(now: () => number = Date.now) {
  const accounts = new Set(['first', 'second']);
  const exchanges = new Map<string, Promise<Awaited<ReturnType<ProviderAdapter['exchange']>>>>();
  const commits = new Map<string, Promise<boolean>>();
  let linkStarted = () => {};
  const restore: IdentityStore['restore'] = async (_identity, id) => ({ token: `session-${id}`, name: 'Guest' });
  const flows = accountFlows({ google: {
    authorize: ({ state }) => `https://accounts.example.test/?state=${state}`,
    exchange: async ({ code }) => exchanges.get(code) ?? { provider: 'google', subject: code },
  } }, {
    account: async id => accounts.has(id) ? { id, name: 'Guest' } : undefined,
    providers: async () => [],
    ownerOf: async ({ subject }: { subject: string }) => accounts.has(subject) ? subject : undefined,
    link: async id => { linkStarted(); return commits.get(id) ?? accounts.has(id); },
    restore,
  }, now);
  const prepare = async (mode: 'link' | 'restore', id: string) => {
    const url = await flows.begin({ ...begin, mode }, mode === 'link' ? id : undefined);
    assert.ok(url);
    return { state: state(url), code: id };
  };
  const claim = async (mode: 'link' | 'restore', id: string) => {
    const code = await flows.callback('google', await prepare(mode, id));
    assert.ok(code);
    return { code, verifier };
  };
  return { flows, accounts, exchanges, commits, prepare, claim, onLink: (callback: () => void) => { linkStarted = callback; } };
}

test('committed erasure discards its pending link and verified restore while preserving another account', async () => {
  const f = scopedFlows();
  const pending = await f.prepare('link', 'first');
  const restore = await f.claim('restore', 'first');
  const other = await f.claim('restore', 'second');
  f.accounts.delete('first');
  f.flows.erase('first');
  assert.equal(await f.flows.callback('google', pending), undefined);
  assert.equal(await f.flows.redeem(restore), undefined);
  assert.deepEqual(await f.flows.redeem(other), { token: 'session-second', name: 'Guest' });
});

test('deferred provider and store completions cannot publish for an erased account', async () => {
  const f = scopedFlows();
  const link = await f.claim('link', 'first');
  const commit = Promise.withResolvers<boolean>();
  const started = Promise.withResolvers<void>();
  f.onLink(() => started.resolve());
  f.commits.set('first', commit.promise);
  const redemption = f.flows.redeem(link, 'first');
  await started.promise;
  const exchange = Promise.withResolvers<{ provider: 'google'; subject: string }>();
  const restore = await f.prepare('restore', 'first');
  f.exchanges.set('first', exchange.promise);
  const callback = f.flows.callback('google', restore);
  f.accounts.delete('first');
  f.flows.erase('first');
  commit.resolve(true);
  exchange.resolve({ provider: 'google', subject: 'first' });
  assert.deepEqual([await redemption, await callback], [undefined, undefined]);
});

test('sign-in deadlines evict entries without subsequent traffic and shutdown cancels timers', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  // Hold the admission clock still to distinguish active timer eviction from lazy expiry on access.
  const f = scopedFlows(() => 0);
  const pending = await f.prepare('link', 'first');
  const verify = await f.claim('restore', 'first');
  t.mock.timers.tick(60_000);
  assert.equal(await f.flows.redeem(verify), undefined);
  t.mock.timers.tick(240_000);
  assert.equal(await f.flows.callback('google', pending), undefined);
  const remaining = await f.prepare('link', 'first');
  f.flows.close();
  assert.equal(await f.flows.callback('google', remaining), undefined);
  assert.equal(await f.flows.begin(begin, 'first'), undefined);
});
