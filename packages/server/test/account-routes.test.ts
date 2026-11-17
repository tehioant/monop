import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { accountRoutes } from '../src/account/routes.ts';
import { sha256url, type IdentityStore } from '../src/account/flows.ts';

const verifier = 'a'.repeat(43);
const token = 'b'.repeat(43);
const headers = { authorization: `Bearer ${token}` };
const accounts = new Map([[token, { id: 'original-account', name: 'Original guest' }]]);

test('account HTTP routes return a proof-bound callback and issue credentials only in a no-store response body', async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  const store: IdentityStore = {
    account: async (candidate) => accounts.get(candidate),
    providers: async () => ['google'],
    link: async () => assert.fail('restore must not link a new identity'),
    restore: async (identity) => {
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
