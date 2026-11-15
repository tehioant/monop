import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deserialize, SAVE_VERSION, serialize } from '../src/solo/save.ts';
import { rematch, soloView, startSolo } from '../src/solo/solo.ts';
import { config, playOut } from './helpers.ts';

test('a game saved after any action is loaded back identical, until it is over', () => {
  const games = playOut(5);
  assert.ok(games.length > 50, 'the human and the bots both played');
  for (const game of games.slice(0, -1)) assert.deepEqual(deserialize(serialize(game)), game);
  assert.equal(deserialize(serialize(games.at(-1)!)), null, 'a finished game is not offered again');
});

test('a save that cannot be continued is discarded instead of loaded', () => {
  const game = playOut(3)[12]!;
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

test('a rematch is a new game with the same settings, dealt from the new seed', () => {
  const played = playOut(5).at(-1)!;
  const next = rematch(played, 6);
  assert.deepEqual(next.config, played.config);
  assert.equal(next.seed, 6);
  assert.equal(soloView(next).log.length, 0);
  assert.notDeepEqual(soloView(next).hand, soloView(playOut(5)[0]!).hand);
});
