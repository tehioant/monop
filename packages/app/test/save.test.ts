import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBot, DIFFICULTIES } from '@atlas/bots';
import { deserialize, SAVE_VERSION, serialize } from '../src/solo/save.ts';
import {
  botToMove,
  inProgress,
  playBot,
  playHuman,
  rematch,
  soloLegal,
  soloView,
  startSolo,
  type SoloGame,
} from '../src/solo/solo.ts';

const config = { bots: 3, difficulty: DIFFICULTIES[0], countriesToWin: 3 };

/** The next position, a bot standing in for the human. */
function step(game: SoloGame): SoloGame {
  const human = createBot(DIFFICULTIES[0], game.seed + 1);
  return botToMove(game) ? playBot(game) : playHuman(game, human(soloView(game), soloLegal(game)));
}

/** Plays `game` to its end; `between` stands for what happens to the game between two actions. */
function finish(game: SoloGame, between: (game: SoloGame) => SoloGame = (same) => same): SoloGame {
  for (let i = 0; i < 5000 && inProgress(game); i++) game = step(between(game));
  assert.ok(!inProgress(game), 'the game finished');
  return game;
}

test('a game saved and loaded after every action plays out exactly like one never closed', () => {
  const start = startSolo(config, 5);
  let loads = 0;
  const reloaded = finish(start, (game) => {
    const loaded = deserialize(serialize(game));
    assert.deepEqual(loaded, game);
    loads++;
    return loaded!;
  });
  assert.ok(loads > 50, 'the human and the bots both played');
  assert.deepEqual(reloaded, finish(start));
});

test('a finished game is not offered again', () => {
  assert.equal(deserialize(serialize(finish(startSolo(config, 5)))), null);
});

test('a save that cannot be continued is discarded instead of loaded', () => {
  let game = startSolo(config, 3);
  for (let i = 0; i < 12; i++) game = step(game);
  const { state } = game;
  const saved = { version: SAVE_VERSION, game };
  const unreadable: Record<string, unknown> = {
    'not a save': 'null',
    'an empty file': '',
    'a file cut short': serialize(game).slice(0, -40),
    'another version': { ...saved, version: SAVE_VERSION + 1 },
    'no version': { game },
    'no game': { version: SAVE_VERSION },
    'a state missing a field': { ...saved, game: { ...game, state: { ...state, players: undefined } } },
    'a phase the engine does not know': { ...saved, game: { ...game, state: { ...state, phase: { kind: 'auction', player: 0 } } } },
    'a difficulty that no longer exists': { ...saved, game: { ...game, config: { ...config, difficulty: 'baseline' } } },
  };
  for (const [what, save] of Object.entries(unreadable)) {
    assert.equal(deserialize(typeof save === 'string' ? save : JSON.stringify(save)), null, what);
  }
  assert.deepEqual(deserialize(JSON.stringify(saved)), game);
});

test('the saved shape is the one SAVE_VERSION stands for', () => {
  const game = startSolo(config, 1);
  const fields = [game, game.config, game.state, game.state.players[0]!, game.state.turn];
  assert.deepEqual(
    fields.map((part) => Object.keys(part).sort().join(' ')),
    [
      'config seed state',
      'bots countriesToWin difficulty',
      'deck discard log market options phase players rng turn',
      'bank hand table',
      'played player',
    ],
    'The saved shape changed: raise SAVE_VERSION in src/solo/save.ts, then update this list',
  );
});

test('a rematch keeps the settings and deals a new game from the new seed', () => {
  const next = rematch(finish(startSolo(config, 5)), 6);
  assert.deepEqual(next, startSolo(config, 6));
  assert.notDeepEqual(soloView(next).hand, soloView(startSolo(config, 5)).hand);
});
