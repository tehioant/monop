import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '@atlas/server/protocol';

const INVITE_PATH = 'atlas:///invite';
const NON_CODE_LETTER = new RegExp(`[^${ROOM_CODE_ALPHABET}]`, 'i');

export const inviteLink = (code: string): string => `${INVITE_PATH}?code=${encodeURIComponent(code)}`;

export function inviteCode(value: unknown): string | null {
  return typeof value === 'string' && value.length === ROOM_CODE_LENGTH && !NON_CODE_LETTER.test(value)
    ? value.toUpperCase()
    : null;
}

/** Undefined for unrelated routes, null for an invite without one valid code. */
export function codeFromInvite(path: string): string | null | undefined {
  if (!path.startsWith(INVITE_PATH)) return undefined;
  const suffix = path.slice(INVITE_PATH.length);
  if (suffix && !'?#/'.includes(suffix[0]!)) return undefined;
  if (!suffix.startsWith('?code=')) return null;
  try {
    return inviteCode(decodeURIComponent(suffix.slice('?code='.length)));
  } catch {
    return null;
  }
}