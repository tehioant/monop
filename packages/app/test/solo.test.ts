import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBot, DIFFICULTIES } from '@atlas/bots';
import {
  botToMove,
  HUMAN,
  playBot,
  playHuman,
  soloLegal,
  soloView,
  startSolo,
  type SoloGame,
} from '../src/solo/solo.ts';

const config = { bots: 3, difficulty: DIFFICULTIES[0], countriesToWin: 3 };

/** Plays a whole game, a bot standing in for the human, and returns every position on the way. */
function playOut(seed: number): SoloGame[] {
  const human = createBot(DIFFICULTIES[0], seed + 1);
  const games = [startSolo(config, seed)];
  for (let i = 0; i < 5000; i++) {
    const game = games.at(-1)!;
    if (soloView(game).phase.kind === 'over') return games;
    games.push(botToMove(game) ? playBot(game) : playHuman(game, human(soloView(game), soloLegal(game))));
  }
  throw new Error(`Game with seed ${seed} did not finish`);
}

test('a solo game seats the human first against the chosen number of bots', () => {
  const game = startSolo(config, 1);
  const view = soloView(game);
  assert.equal(view.viewer, HUMAN);
  assert.equal(view.players.length, 4);
  assert.equal(view.options.countriesToWin, 3);
  assert.equal(view.turn.player, HUMAN);
  assert.equal(botToMove(game), false);
  assert.ok(soloLegal(game).length > 0);
});

test('until the game is over it waits on either the human or a bot, never both', () => {
  const games = playOut(7);
  assert.ok(games.some(botToMove), 'bots played');
  for (const game of games.slice(0, -1)) {
    assert.notEqual(botToMove(game), soloLegal(game).length > 0);
  }
  const last = games.at(-1)!;
  assert.equal(botToMove(last), false);
  assert.deepEqual(soloLegal(last), []);
});

test('the same seed replays the same game', () => {
  assert.deepEqual(playOut(11).at(-1), playOut(11).at(-1));
});
