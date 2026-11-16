import { createBot, DIFFICULTIES } from '@atlas/bots';
import { botToMove, playBot, playHuman, soloLegal, soloView, startSolo, type SoloGame } from '../src/solo/solo.ts';

export const config = { bots: 3, difficulty: DIFFICULTIES[0], countriesToWin: 3 };

/** Plays a whole game, a bot standing in for the human, and returns every position on the way. */
export function playOut(seed: number): SoloGame[] {
  const human = createBot(DIFFICULTIES[0], seed + 1);
  const games = [startSolo(config, seed)];
  for (let i = 0; i < 5000; i++) {
    const game = games.at(-1)!;
    if (soloView(game).phase.kind === 'over') return games;
    games.push(botToMove(game) ? playBot(game) : playHuman(game, human(soloView(game), soloLegal(game))));
  }
  throw new Error(`Game with seed ${seed} did not finish`);
}
