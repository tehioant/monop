import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGame, viewFor } from '@atlas/engine';
import { hooks, loadComponent } from './componentBoundary.ts';

 test('same-log authoritative correction never inherits another displayed views legal actions', () => {
  const runtime = hooks();
  const { usePaced } = loadComponent(new URL('../src/table/usePaced.ts', import.meta.url).pathname, { react: runtime.react });
  const original = viewFor(createGame({ players: 2, countriesToWin: 3 }, 1), 0);
  const corrected = { ...original, hand: ['sydney'] };
  const legal = [{ type: 'bank', card: 'sydney' }];
  runtime.render(() => usePaced(original, [])); runtime.flush();
  const first = runtime.render(() => usePaced(corrected, legal));
  assert.ok(first.view === corrected || first.legal.length === 0, 'new legal must not attach to the stale same-length view');
  runtime.flush();
  const after = runtime.render(() => usePaced(corrected, legal));
  assert.equal(after.view, corrected);
  assert.equal(after.legal, legal);
  runtime.unmount();
});

test('final state stays visible for its result delay and timer is cancelled on unmount', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
  const runtime = hooks();
  const { usePaced } = loadComponent(new URL('../src/table/usePaced.ts', import.meta.url).pathname, { react: runtime.react });
  const initial = viewFor(createGame({ players: 2, countriesToWin: 3 }, 1), 0);
  const over = { ...initial, phase: { kind: 'over', winner: 1 }, log: [...initial.log, { type: 'gameOver', winner: 1 }] };
  runtime.render(() => usePaced(initial, [])); runtime.flush();
  runtime.render(() => usePaced(over, [])); runtime.flush();
  let result = runtime.render(() => usePaced(over, [])); runtime.flush();
  assert.equal(result.view, over); assert.equal(result.settled, false);
  t.mock.timers.tick(1499);
  result = runtime.render(() => usePaced(over, []));
  assert.equal(result.settled, false);
  t.mock.timers.tick(1);
  result = runtime.render(() => usePaced(over, []));
  assert.equal(result.settled, true);
  runtime.unmount(); t.mock.timers.tick(60_000);
});
