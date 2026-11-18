import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { accountRoutes } from '../src/account/routes.ts';
import { sha256url, type IdentityStore } from '../src/account/flows.ts';

const verifier = 'a'.repeat(43);
const token = 'b'.repeat(43);
const headers = { authorization: `Bearer ${token}` };
const accounts = new Map([[token, { id: 'original-account', name: 'Original guest' }]]);

test('authenticated account removal is unavailable without ownership and never claims success on refusal', async t => {
  const app = Fastify();
  t.after(() => app.close());
  const refusedToken = 'c'.repeat(43);
  const unknownToken = 'x'.repeat(43);
  const currentAccounts = new Map(accounts).set(refusedToken, { id: 'refused-account', name: 'Another guest' });
  const calls: [operation: 'account' | 'erase', candidate: string][] = [];
  accountRoutes(app, {}, {
    account: async candidate => {
      calls.push(['account', candidate]);
      return currentAccounts.get(candidate);
    },
    providers: async () => [], ownerOf: async () => undefined, link: async () => false, restore: async () => undefined,
  }, async candidate => { calls.push(['erase', candidate]); return candidate === token; });
  const remove = (authorization?: string) => app.inject({ method: 'DELETE', url: '/account', headers: authorization ? { authorization } : {} });
  const assertRefused = async (authorization?: string) => {
    const reply = await remove(authorization);
    assert.equal(reply.statusCode, 401);
    assert.deepEqual(reply.json(), { error: 'invalid_token' });
    assert.equal(reply.headers['cache-control'], 'no-store');
    assert.equal(reply.headers['referrer-policy'], 'no-referrer');
  };

  await assertRefused();
  await assertRefused('Bearer nonsense');
  assert.deepEqual(calls, []);
  await assertRefused(`Bearer ${unknownToken}`);
  assert.deepEqual(calls.splice(0), [['account', unknownToken]]);
  await assertRefused(`Bearer ${refusedToken}`);
  assert.deepEqual(calls.splice(0), [['account', refusedToken], ['erase', refusedToken]]);
  const success = await remove(headers.authorization);
  assert.deepEqual(calls, [['account', token], ['erase', token]]);
  assert.equal(success.statusCode, 204);
  assert.equal(success.body, '');
  assert.equal(success.headers['cache-control'], 'no-store');
});

test('account HTTP routes return a proof-bound callback and issue credentials only in a no-store response body', async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  const store: IdentityStore = {
    account: async (candidate) => accounts.get(candidate),
    providers: async () => ['google'],
    link: async () => assert.fail('restore must not link a new identity'),
    ownerOf: async () => 'original-account',
    restore: async (identity, owner) => {
      assert.equal(owner, 'original-account');
      assert.deepEqual(identity, { provider: 'google', subject: 'verified' });
      return { token, name: 'Original guest' };
    },
  };
  accountRoutes(app, { google: {
    authorize: ({ state }) => `https://mock-provider.example.test/?state=${state}`,
    exchange: async () => ({ provider: 'google', subject: 'verified' }),
  } }, store);
  const status = await app.inject({ method: 'GET', url: '/account', headers });
  assert.equal(status.statusCode, 200);
  assert.deepEqual(status.json(), { providers: ['google'], linked: ['google'], authenticated: true });
  const start = await app.inject({ method: 'POST', url: '/account/begin', payload: { provider: 'google', mode: 'restore', challenge: sha256url(verifier) } });
  assert.equal(start.statusCode, 200);
  const state = new URL(start.json().url).searchParams.get('state');
  const callback = await app.inject({ method: 'GET', url: `/account/callback/google?state=${state}&code=provider-code` });
  assert.equal(callback.statusCode, 303);
  assert.equal(callback.headers['referrer-policy'], 'no-referrer');
  const link = String(callback.headers.location);
  assert.match(link, /^atlas:\/\/account-auth#code=[A-Za-z0-9_-]{43}$/);
  assert.ok(!link.includes(token));
  assert.ok(!link.includes('provider-code'));
  const code = link.split('#code=')[1];
  const wrong = await app.inject({ method: 'POST', url: '/account/redeem', payload: { code, verifier: 'x'.repeat(43) } });
  assert.equal(wrong.statusCode, 403);
  const restored = await app.inject({ method: 'POST', url: '/account/redeem', payload: { code, verifier } });
  assert.equal(restored.statusCode, 200);
  assert.equal(restored.headers['cache-control'], 'no-store');
  assert.deepEqual(restored.json(), { token, name: 'Original guest' });
});
