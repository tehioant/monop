import type { RoomPlayer } from '@atlas/server/protocol';
import type { Translate } from '../i18n/strings.ts';
import type { Session } from './session.ts';

/** Only the server's own bot names are translated; human names are opaque. */
export function onlineName(player: RoomPlayer, t: Translate): string {
  const number = player.bot ? /^Bot (\d+)$/.exec(player.name)?.[1] : undefined;
  return number === undefined ? player.name : t('common.bot', { number });
}

export function explainOnlineError(error: NonNullable<Session['error']>, t: Translate): string {
  switch (error) {
    case 'disconnected': return t('online.unreachable');
    case 'room_not_found': return t('online.roomNotFound');
    case 'room_full': return t('online.roomFull');
    case 'game_started': return t('online.gameStarted');
    case 'removed': return t('online.removed');
    case 'replaced': return t('online.replaced');
    case 'ended': return t('online.ended');
    case 'seat_unavailable': return t('online.seatUnavailable');
    case 'leave_failed': return t('online.leaveFailed');
    default: return t('online.error');
  }
}
