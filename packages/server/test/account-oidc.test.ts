import assert from 'node:assert/strict';
import test from 'node:test';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { configuredProviders } from '../src/account/oidc.ts';

const env = { ACCOUNT_ORIGIN: 'https://game.example.test', GOOGLE_CLIENT_ID: 'google-client', GOOGLE_CLIENT_SECRET: 'test-secret', APPLE_CLIENT_ID: 'apple-client' };
const flow = { state: 'state', nonce: 'nonce', pkce: 'proof' };

test('Google exchanges a bound code and only admits correctly signed, issued, addressed, fresh and nonce-bound IDs', async () => {
  const keys = await generateKeyPair('RS256');
  const foreign = await generateKeyPair('RS256');
  const jwk = { ...await exportJWK(keys.publicKey), kid: 'google-key' };
  let idToken = '';
  const responses: string[] = [];
  const io: typeof fetch = async (input, options) => {
    const url = String(input);
    responses.push(url);
    if (url === 'https://www.googleapis.com/oauth2/v3/certs') return Response.json({ keys: [jwk] });
    assert.equal(url, 'https://oauth2.googleapis.com/token');
    assert.equal(options?.method, 'POST');
    const body = new URLSearchParams(String(options?.body));
    assert.equal(body.get('redirect_uri'), 'https://game.example.test/account/callback/google');
    assert.equal(body.get('code_verifier'), 'proof');
    assert.equal(body.get('code'), 'provider-code');
    return Response.json({ id_token: idToken });
  };
  const adapters = configuredProviders(env, io);
  assert.deepEqual(Object.keys(adapters), ['google']);
  const google = adapters.google!;
  const authorize = new URL(google.authorize(flow));
  assert.equal(authorize.origin, 'https://accounts.google.com');
  assert.equal(authorize.searchParams.get('state'), 'state');
  assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
  const exchange = () => google.exchange({ ...flow, code: 'provider-code' });
  const signed = (overrides: Record<string, string | number | undefined>, key = keys.privateKey) => new SignJWT({
    iss: 'https://accounts.google.com', aud: 'google-client', sub: 'stable-sub', nonce: 'nonce',
    exp: Math.floor(Date.now() / 1000) + 120, ...overrides,
  }).setProtectedHeader({ alg: 'RS256', kid: 'google-key' }).sign(key);
  idToken = await signed({});
  assert.deepEqual(await exchange(), { provider: 'google', subject: 'stable-sub' });
  for (const wrong of [{ iss: 'https://different.example' }, { aud: 'another-client' }, { exp: 1 }, { nonce: 'other' }, { azp: 'other' }]) {
    idToken = await signed(wrong);
    assert.equal(await exchange(), undefined);
  }
  idToken = await signed({}, foreign.privateKey);
  assert.equal(await exchange(), undefined);
  assert.equal(responses.filter(url => url.includes('/certs')).length, 1);
});
