// The solo game loop: the engine and the bots running on the device. No React, no I/O.

import { createBot, type Difficulty } from '@atlas/bots';
import type { Translate } from '../i18n/strings.ts';
import {
  applyAction,
  createGame,
  legalActions,
  viewFor,
  type Action,
  type GameState,
  type PlayerView,
} from '@atlas/engine';

/** The human's seat. Every other seat is a bot. */
export const HUMAN = 0;

export interface SoloConfig {
  /** Number of bot opponents. */
  bots: number;
  difficulty: Difficulty;
  countriesToWin: number;
}

/** Plain JSON, so a game can be saved as it is. */
export interface SoloGame {
  config: SoloConfig;
  /** uint32, for both the deal and the bots. */
  seed: number;
  state: GameState;
}

export function startSolo(config: SoloConfig, seed: number): SoloGame {
  const options = { players: config.bots + 1, countriesToWin: config.countriesToWin };
  return { config, seed, state: createGame(options, seed) };
}

/** A new game with the settings of `game`, dealt from `seed`. */
export function rematch(game: SoloGame, seed: number): SoloGame {
  return startSolo(game.config, seed);
}

/** False once the game is over. */
export function inProgress(game: SoloGame): boolean {
  return game.state.phase.kind !== 'over';
}

/** What the table shows: the human's view. */
export function soloView(game: SoloGame): PlayerView {
  return viewFor(game.state, HUMAN);
}

/** What the table offers: empty while the game waits on a bot. */
export function soloLegal(game: SoloGame): Action[] {
  return legalActions(game.state, HUMAN);
}

export function playHuman(game: SoloGame, action: Action): SoloGame {
  return { ...game, state: applyAction(game.state, HUMAN, action) };
}

/** True while the game waits on a bot, on its own turn or in an interrupt. */
export function botToMove(game: SoloGame): boolean {
  const { phase } = game.state;
  return phase.kind !== 'over' && phase.player !== HUMAN;
}

/** Plays one action for the bot the game is waiting on. Call only when `botToMove`. */
export function playBot(game: SoloGame): SoloGame {
  const { state } = game;
  if (state.phase.kind === 'over') throw new Error('The game is over');
  const { player } = state.phase;
  // Bots are stateless, so one is made on the spot rather than kept in the game.
  const bot = createBot(game.config.difficulty, game.seed);
  const action = bot(viewFor(state, player), legalActions(state, player));
  return { ...game, state: applyAction(state, player, action) };
}

/** Display names by seat. */
export function soloNames(game: SoloGame, t: Translate): string[] {
  return game.state.players.map((_, seat) => (seat === HUMAN ? t('common.you') : t('common.bot', { number: seat })));
}
