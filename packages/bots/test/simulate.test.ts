import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CARDS, COUNTRIES, RULES } from '@atlas/engine';
import { formatReport, simulate, type SimulationConfig } from '../src/index.ts';

const config: SimulationConfig = { games: 4, players: 3, countriesToWin: 3, difficulty: 'baseline', seed: 1 };
const sum = (numbers: number[]) => numbers.reduce((total, n) => total + n, 0);

test('bot-only games finish for every player count and both settings', () => {
  for (const players of RULES.playerCounts) {
    for (const countriesToWin of RULES.countriesToWin) {
      const report = simulate({ ...config, players, countriesToWin });
      assert.equal(report.winsBySeat.length, players);
      assert.equal(sum(report.winsBySeat) + report.noWinner, config.games);
      assert.ok(1 <= report.turns.min && report.turns.min <= report.turns.median);
      assert.ok(report.turns.median <= report.turns.max && report.turns.mean <= report.turns.max);
      // Each winner holds at least the required number of complete countries.
      assert.ok(sum(report.countries.map((c) => c.wins)) >= countriesToWin * sum(report.winsBySeat));
    }
  }
});

test('the report covers every country and counts card usage with copies grouped', () => {
  const report = simulate(config);
  assert.deepEqual(
    report.countries.map((c) => c.country),
    COUNTRIES.map((c) => c.id),
  );
  for (const { held, wins } of report.countries) assert.ok(wins <= held && held <= config.games);
  const laid = report.cardUsage.city?.lay ?? 0;
  assert.ok(0 < laid && laid <= config.games * CARDS.filter((card) => card.kind === 'city').length);

  const text = formatReport(report);
  for (const heading of ['Game length in turns', 'Win rate by seat', 'Win rate by country held', 'Card usage']) {
    assert.ok(text.includes(heading), heading);
  }
});

test('a simulation is reproducible from its seed, and rejects a bad configuration', () => {
  assert.deepEqual(simulate(config), simulate(config));
  assert.throws(() => simulate({ ...config, games: 0 }), RangeError);
  assert.throws(() => simulate({ ...config, players: 6 }), RangeError);
});
