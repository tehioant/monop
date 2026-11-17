import { applyAction, CARDS, createGame, legalActions, viewFor, type Action, type GameState, type PlayerView } from '@atlas/engine';

const HUMAN = 0;
const BOT = 1;
const SEED = 42;

// Opening hands, Market, then fixed draws. The rest is the untouched catalog in catalog order.
const OPENING = [
  'cairo', 'coin-4-1', 'windfall-1', 'veto-1', 'sydney', // learner
  'levy-1', 'levy-2', 'coin-1-4', 'coin-2-4', 'coin-3-4', // practice opponent (no counter-Veto)
  'paris', 'coin-1-1', 'coin-1-2', // Market
  'alexandria', 'melbourne', 'coin-1-3', // Windfall, then opponent's first draw
  'lyon', 'marseille', // Paris refill, then learner's deck draw
  'coin-2-1', 'coin-2-2', 'coin-2-3', 'coin-3-1', 'coin-3-2', // opponent draws, Lyon refill, learner draws
];

type Lesson = { kind: 'human'; action: Action; hint: `tutorial.${string}` } | { kind: 'bot'; action: Action };
const LESSONS = [
  // The first player doesn't draw. Three plays; Windfall draws the two cities for turn two.
  { kind: 'human', action: { type: 'lay', card: 'cairo' }, hint: 'tutorial.cairo' },
  { kind: 'human', action: { type: 'bank', card: 'coin-4-1' }, hint: 'tutorial.bank' },
  { kind: 'human', action: { type: 'play', card: 'windfall-1' }, hint: 'tutorial.windfall' },
  { kind: 'human', action: { type: 'endTurn' }, hint: 'tutorial.endTurn' },
  { kind: 'bot', action: { type: 'draw' } },
  { kind: 'bot', action: { type: 'play', card: 'levy-1' } },
  { kind: 'human', action: { type: 'decline' }, hint: 'tutorial.allow' },
  { kind: 'human', action: { type: 'pay', card: 'coin-4-1' }, hint: 'tutorial.pay' },
  { kind: 'bot', action: { type: 'play', card: 'levy-2' } },
  { kind: 'human', action: { type: 'play', card: 'veto-1' }, hint: 'tutorial.veto' },
  { kind: 'bot', action: { type: 'endTurn' } },
  // The Market refill comes off the deck before the next draw. Australia unlocks the fourth play.
  { kind: 'human', action: { type: 'drawMarket', card: 'paris' }, hint: 'tutorial.parisMarket' },
  { kind: 'human', action: { type: 'draw' }, hint: 'tutorial.deckDraw' },
  { kind: 'human', action: { type: 'lay', card: 'alexandria' }, hint: 'tutorial.alexandria' },
  { kind: 'human', action: { type: 'lay', card: 'sydney' }, hint: 'tutorial.sydney' },
  { kind: 'human', action: { type: 'lay', card: 'melbourne' }, hint: 'tutorial.melbourne' },
  { kind: 'human', action: { type: 'lay', card: 'paris' }, hint: 'tutorial.paris' },
  { kind: 'human', action: { type: 'endTurn' }, hint: 'tutorial.endTurn' },
  { kind: 'bot', action: { type: 'draw' } },
  { kind: 'bot', action: { type: 'draw' } },
  { kind: 'bot', action: { type: 'endTurn' } },
  // Egypt now grants the third draw. Marseille completes France and wins through the engine.
  { kind: 'human', action: { type: 'drawMarket', card: 'lyon' }, hint: 'tutorial.lyonMarket' },
  { kind: 'human', action: { type: 'draw' }, hint: 'tutorial.deckDraw' },
  { kind: 'human', action: { type: 'draw' }, hint: 'tutorial.deckDraw' },
  { kind: 'human', action: { type: 'lay', card: 'lyon' }, hint: 'tutorial.lyon' },
  { kind: 'human', action: { type: 'lay', card: 'marseille' }, hint: 'tutorial.marseille' },
] as const satisfies readonly Lesson[];

export interface Tutorial {
  state: GameState;
  cursor: number;
}

export type Position =
  | { kind: 'human'; view: PlayerView; action: Action; hint: Extract<typeof LESSONS[number], { kind: 'human' }>['hint'] }
  | { kind: 'bot'; view: PlayerView; action: Action }
  | { kind: 'won'; view: PlayerView }
  | { kind: 'unavailable' };

export function startTutorial(): Tutorial | null {
  try {
    const deck = [...OPENING, ...CARDS.map(({ id }) => id).filter((id) => !OPENING.includes(id))];
    return { state: createGame({ players: 2, countriesToWin: 3 }, SEED, { deck }), cursor: 0 };
  } catch {
    return null;
  }
}

function sameAction(expected: Action, input: Action): boolean {
  return input !== null && typeof input === 'object' && Object.keys(expected).length === Object.keys(input).length &&
    Object.entries(expected).every(([key, value]) => Object.hasOwn(input, key) && Reflect.get(input, key) === value);
}

function guidedAction(tutorial: Tutorial) {
  const lesson = LESSONS[tutorial.cursor];
  if (!lesson) return null;
  const seat = lesson.kind === 'human' ? HUMAN : BOT;
  const action = legalActions(tutorial.state, seat).find((action) => sameAction(lesson.action, action));
  return action ? { lesson, seat, action } : null;
}

export function tutorialPosition(tutorial: Tutorial | null): Position {
  if (tutorial) {
    try {
      const { phase } = tutorial.state;
      if (phase.kind === 'over' && phase.winner === HUMAN && tutorial.cursor === LESSONS.length) {
        return { kind: 'won', view: viewFor(tutorial.state, HUMAN) };
      }
      const guided = guidedAction(tutorial);
      if (guided) {
        const { lesson, action } = guided;
        const view = viewFor(tutorial.state, HUMAN);
        if (lesson.kind === 'human') return { kind: 'human', view, action, hint: lesson.hint };
        return { kind: 'bot', view, action };
      }
    } catch { /* An invalid practice setup is recoverable from the tutorial screen. */ }
  }
  return { kind: 'unavailable' };
}

export function advanceTutorial(tutorial: Tutorial, actor: 'human' | 'bot', submitted: Action): Tutorial | null {
  try {
    const guided = guidedAction(tutorial);
    if (!guided || guided.lesson.kind !== actor || !sameAction(guided.action, submitted)) return tutorial;
    return { state: applyAction(tutorial.state, guided.seat, guided.action), cursor: tutorial.cursor + 1 };
  } catch {
    return null;
  }
}
