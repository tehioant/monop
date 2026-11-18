import assert from 'node:assert/strict';
import test from 'node:test';
import { loadComponent } from './componentBoundary.ts';

const src = new URL('../src/', import.meta.url).pathname;
const verifier = 'A'.repeat(43), code = 'c'.repeat(43), token = 't'.repeat(43);

function fixture(callback: unknown, serverUrl = 'wss://game.example.test/ws', bytes = new Uint8Array(32), expected = verifier) {
  const requests: Array<{ url: string; headers: unknown; body: unknown }> = [];
  const client = loadComponent(`${src}account/client.ts`, {
    './config.ts': { serverUrl },
    'expo-crypto': {
      getRandomBytesAsync: async (count: number) => { assert.equal(count, 32); return bytes; },
      digestStringAsync: async (_alg: string, value: string) => {
        assert.equal(value, expected);
        return `${'B'.repeat(43)}=`;
      },
      CryptoDigestAlgorithm: { SHA256: 'SHA-256' }, CryptoEncoding: { BASE64: 'base64' },
    },
    'expo-web-browser': { openAuthSessionAsync: async (url: string, redirect: string) => {
      assert.equal(url, 'https://accounts.google.com/o/oauth2/v2/auth?state=opaque');
      assert.equal(redirect, 'atlas://account-auth');
      return callback;
    } },
  }).accountClient(async (url: string, options: RequestInit) => {
    const body = options.body ? JSON.parse(String(options.body)) : undefined;
    requests.push({ url, headers: options.headers, body });
    if (url.endsWith('/begin')) return Response.json({ url: 'https://accounts.google.com/o/oauth2/v2/auth?state=opaque' });
    return Response.json({ name: 'Original name', token });
  });
  return { client, requests };
}

test('native restoration presents the provider and redeems a device-bound code over HTTPS, not in the redirect', async () => {
  const f = fixture({ type: 'success', url: `atlas://account-auth#code=${code}` });
  assert.deepEqual(await f.client.signIn('google', 'restore', null), { token, name: 'Original name' });
  assert.deepEqual(f.requests.map(r => [r.url, r.body]), [
    ['https://game.example.test/account/begin', { provider: 'google', mode: 'restore', challenge: 'B'.repeat(43) }],
    ['https://game.example.test/account/redeem', { code, verifier }],
  ]);
});

test('cancelled or unrelated native callbacks never submit a code; insecure game configuration never transmits a token', async () => {
  const cancelled = fixture({ type: 'cancel' });
  assert.equal(await cancelled.client.signIn('google', 'link', token), undefined);
  assert.equal(cancelled.requests.length, 1);
  assert.deepEqual(cancelled.requests[0]?.headers, { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` });
  const unrelated = fixture({ type: 'success', url: `atlas://elsewhere#code=${code}` });
  await assert.rejects(unrelated.client.signIn('google', 'restore', null));
  assert.equal(unrelated.requests.length, 1);
  const insecure = fixture({ type: 'cancel' }, 'ws://game.example.test/ws');
  await assert.rejects(insecure.client.signIn('google', 'link', token));
  assert.deepEqual(insecure.requests, []);
});


test('native sign-in encodes all 32 verifier bytes without a browser base64 global', async t => {
  t.mock.method(globalThis, 'btoa', () => assert.fail('used the unavailable browser encoder'));
  Object.defineProperty(globalThis, 'btoa', { value: undefined });
  for (const [bytes, expected] of [
    [new Uint8Array(32), 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'],
    [Uint8Array.from({ length: 32 }, (_, i) => 255 - i), '__79_Pv6-fj39vX08_Lx8O_u7ezr6uno5-bl5OPi4eA'],
  ] as const) {
    const f = fixture({ type: 'success', url: `atlas://account-auth#code=${code}` }, undefined, bytes, expected);
    await f.client.signIn('google', 'restore', null);
    assert.deepEqual(f.requests[1]?.body, { code, verifier: expected });
    assert.match(expected, /^[A-Za-z0-9_-]{43}$/);
  }
});
