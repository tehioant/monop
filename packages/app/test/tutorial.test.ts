import assert from 'node:assert/strict';
import test from 'node:test';
import { getCard, legalActions, type Action, type PlayerState } from '@atlas/engine';
import { advanceTutorial, startTutorial, tutorialPosition, type Tutorial } from '../src/tutorial/tutorial.ts';

const stack = (country: string, ...cities: string[]) => ({ country, cities, upgrades: [] });
const player = (hand: string[], bank: string[] = [], table: PlayerState['table'] = []): PlayerState => ({ hand, bank, table });

// Inputs are independently prepared at the exact engine phase under test; no prior moves are executed.
function prepared(cursor: number, overrides: Partial<Tutorial['state']>): Tutorial {
  const start = startTutorial()!;
  return { cursor, state: { ...start.state, deck: ['coin-1-12'], market: [], log: [], ...overrides } };
}

test('fixed practice deal begins with a real city lay, not the regular shuffled game', () => {
  const game = startTutorial()!;
  assert.deepEqual(game, startTutorial());
  assert.deepEqual(game.state.players[0]?.hand, ['cairo', 'coin-4-1', 'windfall-1', 'veto-1', 'sydney']);
  assert.deepEqual(game.state.phase, { kind: 'play', player: 0 });
  const position = tutorialPosition(game);
  assert.equal(position.kind, 'human');
  if (position.kind !== 'human') return;
  assert.deepEqual(position.action, { type: 'lay', card: 'cairo' });
  assert.ok(legalActions(game.state, 0).some((action) => action.type === 'bank' && action.card === 'cairo'));
  assert.equal(advanceTutorial(game, 'human', { type: 'bank', card: 'cairo' }), game);
  assert.equal(advanceTutorial(game, 'bot', position.action), game);
  const next = advanceTutorial(game, 'human', position.action)!;
  assert.deepEqual(next.state.players[0]?.table, [stack('egypt', 'cairo')]);
  assert.equal(next.cursor, game.cursor + 1);
  assert.equal(advanceTutorial(next, 'human', position.action), next);
});

test('the first bot Levy creates the real human Veto choice, without projecting its hand', () => {
  const game = prepared(5, { phase: { kind: 'play', player: 1 }, turn: { player: 1, played: 0 },
    players: [player(['veto-1', 'sydney'], ['coin-4-1'], [stack('egypt', 'cairo')]), player(['levy-1', 'levy-2'])],
  });
  const position = tutorialPosition(game);
  assert.equal(position.kind, 'bot');
  if (position.kind !== 'bot') return;
  assert.deepEqual(position.action, { type: 'play', card: 'levy-1' });
  assert.equal(position.view.players[1]?.handSize, 2);
  assert.ok(!('hand' in position.view.players[1]!));
  assert.ok(!JSON.stringify(position.view).includes('levy-2'));
  const next = advanceTutorial(game, 'bot', position.action)!;
  assert.deepEqual(next.state.phase, { kind: 'veto', player: 0, target: 0, vetoes: 0, effect: { amount: 2 }, queue: [] });
  assert.deepEqual(next.state.discard, ['levy-1']);
});

test('the guided decline opens payment; a separately prepared payment transfers the entire bank card', () => {
  const players = [player(['veto-1', 'sydney'], ['coin-4-1'], [stack('egypt', 'cairo')]), player(['levy-2'])];
  const turn = { player: 1, played: 1 };
  const veto = prepared(6, { players, turn, phase: { kind: 'veto', player: 0, target: 0, vetoes: 0, effect: { amount: 2 }, queue: [] } });
  const phase = { kind: 'pay', player: 0, receiver: 1, owed: 2, amount: 2, queue: [] } as const;
  const decline = advanceTutorial(veto, 'human', { type: 'decline' })!;
  assert.deepEqual(decline.state.phase, phase);
  const pay = prepared(7, { players, turn, phase: { ...phase, queue: [] } });
  const position = tutorialPosition(pay);
  assert.equal(position.kind, 'human');
  if (position.kind !== 'human') return;
  assert.deepEqual(position.action, { type: 'pay', card: 'coin-4-1' });
  assert.equal(getCard('coin-4-1').value, 4);
  assert.equal(advanceTutorial(pay, 'human', { type: 'pay', card: 'cairo' }), pay);
  const paid = advanceTutorial(pay, 'human', position.action)!;
  assert.deepEqual(paid.state.players.map((seat) => seat.bank), [[], ['coin-4-1']]);
  assert.deepEqual(paid.state.phase, { kind: 'play', player: 1 });
});

test('the second Levy is cancelled by a real Veto and does not transfer the city', () => {
  const game = prepared(9, {
    players: [player(['veto-1'], [], [stack('egypt', 'cairo')]), player(['coin-1-4'], ['coin-4-1'])],
    turn: { player: 1, played: 2 },
    phase: { kind: 'veto', player: 0, target: 0, vetoes: 0, effect: { amount: 2 }, queue: [] },
  });
  const next = advanceTutorial(game, 'human', { type: 'play', card: 'veto-1' })!;
  assert.deepEqual(next.state.phase, { kind: 'play', player: 1 });
  assert.deepEqual(next.state.players[0]?.table, [stack('egypt', 'cairo')]);
  assert.deepEqual(next.state.discard, ['veto-1']);
  assert.equal(next.state.turn.played, 2);
});

test('a Market draw uses the real refill and an impossible curriculum step fails closed', () => {
  const game = prepared(11, {
    phase: { kind: 'draw', player: 0, remaining: 2 }, market: ['paris', 'coin-1-1', 'coin-1-2'], deck: ['lyon', 'marseille'],
  });
  const draw: Action = { type: 'drawMarket', card: 'paris' };
  assert.equal(advanceTutorial(game, 'human', { type: 'draw' }), game);
  const next = advanceTutorial(game, 'human', draw)!;
  assert.deepEqual(next.state.market, ['coin-1-1', 'coin-1-2', 'lyon']);
  assert.deepEqual(next.state.phase, { kind: 'draw', player: 0, remaining: 1 });
  assert.ok(next.state.players[0]?.hand.includes('paris'));
  const broken = { ...game, state: { ...game.state, market: ['lyon'] } };
  assert.equal(tutorialPosition(broken).kind, 'unavailable');
  assert.equal(advanceTutorial(broken, 'human', draw), broken);
});

test('the final city ends the actual game and exposes the win only after the engine award', () => {
  const game = prepared(25, { players: [player(['marseille'], [], [
    stack('egypt', 'cairo', 'alexandria'), stack('australia', 'sydney', 'melbourne'), stack('france', 'paris', 'lyon'),
  ]), player(['coin-3-1'])], turn: { player: 0, played: 1 }, phase: { kind: 'play', player: 0 } });
  const won = advanceTutorial(game, 'human', { type: 'lay', card: 'marseille' })!;
  assert.deepEqual(won.state.phase, { kind: 'over', winner: 0 });
  assert.deepEqual(won.state.log.at(-1), { type: 'gameOver', winner: 0 });
  assert.equal(tutorialPosition(won).kind, 'won');
  assert.equal(tutorialPosition({ ...won, cursor: game.cursor }).kind, 'unavailable');
});

test('Australia’s extra play admits the guided Paris lay after three plays', () => {
  const game = prepared(16, { players: [player(['paris', 'marseille'], [], [
    stack('egypt', 'cairo', 'alexandria'), stack('australia', 'sydney', 'melbourne'),
  ]), player(['coin-3-4'])], turn: { player: 0, played: 3 }, phase: { kind: 'play', player: 0 } });
  const position = tutorialPosition(game);
  assert.equal(position.kind, 'human');
  if (position.kind !== 'human') return;
  assert.equal(position.view.turn.playsLeft, 1);
  assert.deepEqual(position.action, { type: 'lay', card: 'paris' });
  const next = advanceTutorial(game, 'human', position.action)!;
  assert.deepEqual(next.state.players[0]?.table.at(-1), stack('france', 'paris'));
  assert.equal(next.state.turn.played, 4);
});
