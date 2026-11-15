import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LogEntry } from '@atlas/engine';
import { sinceLastTurn } from '../src/table/log.ts';

const draw = (player: number): LogEntry => ({ type: 'draw', player });
const end = (player: number): LogEntry => ({ type: 'endTurn', player });
const pay = (player: number): LogEntry => ({ type: 'pay', card: 'coin-1-1', player });
const discard = (player: number): LogEntry => ({ type: 'discard', card: 'coin-1-2', player });

test('the log starts where the viewer last ended a turn', () => {
  const theirs = [draw(1), { type: 'play', card: 'debt-1', target: 0, player: 1 }, pay(0), end(1), draw(2), end(2)] as LogEntry[];
  const log = [draw(0), end(0), ...theirs];
  assert.deepEqual(sinceLastTurn(log, 0), theirs, 'the other turns, with what the viewer answered in them');
  assert.deepEqual(sinceLastTurn([...log, draw(0)], 0), [...theirs, draw(0)], 'and their own turn so far');
  assert.deepEqual(sinceLastTurn(log, 2), []);
  assert.deepEqual(sinceLastTurn(log, 1), [draw(2), end(2)]);
});

test('before the viewer has ended a turn, it is the whole log', () => {
  const log = [draw(0), draw(0)];
  assert.deepEqual(sinceLastTurn(log, 0), log);
  assert.deepEqual(sinceLastTurn(log, 1), log);
  assert.deepEqual(sinceLastTurn([], 0), []);
});

test('discarding down to the hand limit is still the turn that ended', () => {
  const log = [draw(0), end(0), discard(0), discard(0), { type: 'reshuffle' }, draw(1)] as LogEntry[];
  assert.deepEqual(sinceLastTurn(log, 0), log.slice(4));
});
