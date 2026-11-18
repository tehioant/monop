import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGameAnalytics } from '../src/telemetry/analytics.ts';

const dsn = 'https://0123456789abcdef0123456789abcdef@telemetry.invalid/prefix/123';

test('analytics sends only allowlisted fields in the actual OTLP request, with no identity or SDK scope', () => {
  const requests: [string, RequestInit][] = [];
  const track = createGameAnalytics(dsn, async (url, init) => { requests.push([url, init]); });
  const settings = { countriesToWin: 3, players: 2, token: 'private', seed: 99 };
  track('game started', 'solo', settings);
  track('game finished', 'online', settings);
  assert.equal(requests.length, 2);
  for (const [[url, request], name, mode] of [
    [requests[0]!, 'game started', 'solo'],
    [requests[1]!, 'game finished', 'online'],
  ] as const) {
    assert.equal(url, 'https://telemetry.invalid/prefix/api/123/integration/otlp/v1/logs');
    assert.equal(request.method, 'POST');
    assert.equal(request.credentials, 'omit');
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

test('missing or invalid configuration and unsupported event values send nothing', () => {
  const requests: string[] = [];
  const send = async (url: string) => { requests.push(url); };
  for (const value of [undefined, '', 'https://telemetry.invalid/123', dsn.replace('https:', 'http:'), dsn + '?token=private', dsn.replace('@', ':password@')]) {
    createGameAnalytics(value, send)('game started', 'solo', { countriesToWin: 3, players: 2 });
  }
  const track = createGameAnalytics(dsn, send);
  for (const [name, mode, countriesToWin, players] of [
    ['other', 'solo', 3, 2], ['game started', 'tutorial', 3, 2],
    ['game started', 'solo', '3', 2], ['game finished', 'online', 4, 2],
    ['game finished', 'online', 3, NaN], ['game started', 'solo', 3, 6],
  ]) track(name, mode, { countriesToWin, players });
  assert.deepEqual(requests, []);
});

test('analytics contains synchronous and rejected transport failures', async () => {
  for (const send of [() => { throw Error('private'); }, async () => { throw Error('private'); }]) {
    assert.doesNotThrow(() => createGameAnalytics(dsn, send)('game started', 'solo', { countriesToWin: 3, players: 2 }));
  }
  // Node would report an unhandled rejection from this test as a failure.
  await new Promise<void>(resolve => setImmediate(resolve));
});
