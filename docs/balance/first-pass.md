# First balance pass

Card data tuned on bot-only games (issue 14). All the numbers tuned here are in `packages/engine/src/data.ts`.

## Outcome

- **Deck: 88 to 121 cards.** The 38 cities are untouched. Coin cards go from 20 to 40; Levy, Debt, Raid, Exchange and
  Veto from 3 to 5 copies; Toll from 6 to 10. Nothing else changed: no rule, no amount, no perk, no toll scale.
- **Quick game (3 countries): 11 to 15 minutes** for 2 to 5 players (was 7 to 10). On target; a minute over at five
  players when the bots are hard or easy.
- **Long game (5 countries): 15 to 23 minutes** (was 10 to 16). Short of the 25–30 target, and data cannot close the
  gap without pushing the quick game over its own: see "Long game" below.
- **The first player still wins too often** (58% at two players, 33% at four). No card data changes that; it takes a
  rule change, described below and not made.
- **No country dominates**: holding any given country goes with about the same win rate. The two 2-city countries are
  in most winning sets because they are the cheapest; a possible correction is described below.
- **5 countries to win stays offered at 5 players.** No cap, so no engine change: the pass is data only.

## Method

- Simulator: `node packages/bots/src/cli.ts --games 3000 --players P --countries C --difficulty D` (seed 1). All
  seats play at the same level. Unless said otherwise the level is `normal`.
- 3000 games per line. At that size a seat's share is known to about ±1.7 points and a mean length to ±0.3 turn;
  smaller differences below are noise.
- "Before" is the card data of `main` at `cf59792`; "after" is this branch.
- A **turn** is one player's turn. **Minutes assume 30 seconds per turn.** A turn at four players is about 8 actions,
  everybody's included: two draws, about three plays, the end of the turn, and two payments or Veto answers from
  opponents. At 3 to 4 seconds an action on a phone (choose, tap, watch the card move) that is 25 to 32 seconds. It
  is the pace of a table of people. Bots play an action in about a second, so a solo game against bots takes
  roughly half the minutes given here.

## Before and after

Game length, normal bots (mean turns, and minutes at 30 seconds a turn):

| players | countries | before: turns | minutes | after: turns | minutes |
|---|---|---|---|---|---|
| 2 | 3 | 14.4 | 7.2 | 21.2 | 10.6 |
| 3 | 3 | 17.1 | 8.6 | 24.9 | 12.5 |
| 4 | 3 | 19.1 | 9.6 | 27.8 | 13.9 |
| 5 | 3 | 20.6 | 10.3 | 29.7 | 14.9 |
| 2 | 5 | 20.7 | 10.4 | 29.6 | 14.8 |
| 3 | 5 | 25.6 | 12.8 | 37.0 | 18.5 |
| 4 | 5 | 28.8 | 14.4 | 41.6 | 20.8 |
| 5 | 5 | 31.4 | 15.7 | 45.0 | 22.5 |

After, at the other two levels (mean turns for 2 / 3 / 4 / 5 players):

| level | 3 countries | minutes | 5 countries | minutes |
|---|---|---|---|---|
| hard | 21.7 / 26.6 / 30.2 / 32.5 | 11 – 16 | 30.3 / 39.7 / 45.3 / 49.7 | 15 – 25 |
| easy | 22.4 / 26.4 / 29.3 / 31.9 | 11 – 16 | 31.4 / 39.5 / 45.1 / 49.9 | 16 – 25 |

Games won by seat, normal bots (%; seat 0 plays first):

| players | countries | before | after |
|---|---|---|---|
| 2 | 3 | 60.8 / 39.2 | 57.7 / 42.3 |
| 3 | 3 | 44.2 / 31.0 / 24.8 | 41.8 / 31.8 / 26.4 |
| 4 | 3 | 33.9 / 26.3 / 20.7 / 19.1 | 33.1 / 26.8 / 20.9 / 19.1 |
| 5 | 3 | 29.1 / 21.5 / 18.0 / 15.3 / 16.0 | 27.5 / 22.2 / 18.0 / 16.9 / 15.4 |
| 2 | 5 | 61.1 / 38.9 | 58.3 / 41.7 |
| 3 | 5 | 42.1 / 32.0 / 25.9 | 40.5 / 32.6 / 26.9 |
| 4 | 5 | 33.8 / 26.7 / 21.4 / 18.1 | 32.7 / 26.0 / 21.2 / 20.1 |
| 5 | 5 | 27.9 / 21.5 / 16.7 / 16.2 / 17.7 | 26.1 / 22.0 / 18.4 / 16.7 / 16.8 |

Countries at four players, normal bots. "In the winning set": share of winners holding the country complete (even
would be 30% at 3 countries, 50% at 5). "Win rate when held": share of the players holding it complete at the end
who won.

| countries (cities) | in the winning set, 3 to win: before, after | 5 to win: before, after | win rate when held, 3 to win: before, after |
|---|---|---|---|
| Egypt, Australia (2) | 60–61%, 57–59% | 74–75%, 71–76% | 63–64%, 61–63% |
| France, UK, Italy, Japan, Brazil (3) | 27–34%, 27–32% | 48–55%, 49–53% | 64–68%, 62–68% |
| USA, China, India (4) | 8–10%, 10–12% | 28–30%, 32–34% | 68–72%, 63–72% |

Other things that moved, at four players and 3 countries: 13.5 cities changed hands as payment per game before, 12.0
after, in a game half as long again (0.71 a turn against 0.43): banks now pay most charges in coin. With normal and
hard bots every game has a winner, before and after. With easy bots, 5 countries to win, games ending without a winner
went from 9 to 2 in 3000 at four players and from 80 to 7 at five.

## What the experiments showed

One change at a time on the "before" data, normal bots:

| change | turns at 2 players / 3 countries | 4 / 3 | 4 / 5 | first seat at 2 / 3 | at 4 / 3 |
|---|---|---|---|---|---|
| none | 14.4 | 19.1 | 28.8 | 60.8% | 33.9% |
| 30 coin cards | 17.0 | 22.8 | 34.0 | 62.3% | 33.9% |
| 36 coin cards | 18.1 | 25.0 | 37.4 | 59.1% | 34.1% |
| 44 coin cards | 20.1 | 28.0 | 41.7 | 57.6% | 33.7% |
| lower charges (Levy 1, Debt 3, tolls 1-2-3 and 1-2-3-4) | 15.1 | 20.3 | 31.2 | 60.5% | 34.8% |
| fewer charge cards (Toll 3, Levy 2, Debt 2) | 13.7 | 19.3 | 29.8 | 60.5% | 33.6% |
| no any-country wild city | 16.7 | 22.1 | 31.9 | 60.4% | 34.0% |
| draw and play perks moved off the 2-city countries | 15.3 | 20.2 | 30.1 | 59.7% | 34.0% |
| every perk the Veto return | 16.1 | 21.5 | 34.5 | 61.5% | 33.3% |
| Seizure x4 | 14.6 | 19.5 | 29.1 | 61.0% | 31.6% |
| Veto x6 | 15.2 | 20.1 | 30.6 | 62.4% | 33.8% |

- **The number of coin cards is the lever for length**: they come between the cities. Nothing else moves it much.
- **Coin alone makes long games stall.** Full banks pay every charge in coin, cities stop changing hands, and
  careless players bank the few cards that could still move them. Easy bots, 5 countries, games without a winner in
  3000 at four and five players: 9 and 80 before; 24 and 129 with 36 coin cards; 33 and 164 with 44. Adding the cards
  that take (Raid 5, Exchange 5, Seizure 3) and Veto 5 to the 36 coins: 1 and 52. Adding the charges too (Toll 10,
  Debt 5): 1 and 6. The deck kept (40 coins, Levy 5 as well, Seizure back at 2): 2 and 7. So the deck grows as a
  whole around the same cities.
- **Nothing in the data moves the first seat's share.**
- **The long game is about 1.5 times the quick one in every variant** (1.45 to 1.6).
- Which countries win is set by their size. Perks and tolls do not show: the win rate when held stays within a few
  points whichever perk a country carries.

## Decisions

**Card counts.** Coin 1 / 2 / 3 / 4 / 5 / 10: 6, 5, 3, 3, 2, 1 becomes 12, 10, 6, 6, 4, 2 (same mix, doubled). Levy,
Debt, Raid, Exchange, Veto: 3 becomes 5. Toll: 6 becomes 10. Forty coin cards is the most that keeps the quick game
at 15 minutes at five players with normal bots (16 with hard or easy ones).

**Kept as they were**, because no experiment gave a reason to move them: toll scales, the Levy and Debt amounts, the
upgrade amount, coin values, the wild cities, the perk of each country, Windfall x4 and Upgrade x3. Seizure stays at
2 copies: that number is an acceptance criterion of the Seizure ticket, and with normal bots a third copy changed
neither the length nor the seat shares.

**5 countries to win at 5 players: offered, no cap.** With the new data every game between normal or hard bots has a
winner, and the game is 8% longer than at four players (45.0 turns against 41.6), not a different game: 9 in 10
finish within 58 turns (29 minutes), 99 in 100 within 74. With hard bots it is the one setting that reaches the long
target (49.7 turns, 25 minutes). The weak spot is a table of careless players: 7 games in 3000 between easy bots
ended without a winner, and 1 in 100 lasted over 100 turns.

**First player.** Seat 0 always starts, and a game is 6 to 15 rounds: the first player has had one more turn than
the others for most of it. Longer games barely help (58% at two players after, 61% before). The smallest rule change
that evens it out is in the number of cards drawn at the start of a player's **first** turn (one line in
`startTurn`). Measured on the new data, on copies of the engine outside the repository, games won by seat:

| first turn | 2 players | 3 players | 4 players | 5 players |
|---|---|---|---|---|
| today: everyone draws 2 | 57.7 / 42.3 | 41.8 / 31.8 / 26.4 | 33.1 / 26.8 / 20.9 / 19.1 | 27.5 / 22.2 / 18.0 / 16.9 / 15.4 |
| the first player draws nothing | 47.9 / 52.1 | 34.4 / 36.2 / 29.3 | 26.0 / 29.5 / 22.9 / 21.6 | 20.8 / 25.1 / 18.8 / 17.1 / 18.2 |
| seat *s* draws *s* cards (0, 1, 2, 3, 4) | 53.6 / 46.4 | 36.1 / 33.7 / 30.2 | 25.7 / 24.8 / 24.6 / 24.9 | 18.8 / 20.4 / 20.0 / 18.6 / 22.2 |

(3 countries; the 5-country lines are the same within noise, and game length changes by less than a turn.) "The first player
draws nothing" is the smallest and settles two players; the graded form is the most even from three players up.
Tried and weaker: extra starting cards for later seats, fewer plays on the first turn. Drawing the first player at
random would even out the seats over many games but not the advantage inside a game; in a solo game the person
always sits in seat 0 today.

**Long game.** One deck gives a long game about 1.5 times the quick one, and the targets (10–15 and 25–30 minutes)
ask for more than twice. The counts chosen put the quick game at the top of its range so that the long one is as
long as it can be: 15 to 23 minutes, 25 with hard bots at five players. Ways to close the gap, none taken here:
accept "about 20 minutes" for the long game; or play it to 6 countries, a product change (measured with this deck:
33.6 / 43.3 / 48.7 / 53.5 turns at 2 to 5 players, 17 to 27 minutes, always a winner with normal bots, but 30 and
138 games in 3000 without one between easy bots at four and five players).

**Countries.** No change. Egypt and Australia are in about 58% of winning sets at 3 countries, twice the even share,
because two cities are the fewest to gather; they already have the lowest toll and coin value. Replacing their two
wild cities (Egypt/Italy, Australia/Japan) by a single Italy/Japan one brought that share to about 50% in a trial.
It is not done here because the scenario tests of four engine files and one app file are written around the
Egypt/Italy card; it is the first thing to try if the small countries feel like a must-have in play.

## For later

- The bots' constant for the worth of an unseen deck card (`DECK` in `packages/bots/src/heuristics.ts`) was set for
  the old deck, where a card was a city more often.
- Easy bots bank the cards that take cities at random; that, not the data, is what is left of the long games
  without a winner.
- The Upgrade is the least used card: played 1.0 time a game at four players, banked 0.9 time.
