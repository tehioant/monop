// Bot-only games in bulk, for balancing. Pure: the report depends only on the configuration.

import {
  applyAction,
  CARDS,
  COUNTRIES,
  createGame,
  legalActions,
  viewFor,
  type CardId,
  type CountryId,
  type GameOptions,
  type PlayerView,
} from '@atlas/engine';
import { createBot, type Bot, type Difficulty } from './bot.ts';

export interface SimulationConfig extends GameOptions {
  games: number;
  /** Game `i` is played with seed `seed + i`, so any single game can be replayed. */
  seed: number;
  difficulty: Difficulty;
}

export interface Spread {
  min: number;
  median: number;
  mean: number;
  max: number;
}

export interface Report {
  config: SimulationConfig;
  /** Game length in turns. A turn is counted each time the player whose turn it is changes. */
  turns: Spread;
  /** Game length in actions applied, by all players together. */
  actions: Spread;
  /** Games won, by seat. */
  winsBySeat: number[];
  /** Games that ended without a winner. */
  noWinner: number;
  /** By country: how many players ended a game holding it complete, and how many of those won that game. */
  countries: { country: CountryId; held: number; wins: number }[];
  /**
   * By card, then by kind of log entry naming it (lay, bank, discard...): number of times over all games.
   * Copies of a card are counted together, and so are the cities of a country.
   */
  cardUsage: Record<string, Record<string, number>>;
}

/** A game still running after this many actions is taken to be stuck. */
const MAX_ACTIONS = 10_000;

/** Cards that differ only by their id are copies of one card and share a name, such as `coin 2`. */
const CARD_NAMES = new Map<CardId, string>(
  CARDS.map(({ id, ...definition }) => [id, Object.values(definition).join(' ')]),
);

export function simulate(config: SimulationConfig): Report {
  const { games, players, countriesToWin, seed, difficulty } = config;
  if (!Number.isInteger(games) || games < 1) throw new RangeError(`Unsupported number of games: ${games}`);
  if (!Number.isInteger(seed)) throw new RangeError(`Unsupported seed: ${seed}`);

  const turns: number[] = [];
  const actions: number[] = [];
  const winsBySeat = Array.from({ length: players }, () => 0);
  let noWinner = 0;
  const countries: Report['countries'] = COUNTRIES.map(({ id }) => ({ country: id, held: 0, wins: 0 }));
  const cardUsage: Report['cardUsage'] = {};

  for (let game = 0; game < games; game++) {
    const gameSeed = (seed + game) >>> 0;
    const bot = createBot(difficulty, gameSeed);
    const { winner, view, ...length } = playGame({ players, countriesToWin }, gameSeed, bot);
    turns.push(length.turns);
    actions.push(length.actions);
    if (winner === null) noWinner++;
    else winsBySeat[winner]!++;
    view.players.forEach((player, seat) => {
      for (const stack of player.table) {
        if (!stack.complete) continue;
        const entry = countries.find((c) => c.country === stack.country)!;
        entry.held++;
        if (seat === winner) entry.wins++;
      }
    });
    for (const entry of view.log) {
      // Whatever field names them, alone or in a list.
      for (const value of Object.values(entry).flat()) {
        const name = CARD_NAMES.get(value as CardId);
        if (name === undefined) continue;
        const usage = (cardUsage[name] ??= {});
        usage[entry.type] = (usage[entry.type] ?? 0) + 1;
      }
    }
  }

  return {
    config,
    turns: spread(turns),
    actions: spread(actions),
    winsBySeat,
    noWinner,
    countries,
    cardUsage,
  };
}

function spread(counts: number[]): Spread {
  const sorted = counts.toSorted((a, b) => a - b);
  return {
    min: sorted[0]!,
    median: sorted[Math.floor(sorted.length / 2)]!,
    mean: sorted.reduce((sum, n) => sum + n, 0) / sorted.length,
    max: sorted.at(-1)!,
  };
}

/** One bot plays every seat, each time from that seat's view only. */
function playGame(
  options: GameOptions,
  seed: number,
  bot: Bot,
): { turns: number; actions: number; winner: number | null; view: PlayerView } {
  let state = createGame(options, seed);
  let turns = 0;
  let turnPlayer = -1;
  for (let actions = 0; actions < MAX_ACTIONS; actions++) {
    const view = viewFor(state, 0);
    const { phase } = view;
    if (phase.kind === 'over') return { turns, actions, winner: phase.winner, view };
    if (view.turn.player !== turnPlayer) {
      turnPlayer = view.turn.player;
      turns++;
    }
    const { player } = phase;
    state = applyAction(state, player, bot(viewFor(state, player), legalActions(state, player)));
  }
  throw new Error(`The game with seed ${seed} did not end within ${MAX_ACTIONS} actions`);
}

export function formatReport(report: Report): string {
  const { config, turns, actions, winsBySeat, noWinner, countries, cardUsage } = report;
  const { games, players, countriesToWin, difficulty, seed } = config;
  const share = (count: number, total: number) => (total === 0 ? '-' : `${((100 * count) / total).toFixed(1)}%`);
  const usageKinds = [...new Set(Object.values(cardUsage).flatMap(Object.keys))].sort();

  return [
    `${games} games, ${players} players, ${countriesToWin} countries to win, ${difficulty} bots, seed ${seed}`,
    '',
    'Game length',
    table([
      ['', 'mean', 'median', 'min', 'max'],
      ['turns', turns.mean.toFixed(1), turns.median, turns.min, turns.max],
      ['actions', actions.mean.toFixed(1), actions.median, actions.min, actions.max],
    ]),
    '',
    'Win rate by seat',
    table([
      ['seat', 'wins', 'win rate'],
      ...winsBySeat.map((wins, seat) => [seat, wins, share(wins, games)]),
      ['none', noWinner, share(noWinner, games)],
    ]),
    '',
    'Win rate by country held (complete when the game ends)',
    table([
      ['country', 'held', 'wins', 'win rate'],
      ...countries.map(({ country, held, wins }) => [country, held, wins, share(wins, held)]),
    ]),
    '',
    'Card usage (times per game)',
    table([
      ['card', ...usageKinds],
      ...Object.keys(cardUsage)
        .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
        .map((card) => [card, ...usageKinds.map((kind) => ((cardUsage[card]![kind] ?? 0) / games).toFixed(2))]),
    ]),
  ].join('\n');
}

/** Rows as aligned columns: the first column to the left, the others to the right. */
function table(rows: (string | number)[][]): string {
  const widths = rows[0]!.map((_, column) => Math.max(...rows.map((row) => String(row[column]).length)));
  return rows
    .map((row) =>
      row
        .map((cell, column) => String(cell)[column === 0 ? 'padEnd' : 'padStart'](widths[column]!))
        .join('  '),
    )
    .join('\n');
}
