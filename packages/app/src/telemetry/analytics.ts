import { RULES } from '@atlas/engine';
import { sentryProject } from './dsn.ts';

type Send = (url: string, init: RequestInit) => Promise<unknown>;
type Settings = { countriesToWin: unknown; players: unknown };

export function createGameAnalytics(dsn: string | undefined, send: Send = (url, init) => fetch(url, init)) {
  const project = sentryProject(dsn);
  return (name: unknown, mode: unknown, settings: Settings): void => {
    if (!project || (name !== 'game started' && name !== 'game finished') || (mode !== 'solo' && mode !== 'online')) return;
    const { countriesToWin, players } = settings;
    if (typeof countriesToWin !== 'number' || !RULES.countriesToWin.includes(countriesToWin) ||
      typeof players !== 'number' || !RULES.playerCounts.includes(players)) return;

    try {
      // Direct OTLP Logs does not require trace/span IDs or SDK scope, resource or user data.
      const record = {
        timeUnixNano: `${Date.now()}000000`, severityText: 'info', body: { stringValue: name },
        attributes: [
          { key: 'mode', value: { stringValue: mode } },
          { key: 'countries_to_win', value: { intValue: String(countriesToWin) } },
          { key: 'player_count', value: { intValue: String(players) } },
        ],
      };
      void send(`${project.apiBase}/integration/otlp/v1/logs`, {
        method: 'POST', credentials: 'omit',
        headers: { 'Content-Type': 'application/json', 'X-Sentry-Auth': `sentry sentry_key=${project.publicKey}` },
        body: JSON.stringify({ resourceLogs: [{ scopeLogs: [{ logRecords: [record] }] }] }),
      }).catch(() => {});
    } catch { /* Telemetry must never block a game action. */ }
  };
}

export const trackGame = createGameAnalytics(process.env.EXPO_PUBLIC_SENTRY_ANALYTICS_DSN);
