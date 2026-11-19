import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ErrorEvent, ReactNativeOptions } from '@sentry/react-native';
import { loadComponent } from './componentBoundary.ts';

const DSN = 'https://0123456789abcdef0123456789abcdef@telemetry.invalid/123';
const layout = new URL('../src/app/_layout.tsx', import.meta.url).pathname;

function boot(value: string | undefined, sdk: object, fetch?: (...args: unknown[]) => unknown) {
  const key = 'EXPO_PUBLIC_SENTRY_DSN';
  const previous = process.env[key];
  if (value === undefined) delete process.env[key]; else process.env[key] = value;
  try {
    return loadComponent(layout, {
      'expo-router': { Stack: Object.assign(() => {}, { Screen: () => {} }) },
      '../i18n/locale.tsx': { LocaleProvider: () => {} },
      '@sentry/react-native': sdk,
      'expo/fetch': { fetch },
    }).default();
  } finally {
    if (previous === undefined) delete process.env[key]; else process.env[key] = previous;
  }
}

test('Expo root renders with crash reporting off, only initializes a valid project, and survives SDK failure', () => {
  const initialized: string[] = [];
  const sdk = { init: ({ dsn }: { dsn: string }) => { initialized.push(dsn); throw Error('private'); } };
  for (const value of [undefined, '', 'not configured', DSN.replace('@', ':password@'), DSN.replace('telemetry.invalid', '256.256.256.256')]) assert.ok(boot(value, sdk));
  assert.deepEqual(initialized, []);
  assert.ok(boot(DSN, sdk));
  const withPrefix = DSN.replace('telemetry.invalid/', 'telemetry.invalid:8443/Prefix/');
  assert.ok(boot(withPrefix.replace('https://', 'HTTPS://').replace('telemetry.invalid', 'TELEMETRY.INVALID'), sdk));
  assert.deepEqual(initialized, [DSN, withPrefix]);
});

test('crash init disables capture extras and keeps only scrubbed JS crash diagnostics', () => {
  let options: ReactNativeOptions | undefined;
  assert.ok(boot(DSN, { init: (value: ReactNativeOptions) => { options = value; } }));
  assert.ok(options);
  assert.equal(options.dsn, DSN);
  for (const key of ['enableNative', 'autoInitializeNativeSdk', 'enableNativeCrashHandling',
    'debug', 'enableNativeNagger', 'sendDefaultPii', 'enableLogs', 'enableAutoSessionTracking', 'sendClientReports',
    'attachScreenshot', 'attachViewHierarchy', 'enableAutoPerformanceTracing', 'enableNdkScopeSync'] as const) {
    assert.equal(options[key], false, key);
  }
  const hint = { attachments: [{ filename: 'private', data: 'private' }] };
  const event: ErrorEvent = {
    type: undefined, event_id: 'e'.repeat(32), release: 'app@1', platform: 'javascript', level: 'fatal',
    user: { id: 'private' }, request: { url: 'https://example.invalid/private' },
    tags: { room: 'private' }, extra: { state: 'private' }, contexts: { trace: { trace_id: 'private', span_id: 'private' } },
    breadcrumbs: [{ message: 'private' }], message: 'private',
    exception: { values: [{ type: 'Custom private', value: 'private', mechanism: { type: 'onerror', handled: false, data: { secret: 'private' } },
      stacktrace: { frames: [{ filename: 'https://example.invalid/private?token=private', function: 'private', lineno: 42, colno: 9 }] } }] },
  };
  assert.equal(options.beforeBreadcrumb?.({ message: 'private' }), null);
  const report = options.beforeSend?.(event, hint);
  assert.ok(report);
  assert.ok(!JSON.stringify(report).includes('private'));
  assert.deepEqual(hint.attachments, []);
  assert.ok('exception' in report);
  assert.equal(report.event_id, 'e'.repeat(32));
  assert.deepEqual(report.exception?.values?.[0]?.stacktrace?.frames, [{ filename: 'app:///main.jsbundle', lineno: 42, colno: 9 }]);
});

test('crash envelopes use Expo fetch with credentials omitted and redirects rejected', async (t) => {
  const globalFetch = t.mock.method(globalThis, 'fetch', () => { throw Error('unexpected global fetch'); });
  const fetch = t.mock.fn(async (_input: unknown, _init: unknown) => new Response(null, { status: 202 }));
  let options: ReactNativeOptions | undefined;
  assert.ok(boot(DSN, { init: (value: ReactNativeOptions) => { options = value; } }, fetch));
  assert.ok(options?.transport, 'Sentry must not choose its default transport');
  const url = 'https://telemetry.invalid/api/123/envelope/';
  const transport = options.transport({ url, recordDroppedEvent: () => {} });
  const payload: ErrorEvent = { type: undefined, event_id: 'a'.repeat(32), platform: 'javascript' };
  const envelopeHeaders = { event_id: 'a'.repeat(32), sent_at: '2026-01-01T00:00:00.000Z' };
  assert.equal((await transport.send([envelopeHeaders, [[{ type: 'event' }, payload]]])).statusCode, 202);
  assert.equal(globalFetch.mock.callCount(), 0);
  assert.equal(fetch.mock.callCount(), 1);
  assert.deepEqual(fetch.mock.calls[0]?.arguments, [url, {
    method: 'POST', credentials: 'omit', redirect: 'error',
    headers: { 'Content-Type': 'application/x-sentry-envelope' },
    body: `${JSON.stringify(envelopeHeaders)}\n{"type":"event"}\n${JSON.stringify(payload)}`,
  }]);
  assert.equal(await transport.flush(), true);
});
