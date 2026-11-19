# Set-collection card game — mobile app plan (draft 2)

Codename: **Atlas** (working title; needs a trademark check before anything public).

## 1. Product

A fast card game for 2–5 players in the property set-collection genre, themed on the world: collect cities to complete countries, charge opponents, steal and swap, block with counters. Quick (~10–15 min) or long (~25–30 min) games depending on the win setting. Original name, card list, wording and art.

- **Platforms:** iOS + Android, one codebase (React Native + Expo, TypeScript).
- **Modes at launch:** solo vs bots (offline), online multiplayer with friends (private rooms).
- **Goal:** public release on App Store and Play Store.

### IP guardrails

Game mechanics are free to use; names, card text, art and trade dress are not.

- No Monopoly/Hasbro names, property names, board colour mapping, card titles or card layouts.
- Own rule wording, own deck distribution, own visual identity.
- Store listing never references the inspiration ("like Monopoly Deal") in title, subtitle, keywords or screenshots.
- At least two mechanics of our own (see §2) so it is a distinct game, not a reskin.

## 2. Game design (first pass, all numbers tunable)

**Theme:** the world. Each set is a **country**, each card in it a **city** of that country. Draft list of 10 countries (set size 2–4): France, UK, Italy, USA, Brazil, China, Australia, Japan, India, Egypt. Example: France = Paris, Lyon, Marseille.

**Win condition:** first player to control **N complete countries**, with N chosen by the host when starting a game:

| Setting | N | Target length |
|---|---|---|
| Quick (default) | 3 | 10–15 min |
| Long | 5 | 25–30 min |

10 countries are needed so that 5 is reachable. Whether Long works at 5 players (half the map for one player) is checked by simulation; if not, Long is limited to 2–4 players.

**Turn:**
1. Draw 2 cards — from the deck or from the **Market** (3 face-up cards, refilled immediately). *Own mechanic #1.*
2. Play up to 3 cards: lay a city, bank a card as coin, or play an action.
3. Discard down to 7.

**Card types (~100 cards):**

| Type | Role | Draft examples |
|---|---|---|
| City | Belongs to one of 10 countries; a country needs 2–4 cities | Paris, Shanghai, Sydney, Rio… |
| Wild city | Counts for two countries, or any | Global Hub |
| Coin | Bank value 1–10; any card can be banked for its printed value | — |
| Toll | Charge every opponent for one country you hold cities in; scales with set progress | — |
| Raid | Take one city that is not in a complete country | — |
| Exchange | Forced swap of one city each | — |
| Seizure | Take a complete country (2 copies only) | — |
| Levy / Debt | All players / one player pay a fixed amount | — |
| Veto | Cancels an action played against you; can be vetoed back | — |
| Windfall | Draw 2 extra cards | — |
| Upgrade | Attach to a complete country to raise its toll | Airport, Landmark |

**Country perks** *(own mechanic #2)*: each complete country grants a passive ability while held, e.g. draw 3 instead of 2, play 4 cards per turn, your first Veto each game returns to your hand. Which perk goes to which country is assigned during balancing and kept neutral (no national stereotypes). This makes which countries you chase a strategic choice rather than a pure race.

**Payment rules:** pay from bank and/or laid cities, no change given, payer chooses cards; cities received go straight to the table.

**Balancing:** exact counts and values are decided by bot self-play simulation (thousands of games through the engine CLI), run for both win settings, targeting game length, first-player win rate ≈ 1/players and no dominant country.

## 3. Scope

**MVP (store launch)**
- Full rules engine, 2–5 players, win setting (3 or 5 countries) per game
- Bots: easy / normal / hard (heuristic)
- Online private rooms: room code + invite link, turn timer, reconnect, bot takeover on disconnect
- Guest accounts, optional Sign in with Apple / Google
- Interactive tutorial, rules reference, action log
- Settings, haptics, sound, EN + FR
- Account deletion, privacy policy, crash reporting

**After launch**
- Public matchmaking and ranking
- Friends list, rematch, emotes
- Cosmetics (card backs, table themes), stats and achievements
- Tablet layout, spectators, async (push-notified) games

**Out of scope:** in-game free-text chat (moderation cost), real-money anything, web client.

## 4. Architecture

```
repo (pnpm workspaces, TypeScript)
├─ packages/engine   pure rules: (state, action) -> state, seeded RNG, no I/O
├─ packages/bots     policies built on the engine
├─ apps/mobile       Expo app
└─ apps/server       Node game server
```

**Engine (the core asset)**
- Deterministic reducer; `legalActions(state, player)` drives UI, bots and server validation from one source.
- Explicit phases for interrupts: `awaitingPayment`, `awaitingVeto`, `awaitingDiscard`.
- `viewFor(state, player)` strips hidden information (other hands, deck order).
- Tested with unit tests per card plus property-based invariants (card conservation: every card is in exactly one zone).
- Card definitions are data (JSON/TS), so balancing does not touch logic.
- Game options (`setsToWin: 3 | 5`, player count) are part of the initial state, fixed at game creation and visible to all players.

**Mobile**
- Expo + expo-router, Reanimated + Gesture Handler for card drag/animations, expo-haptics, expo-av.
- State: engine state in a small store (Zustand); solo games run the engine locally and persist to disk for resume.
- EAS Build / Submit; EAS Update for JS-only fixes.

**Server**
- Node + Fastify + `ws`, Postgres. One process holds live rooms in memory, snapshots to Postgres on each turn so a restart does not kill games.
- Server-authoritative: clients send intents, server validates with the engine and pushes per-player views. No hidden data ever reaches the wrong client.
- Protocol: versioned JSON messages, monotonically increasing state version, full-view resync on reconnect.
- Hosting: single small instance (Fly.io or Render) + managed Postgres. Turn-based traffic is tiny; horizontal scaling is deferred until needed.
- Alternative considered: Supabase (Realtime + Edge Functions) — less ops, but game logic in edge functions with hidden state is awkward. Rejected for now.

**Accounts**
- Guest by default (device-bound token), upgrade to Apple/Google sign-in. Apple sign-in is mandatory once Google sign-in is offered.

**Bots**
- Heuristic scoring of legal actions (set progress, threat of opponents, bank safety, hold Veto for Seizure). Difficulty = heuristic depth + mistake rate.
- Same bots fill in for disconnected online players.
- Later, if needed: determinized Monte Carlo search for "hard".

## 5. Screens

Home · New solo game (players, difficulty, countries to win) · Create/join room (host picks countries to win) · Lobby (shows the setting) · **Table** (hand, own sets, bank, opponents' areas, market, action log, turn timer) · Target/payment/veto prompts · Results · Tutorial · Rules · Settings · Account.

The table is the hard design problem: up to 5 players' sets on a phone. Plan: own area always expanded, opponents as compact summaries (set progress pips + bank total) that expand on tap. Portrait only for MVP.

## 6. Milestones (one developer, rough)

| # | Deliverable | Est. |
|---|---|---|
| M0 | Rules doc v1, card list, paper playtest | 1–2 wk |
| M1 | Engine + tests + CLI simulator | 2–3 wk |
| M2 | Bots, self-play balancing, rules v2 | 1–2 wk |
| M3 | Mobile app: solo vs bots, playable end to end with placeholder art | 3–4 wk |
| M4 | Server, private rooms, reconnect, bot takeover | 3–4 wk |
| M5 | Art pass, tutorial, sound, accounts, localization, store compliance | 3–4 wk |
| M6 | TestFlight / Play closed beta, fixes, launch | 2–3 wk |

Total ≈ 4–5 months. M1–M3 give a fun offline game with no backend cost; online is added on a proven ruleset.

## 7. Store release checklist

- Trademark search on the final name; app name, icon and screenshots free of third-party IP
- Privacy policy, data-safety forms, in-app account deletion
- Age rating (no gambling mechanics, no user-generated text)
- Play Store: 12 testers for 14 days closed test before production (new personal accounts)
- Crash reporting (Sentry) and minimal analytics (game started/finished, retention)

## 8. Risks

| Risk | Mitigation |
|---|---|
| Too close to the inspiration | §1 guardrails, own mechanics, legal read of the store listing before submission |
| Table UI unreadable at 5 players | Prototype the table in M3 week 1; cap at 4 players if it fails |
| Interrupt flow (veto chains, payments) is bug-prone | Explicit engine phases, property-based tests, replayable action logs |
| Empty lobbies at launch | Private rooms + bots first; public matchmaking only once there is an audience |
| Art cost | Icon-driven, typographic card design; one visual identity per country (10), not one illustration per card |
| Real-world sensitivities | No disputed territories or cities, neutral perks, own stylised art rather than official emblems |

## 9. Open decisions

1. Final name; final list of 10 countries and their cities (Japan, India, Egypt are my additions to your list).
2. Monetization: paid app, free + cosmetics IAP, or free + ads with a one-time removal. Recommendation: free, no ads, cosmetics after launch.
3. Art: commission an illustrator, or a purely graphic style done in-house.
4. Player cap: 4 or 5.
5. Keep both own mechanics (Market, country perks) or start with one to simplify balancing.
