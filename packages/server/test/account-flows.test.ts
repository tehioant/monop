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
    restore: async (identity) => {
      const id = bindings.get(identity.subject);
      if (!id) return;
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
