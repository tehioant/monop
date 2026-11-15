import assert from 'node:assert/strict';
import { test } from 'node:test';
import { botToMove, HUMAN, soloLegal, soloView, startSolo } from '../src/solo/solo.ts';
import { config, playOut } from './helpers.ts';

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
