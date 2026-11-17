import type { Translate } from '../i18n/strings.ts';
import type { Session } from './session.ts';

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
