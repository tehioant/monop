# App telemetry

Both channels are **off by default** and configured independently at Expo bundle time. Set variables in the app's build environment (or an untracked `packages/app/.env.local` for local development) and rebuild/rebundle to change them. An absent, blank or unsupported DSN disables that channel; there is no fallback project. Use the public HTTPS project DSN from **Client Keys (DSN)**: a hexadecimal public key, DNS host and numeric project ID, with no password, query or fragment. An optional port and simple path prefix are accepted. `EXPO_PUBLIC_` values are visible in the shipped JS. Never put `SENTRY_AUTH_TOKEN`, a privileged API token, or any password in them. No upload token or source-map upload is configured by this change.

| Setting | Destination and data |
| --- | --- |
| `EXPO_PUBLIC_SENTRY_DSN` | Sentry crash reporting. The Expo root only loads and initializes `@sentry/react-native` after validating this DSN. Use a current installed Expo native build to verify native capture; Expo Go is not a native-crash acceptance environment. |
| `EXPO_PUBLIC_SENTRY_ANALYTICS_DSN` | A Sentry project supporting [direct OTLP Logs](https://docs.sentry.io/concepts/otlp/direct/logs), ideally separate from the crash project. Only two game lifecycle events use this transport. No other app logs are forwarded. |

## Analytics data and counts

The only product fields are `game started` or `game finished`, `mode` (`solo` or `online`), `countries_to_win` and `player_count` (all seats, including bots). The app constructs a fresh OTLP record from supported options. It sends no guest/account/player/install identifier (including hashes), name, token, seed, room code, winner, move or card history, or trace/span ID. This path uses direct HTTPS JSON with credentials omitted, not the crash SDK. The project key is public routing/auth metadata; the JSON includes OTLP containers, an event timestamp and `info` severity. The receiving infrastructure can still observe IP and HTTP metadata such as user agent, and may generate its own storage IDs or add ingestion metadata. Review Sentry's IP handling, data scrubbing, access and retention settings before use; the client cannot guarantee how the service handles transport metadata.

- **Solo:** Start and rematch count after the device save succeeds. A finish counts when an active game reaches `over` and the save cleanup succeeds. Loading/retrying a save, abandoning, viewing results and tutorial play do not create events. An actual finish after resuming can still count.
- **Online:** Start counts for a successfully joined or created lobby when the app adopts its first game state (version 1). A restored seat, host tap, or resync does not itself count. A finish counts on the first accepted terminal state for the observed room, including one first seen after resync. Deduplication is local and in memory. Multiple players can each report the same match, and offline use or a missed terminal packet can undercount. These are app observations, not a globally unique match census or a matched start-to-finish funnel.

Requests are best-effort: no app queue, retry, blocking await, or game/persistence error on delivery failure. Use aggregated counts, not individual histories.

## Crash privacy and limits

JS exception reports keep a Sentry event ID/timestamp, severity, a bounded error type, handled status, and stack line/column numbers with fixed bundle names. The hook drops raw exception text, dynamic frame names and paths, breadcrumbs, URLs, user/context, tags and attachments. This loses detail; stack coordinates are still useful for diagnosing recurring failures. Crash options disable default PII, sessions, SDK logs, tracing/propagation, replay, screenshots, view hierarchy and NDK scope sync. Atlas does not set a Sentry user or session. Native Sentry crash collection is initialized from JS, not from a pre-JS native options file. A crash before that initialization is not covered. A native fatal report does not pass through the JS hook: native SDK diagnostics can include app/build, OS/device context, SDK-generated identifiers, stacks and native exception text. Do not add sensitive data to native errors, and verify raw native samples and Sentry-side scrubbing (including IP and device/user fields) before enabling any production project.

## Human acceptance (not run by the local source check)

1. On installed iOS and Android builds with both variables absent, confirm startup and ordinary play, with no Sentry initialization or network traffic from the app. Check Expo's generated native dependency linkage when building; do not configure early native startup or source-map upload for this ticket.
2. With approved test projects only, enable crash reporting and explicitly trigger a controlled JS exception and native fatal crash in a disposable test build. Relaunch where needed for delivery. Check the observed JS and native reports and privacy settings separately; remove any test trigger before building production. Confirm a disabled build does not generate them.
3. With Logs enabled for the approved analytics project, verify one visible record for a saved solo start/finish and a newly adopted online start/finish; rematch is a new start. Spot-check a solo reload/abandon, tutorial and online seat resume/duplicate state for no extra start/finish. Inspect the raw submitted fields and server-side enrichment. Check a refused save and disabled analytics build send nothing.

Offline Expo bundles and mocked checks do not verify an installed build, native crash contents, or live ingestion. Build profiles are separate (#31).
