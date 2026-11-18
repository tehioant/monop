import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadComponent } from './componentBoundary.ts';

const dsn = 'https://0123456789abcdef0123456789abcdef@telemetry.invalid/prefix/123';

function tracker(value: string | undefined, fetch: (url: string, request: RequestInit) => Promise<unknown>) {
  const env = 'EXPO_PUBLIC_SENTRY_ANALYTICS_DSN';
  const previous = process.env[env];
  if (value === undefined) delete process.env[env]; else process.env[env] = value;
  try {
    return loadComponent(new URL('../src/telemetry/analytics.ts', import.meta.url).pathname, {
      'expo/fetch': { fetch },
    }).trackGame as (name: unknown, mode: unknown, settings: { countriesToWin: unknown; players: unknown }) => void;
  } finally {
    if (previous === undefined) delete process.env[env]; else process.env[env] = previous;
  }
}

test('analytics sends only allowlisted fields in the actual OTLP request, with no identity or SDK scope', (t) => {
  const fallback = t.mock.method(globalThis, 'fetch', async () => { throw Error('wrong transport'); });
  const requests: [string, RequestInit][] = [];
  const track = tracker(dsn.replace('https://', 'HTTPS://').replace('telemetry.invalid/prefix', 'TELEMETRY.INVALID:8443/Prefix'), async (url, init) => { requests.push([url, init]); });
  const settings = { countriesToWin: 3, players: 2, token: 'private', seed: 99 };
  track('game started', 'solo', settings);
  track('game finished', 'online', settings);
  assert.equal(fallback.mock.callCount(), 0);
  assert.equal(requests.length, 2);
  for (const [[url, request], name, mode] of [
    [requests[0]!, 'game started', 'solo'],
    [requests[1]!, 'game finished', 'online'],
  ] as const) {
    assert.equal(url, 'https://telemetry.invalid:8443/Prefix/api/123/integration/otlp/v1/logs');
    assert.equal(request.method, 'POST');
    assert.equal(request.credentials, 'omit');
    assert.equal(request.redirect, 'error');
    assert.deepEqual(request.headers, {
      'Content-Type': 'application/json',
      'X-Sentry-Auth': 'sentry sentry_key=0123456789abcdef0123456789abcdef',
    });
    const payload = JSON.parse(String(request.body));
    const record = payload.resourceLogs[0].scopeLogs[0].logRecords[0];
    assert.match(record.timeUnixNano, /^\d{19}$/);
    assert.deepEqual(payload, { resourceLogs: [{ scopeLogs: [{ logRecords: [{
      timeUnixNano: record.timeUnixNano, severityText: 'info', body: { stringValue: name }, attributes: [
        { key: 'mode', value: { stringValue: mode } },
        { key: 'countries_to_win', value: { intValue: '3' } },
        { key: 'player_count', value: { intValue: '2' } },
      ],
    }] }] }] });
  }
});

test('missing or invalid configuration and unsupported event values send nothing', (t) => {
  const fallback = t.mock.method(globalThis, 'fetch', async () => { throw Error('wrong transport'); });
  const requests: string[] = [];
  const send = async (url: string) => { requests.push(url); };
  for (const value of [undefined, '', 'https://telemetry.invalid/123', dsn.replace('https:', 'http:'), dsn + '?token=private', dsn.replace('@', ':password@'), dsn.replace('telemetry.invalid', '256.256.256.256')]) {
    tracker(value, send)('game started', 'solo', { countriesToWin: 3, players: 2 });
  }
  const track = tracker(dsn, send);
  for (const [name, mode, countriesToWin, players] of [
    ['other', 'solo', 3, 2], ['game started', 'tutorial', 3, 2],
    ['game started', 'solo', '3', 2], ['game finished', 'online', 4, 2],
    ['game finished', 'online', 3, NaN], ['game started', 'solo', 3, 6],
  ]) track(name, mode, { countriesToWin, players });
  assert.equal(fallback.mock.callCount(), 0);
  assert.deepEqual(requests, []);
});

test('analytics contains synchronous and rejected transport failures', async (t) => {
  const fallback = t.mock.method(globalThis, 'fetch', async () => { throw Error('wrong transport'); });
  let calls = 0;
  for (const send of [() => { calls++; throw Error('private'); }, async () => { calls++; throw Error('private'); }]) {
    assert.doesNotThrow(() => tracker(dsn, send)('game started', 'solo', { countriesToWin: 3, players: 2 }));
  }
  assert.equal(calls, 2);
  assert.equal(fallback.mock.callCount(), 0);
  // Node would report an unhandled rejection from this test as a failure.
  await new Promise<void>(resolve => setImmediate(resolve));
});
