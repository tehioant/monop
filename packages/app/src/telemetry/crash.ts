import type { ErrorEvent, ReactNativeOptions } from '@sentry/react-native';
import { sentryProject } from './dsn.ts';

const standardErrorTypes = ['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError', 'EvalError'];

function scrubCrash(event: ErrorEvent): ErrorEvent | null {
  const values = event.exception?.values;
  if (!values?.length) return null;
  return {
    type: undefined,
    event_id: event.event_id,
    timestamp: event.timestamp,
    platform: 'javascript',
    level: event.level === 'fatal' ? 'fatal' : 'error',
    exception: {
      values: values.map(({ type, mechanism, stacktrace }) => ({
        type: type && standardErrorTypes.includes(type) ? type : 'Error',
        value: 'Error details removed',
        mechanism: { type: 'generic', handled: mechanism?.handled !== false },
        stacktrace: stacktrace && {
          frames: stacktrace.frames?.map(({ filename, lineno, colno }) => ({
            // Keep bundle coordinates, never a route, source path, URL or dynamic function name.
            filename: filename?.endsWith('index.android.bundle') ? 'app:///index.android.bundle' : 'app:///main.jsbundle',
            lineno,
            colno,
          })),
        },
      })),
    },
  };
}

export function initializeCrashReporting(): void {
  const project = sentryProject(process.env.EXPO_PUBLIC_SENTRY_DSN);
  if (!project) return;
  try {
    // Resolve the SDK only when opted in, so a missing/broken native module cannot block boot.
    const sdk: typeof import('@sentry/react-native') = require('@sentry/react-native');
    const options: ReactNativeOptions = {
      dsn: project.dsn,
      // Native reports and cached envelopes do not pass through the JS privacy hook.
      enableNative: false,
      autoInitializeNativeSdk: false,
      enableNativeCrashHandling: false,
      debug: false,
      enableNativeNagger: false,
      sendDefaultPii: false,
      sendClientReports: false,
      enableLogs: false,
      enableAutoSessionTracking: false,
      enableAutoPerformanceTracing: false,
      enableWatchdogTerminationTracking: false,
      enableAppHangTracking: false,
      enableCaptureFailedRequests: false,
      enableNdkScopeSync: false,
      tracePropagationTargets: [],
      attachScreenshot: false,
      attachViewHierarchy: false,
      maxBreadcrumbs: 0,
      transport: (options) => {
        const { createTransport }: typeof import('@sentry/core') = require('@sentry/core');
        const { fetch }: typeof import('expo/fetch') = require('expo/fetch');
        return createTransport(options, async ({ body }) => {
          const response = await fetch(options.url, {
            method: 'POST', credentials: 'omit', redirect: 'error',
            headers: { 'Content-Type': 'application/x-sentry-envelope' },
            body: typeof body === 'string' ? body : new Uint8Array(body),
          });
          return { statusCode: response.status, headers: {
            'x-sentry-rate-limits': response.headers.get('X-Sentry-Rate-Limits'),
            'retry-after': response.headers.get('Retry-After'),
          } };
        });
      },
      beforeBreadcrumb: () => null,
      beforeSend: (event, hint) => {
        hint.attachments = [];
        return scrubCrash(event);
      },
    };
    sdk.init(options);
  } catch { /* Crash reporting is optional; SDK failures must not interrupt boot. */ }
}
