import { codeFromInvite } from '../online/invite.ts';

let delivery = 0;

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  const code = codeFromInvite(path);
  if (code === undefined) return path;
  // Same room, different tap: allow retries without redispatching on session updates.
  return `/online?inviteDelivery=${++delivery}${code ? `&inviteCode=${code}` : ''}`;
}