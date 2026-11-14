// Developer command: plays bot-only games in bulk and prints a balance report.
// node packages/bots/src/cli.ts --games 5000 --players 4 --countries 3

import { parseArgs } from 'node:util';
import { DIFFICULTIES, type Difficulty } from './bot.ts';
import { formatReport, simulate } from './simulate.ts';

const USAGE = `Usage: node packages/bots/src/cli.ts [options]
  --games <n>        number of games (default 1000)
  --players <n>      players per game, 2 to 5 (default 4)
  --countries <n>    countries to win, 3 or 5 (default 3)
  --difficulty <d>   ${DIFFICULTIES.join(' | ')} (default ${DIFFICULTIES[0]})
  --seed <n>         seed of the first game (default 1)`;

try {
  const { values } = parseArgs({
    options: {
      games: { type: 'string', default: '1000' },
      players: { type: 'string', default: '4' },
      countries: { type: 'string', default: '3' },
      difficulty: { type: 'string', default: DIFFICULTIES[0] },
      seed: { type: 'string', default: '1' },
    },
  });
  const report = simulate({
    games: Number(values.games),
    players: Number(values.players),
    countriesToWin: Number(values.countries),
    difficulty: values.difficulty as Difficulty,
    seed: Number(values.seed),
  });
  console.log(formatReport(report));
} catch (error) {
  console.error(`${(error as Error).message}\n\n${USAGE}`);
  process.exitCode = 1;
}
