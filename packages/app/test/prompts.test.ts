import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, createGame, legalActions, viewFor, type Action, type CardId, type GameState } from '@atlas/engine';
import { groupActions } from '../src/table/actions.ts';
import { cardPrompt, payPrompt, togglePay, vetoPrompt, type Picks } from '../src/table/prompts.ts';

const names = ['Ann', 'Bob', 'Cy'];

/** The player the game is waiting on. */
function awaited(state: GameState): number {
  const { phase } = viewFor(state, 0);
  if (phase.kind === 'over') throw new Error('The game is over');
  return phase.player;
}

/** Applies actions in sequence, each as the player the game is waiting on. */
function act(state: GameState, ...actions: Action[]): GameState {
  return actions.reduce((s, action) => applyAction(s, awaited(s), action), state);
}

const draw: Action = { type: 'draw' };
const end: Action = { type: 'endTurn' };
const lay = (card: CardId): Action => ({ type: 'lay', card });
const bank = (card: CardId): Action => ({ type: 'bank', card });

/**
 * Ann's second turn, holding one of each card that needs a target. She has laid Paris and Lyon; Bob has laid
 * London and banked 6, with two Vetoes in hand; Cy holds Australia complete and Tokyo.
 */
function annToPlay(): GameState {
  const deck = [
    ...['paris', 'lyon', 'raid-1', 'exchange-1', 'debt-1'],
    ...['london', 'coin-5-1', 'coin-1-1', 'veto-1', 'veto-3'],
    ...['sydney', 'melbourne', 'tokyo', 'coin-2-1', 'coin-2-2'],
    ...['coin-3-1', 'coin-3-2', 'coin-3-3'], // the Market
    ...['toll-1', 'windfall-1', 'coin-1-4', 'coin-1-5', 'coin-2-3', 'coin-2-4', 'seizure-1', 'veto-2'],
  ];
  return act(
    createGame({ players: 3, countriesToWin: 3 }, 1, { deck }),
    ...[draw, draw, lay('paris'), lay('lyon'), end],
    ...[draw, draw, lay('london'), bank('coin-5-1'), bank('coin-1-1'), end],
    ...[draw, draw, lay('sydney'), lay('melbourne'), lay('tokyo'), end],
    ...[draw, draw],
  );
}

/** The prompt of one of the awaited player's cards. */
function promptOf(state: GameState, card: CardId, picks: Picks = {}) {
  const view = viewFor(state, awaited(state));
  const actions = groupActions(view, legalActions(state, view.viewer)).byCard.get(card) ?? [];
  return cardPrompt(view, actions, picks, names);
}

const labels = (prompt: ReturnType<typeof promptOf>) =>
  prompt.steps.map(({ title, groups }) => [title, ...groups.map(({ seat, options }) => [seat, ...options.map((option) => option.label)])]);

test('a card with nothing to choose is played or banked as it is', () => {
  const prompt = promptOf(annToPlay(), 'windfall-1');
  assert.deepEqual(prompt.direct, [{ type: 'play', card: 'windfall-1' }, bank('windfall-1')]);
  assert.deepEqual(prompt.steps, []);
  assert.deepEqual([prompt.chosen, prompt.confirm], [null, null]);
});

test('a card that needs a target lists them by opponent, and designates an action once one is picked', () => {
  const state = annToPlay();
  const raid = promptOf(state, 'raid-1');
  assert.deepEqual(raid.direct, [bank('raid-1')]);
  assert.deepEqual(labels(raid), [['Take which city?', [1, 'London'], [2, 'Tokyo']]]);
  assert.deepEqual([raid.chosen, raid.confirm], [null, 'Take which city?']);
  const tokyo = raid.steps[0]!.groups[1]!.options[0]!;
  assert.equal(tokyo.country, 'japan');
  const picked = promptOf(state, 'raid-1', { aim: tokyo.key });
  assert.deepEqual(picked.chosen, { type: 'play', card: 'raid-1', target: 2, city: 'tokyo' });
  assert.equal(picked.confirm, 'Take Tokyo from Cy');
  assert.deepEqual(picked.steps[0]!.groups.flatMap(({ options }) => options.map((option) => option.picked)), [false, true]);

  assert.deepEqual(labels(promptOf(state, 'debt-1')), [['Which opponent?', [null, 'Bob · bank 6', 'Cy · bank 0']]]);
});

test('an Exchange is two picks, not a list of every pair', () => {
  const state = annToPlay();
  const prompt = promptOf(state, 'exchange-1');
  assert.deepEqual(labels(prompt), [
    ['Give which of your cities?', [null, 'Paris', 'Lyon']],
    ['For which city?', [1, 'London'], [2, 'Tokyo']],
  ]);
  const give = prompt.steps[0]!.groups[0]!.options[1]!.key;
  const aim = prompt.steps[1]!.groups[0]!.options[0]!.key;
  assert.deepEqual([prompt.chosen, prompt.confirm], [null, 'Give which of your cities?']);
  assert.deepEqual([promptOf(state, 'exchange-1', { give }).chosen, promptOf(state, 'exchange-1', { give }).confirm], [null, 'For which city?']);
  const { chosen, confirm } = promptOf(state, 'exchange-1', { give, aim });
  assert.deepEqual(chosen, { type: 'play', card: 'exchange-1', target: 1, give: 'lyon', take: 'london' });
  assert.equal(confirm, "Give Lyon for Bob's London");
});

test('a single target is picked already, and a pick that names no option counts as none', () => {
  const state = annToPlay();
  const toll = promptOf(state, 'toll-1', { aim: 'gone' });
  assert.deepEqual(labels(toll), [['Which country?', [null, 'France 2/3 · toll 2']]]);
  assert.deepEqual(toll.chosen, { type: 'play', card: 'toll-1', country: 'france' });
  assert.equal(toll.confirm, 'Play Toll: France');

  const seizure = promptOf(state, 'seizure-1');
  assert.deepEqual(labels(seizure), [['Take which country?', [2, 'Australia 2/2 ✓ · toll 2']]]);
  assert.deepEqual(seizure.chosen, { type: 'play', card: 'seizure-1', target: 2, country: 'australia' });
  assert.equal(seizure.confirm, 'Take Australia from Cy');

  const debt = promptOf(state, 'debt-1');
  assert.equal(promptOf(state, 'debt-1', { aim: debt.steps[0]!.groups[0]!.options[1]!.key }).confirm, 'Play Debt: Cy');
});

test('every legal action of a card is offered once, directly or by one pick per step', () => {
  // Seeded random play, looked at through the prompts of whoever is to act.
  let seed = 5;
  const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  let state = createGame({ players: 3, countriesToWin: 3 }, seed);
  const seen = [0, 0, 0]; // prompts by number of steps
  for (let i = 0; i < 400 && viewFor(state, 0).phase.kind !== 'over'; i++) {
    const player = awaited(state);
    const view = viewFor(state, player);
    const legal = legalActions(state, player);
    for (const [card, actions] of groupActions(view, legal).byCard) {
      const at = (picks: Picks) => cardPrompt(view, actions, picks, names);
      const offered = [...at({}).direct];
      const [first, second] = at({}).steps;
      for (const a of first?.groups.flatMap(({ options }) => options) ?? []) {
        if (!second) offered.push(at({ [first!.slot]: a.key }).chosen!);
        for (const b of at({ [first!.slot]: a.key }).steps[1]?.groups.flatMap(({ options }) => options) ?? []) {
          offered.push(at({ [first!.slot]: a.key, [second!.slot]: b.key }).chosen!);
        }
      }
      assert.deepEqual(new Set(offered), new Set(actions));
      assert.equal(offered.length, actions.length);
      seen[at({}).steps.length]!++;
    }
    state = applyAction(state, player, legal[Math.floor(random() * legal.length)]!);
  }
  assert.ok(seen.every((count) => count > 0), `prompts with no step, one step and two steps: ${seen}`);
});

test('the payment prompt adds up the picked cards, and sends them only once they cover what is owed', () => {
  // Ann plays her Debt on Bob, who lets it happen: he owes 5, with London (2) and 6 in the bank.
  const state = act(annToPlay(), { type: 'play', card: 'debt-1', target: 1 }, { type: 'decline' });
  const view = viewFor(state, 1);
  const legal = legalActions(state, 1);
  const at = (picked: readonly CardId[]) => payPrompt(view, legal, picked, names)!;
  assert.equal(payPrompt(viewFor(state, 0), legalActions(state, 0), [], names), null);

  const none = at([]);
  assert.equal(none.text, 'You owe 5 to Ann');
  assert.deepEqual([none.owed, none.total, none.summary, none.actions], [5, 0, 'Selected 0 of 5', []]);
  assert.deepEqual(none.cards, [
    { key: 'coin-5-1', label: 'Coin 5', country: undefined, picked: false, disabled: false },
    { key: 'coin-1-1', label: 'Coin 1', country: undefined, picked: false, disabled: false },
    { key: 'london', label: 'London (2)', country: 'uk', picked: false, disabled: false },
  ]);

  // Short of the amount: nothing to send yet. Covered: no further card can be added, so none is ever refused.
  let picked = togglePay(none, [], 'coin-1-1');
  picked = togglePay(at(picked), picked, 'london');
  assert.deepEqual([at(picked).total, at(picked).actions], [3, []]);
  picked = togglePay(at(picked), picked, 'coin-5-1');
  const over = at(picked);
  assert.deepEqual([over.total, over.summary], [8, 'Selected 8 of 5 (3 over)']);
  assert.deepEqual(over.actions, [{ type: 'pay', card: 'coin-1-1' }, { type: 'pay', card: 'london' }, { type: 'pay', card: 'coin-5-1' }]);
  assert.deepEqual(at(['coin-5-1']).cards.map((card) => card.disabled), [false, true, true]);
  assert.deepEqual(togglePay(at(['coin-5-1']), ['coin-5-1'], 'london'), ['coin-5-1']);
  assert.deepEqual(togglePay(over, picked, 'london'), ['coin-1-1', 'coin-5-1']);
  assert.deepEqual(togglePay(none, [], 'veto-1'), []);

  // Sent in order, each is legal when its turn comes, and the last one settles the debt.
  const paid = act(state, ...over.actions);
  assert.deepEqual(viewFor(paid, 0).phase, { kind: 'play', player: 0 });
});

test('the Veto prompt says what is at stake, to the target and to the player whose card is answered', () => {
  const asked = act(annToPlay(), { type: 'play', card: 'debt-1', target: 1 });
  const bob = vetoPrompt(viewFor(asked, 1), legalActions(asked, 1), names)!;
  assert.equal(bob.text, 'Ann plays Debt: you pay 5. Cancel it with a Veto?');
  assert.deepEqual([bob.veto, bob.declineLabel], [{ type: 'play', card: 'veto-1' }, 'Let it happen']);
  assert.equal(vetoPrompt(viewFor(asked, 0), legalActions(asked, 0), names), null);

  const vetoed = act(asked, bob.veto!);
  const ann = vetoPrompt(viewFor(vetoed, 0), legalActions(vetoed, 0), names)!;
  assert.equal(ann.text, 'Bob answers your Debt with a Veto. Play your own to force it through?');
  assert.deepEqual([ann.veto, ann.declineLabel], [{ type: 'play', card: 'veto-2' }, 'Accept the Veto']);

  const forced = act(vetoed, ann.veto!);
  assert.equal(
    vetoPrompt(viewFor(forced, 1), legalActions(forced, 1), names)!.text,
    'Ann answers your Veto with a Veto: Debt is back on, you pay 5. Veto again?',
  );

  const stakes = (action: Action) => {
    const state = act(annToPlay(), action);
    const player = awaited(state);
    return vetoPrompt(viewFor(state, player), legalActions(state, player), names)!.text;
  };
  assert.equal(stakes({ type: 'play', card: 'raid-1', target: 1, city: 'london' }), 'Ann plays Raid: you lose London. Cancel it with a Veto?');
  assert.equal(
    stakes({ type: 'play', card: 'exchange-1', target: 1, give: 'lyon', take: 'london' }),
    'Ann plays Exchange: you get Lyon for your London. Cancel it with a Veto?',
  );
  assert.equal(stakes({ type: 'play', card: 'toll-1', country: 'france' }), 'Ann plays Toll: you pay 2. Cancel it with a Veto?');
});

test('a debt the payable cards cannot cover takes them all, and goes on with what that frees', () => {
  // Bob holds Australia complete with an upgrade and has banked 1: worth 6 in all, 3 of it payable. Ann's Debt asks 5.
  const deck = [
    ...['debt-1', 'coin-2-1', 'coin-2-2', 'coin-2-3', 'coin-2-4'],
    ...['sydney', 'melbourne', 'upgrade-1', 'coin-1-1', 'coin-1-2'],
    ...['coin-3-1', 'coin-3-2', 'coin-3-3'], // the Market
    ...['coin-1-3', 'coin-1-4', 'coin-1-5', 'coin-1-6', 'coin-2-5', 'coin-4-1'],
  ];
  const state = act(
    createGame({ players: 2, countriesToWin: 3 }, 1, { deck }),
    ...[draw, draw, end],
    ...[draw, draw, lay('sydney'), lay('melbourne'), { type: 'play', card: 'upgrade-1', country: 'australia' } as const, bank('coin-1-1'), end],
    ...[draw, draw, { type: 'play', card: 'debt-1', target: 1 } as const],
  );
  const at = (s: GameState, picked: CardId[]) => payPrompt(viewFor(s, 1), legalActions(s, 1), picked, names)!;
  assert.deepEqual(at(state, ['coin-1-1', 'sydney']).actions, []);
  const all = at(state, ['coin-1-1', 'sydney', 'melbourne']);
  assert.deepEqual([all.owed, all.total, all.actions.length], [5, 3, 3]);

  // Breaking the country drops its upgrade into the bank: the prompt comes back for the rest.
  const rest = at(act(state, ...all.actions), []);
  assert.deepEqual([rest.owed, rest.cards.map((card) => card.label)], [2, ['Upgrade (3)']]);
});

test('an action aimed in a way the table has no wording for still gets its options and its confirm', () => {
  const embargo = (region: string) => ({ type: 'tradeEmbargo', card: 'windfall-1', region }) as unknown as Action;
  const view = viewFor(annToPlay(), 0);
  const prompt = cardPrompt(view, [embargo('north'), embargo('south')], {}, names);
  assert.deepEqual(labels(prompt), [['Choose', [null, 'Trade embargo Windfall (region: North)', 'Trade embargo Windfall (region: South)']]]);
  const south = prompt.steps[0]!.groups[0]!.options[1]!.key;
  const picked = cardPrompt(view, [embargo('north'), embargo('south')], { aim: south }, names);
  assert.deepEqual([picked.chosen, picked.confirm], [embargo('south'), 'Trade embargo Windfall (region: South)']);
});
