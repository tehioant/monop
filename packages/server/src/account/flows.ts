import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const providers = ['apple', 'google'] as const;
export type Provider = typeof providers[number];
export const isProvider = (value: unknown): value is Provider => providers.some(provider => provider === value);
export type VerifiedIdentity = { provider: Provider; subject: string; revocation?: string };
export type Account = { id: string; name: string };
export type Session = { token: string; name: string };
export interface IdentityStore {
  account(token: string): Promise<Account | undefined>;
  providers(id: string): Promise<Provider[]>;
  link(id: string, identity: VerifiedIdentity, observedOwner: string | null): Promise<boolean>;
  ownerOf(identity: VerifiedIdentity): Promise<string | undefined>;
  restore(identity: VerifiedIdentity, owner: string): Promise<Session | undefined>;
}

export interface ProviderAdapter {
  authorize(flow: { state: string; nonce: string; pkce: string }): string;
  exchange(input: { code: string; nonce: string; pkce: string }): Promise<VerifiedIdentity | undefined>;
  revoke?(encrypted: string): Promise<void>;
}
export type ProviderAdapters = Partial<Record<Provider, ProviderAdapter>>;
export const sha256url = (value: string) => createHash('sha256').update(value).digest('base64url');
const random = () => randomBytes(32).toString('base64url');
const proof = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const TTL = 5 * 60_000;
const MAX_PENDING = 2048;

type Timed = { owner?: string; deadline: number; timer?: ReturnType<typeof setTimeout> };
type Attempt = Timed & { provider: Provider; challenge: string; nonce: string; pkce: string; revision: number; exchanging?: boolean };
type Claim = Timed & { owner: string; link: boolean; challenge: string; identity: VerifiedIdentity; unbound?: true; redeeming?: boolean };

/** Bounded single-use browser state and device-bound redemption. Provider data never goes back to the browser. */
export function accountFlows(adapters: ProviderAdapters, store: IdentityStore, now = Date.now,
  { pending, verified } = { pending: new Map<string, Attempt>(), verified: new Map<string, Claim>() }) {
  const available = providers.filter(provider => adapters[provider]);
  let closed = false;
  let erasureRevision = 0;
  let erasing = 0;
  const newLinks = new Set<Promise<boolean>>();
  function forget<T extends Timed>(map: Map<string, T>, key: string) {
    clearTimeout(map.get(key)?.timer);
    map.delete(key);
  }
  function remember<T extends Timed>(map: Map<string, T>, key: string, entry: T) {
    entry.timer = setTimeout(() => forget(map, key), Math.max(0, entry.deadline - now()));
    entry.timer.unref?.();
    map.set(key, entry);
  }
  function current<T extends Timed>(map: Map<string, T>, key: string, entry: T) {
    if (map.get(key) !== entry) return false;
    if (now() < entry.deadline) return true;
    forget(map, key);
    return false;
  }
  return {
    async duringErasure(erase: () => Promise<boolean>) {
      // With no known binding owner there is no matching account row to lock against erasure.
      // Drain admitted new links, and don't admit more until the commit and cancellation are visible.
      ++erasing;
      try {
        await Promise.allSettled(newLinks);
        return await erase();
      } finally { --erasing; }
    },
    erase(id: string) {
      ++erasureRevision;
      for (const [key, attempt] of pending) if (attempt.owner === id) forget(pending, key);
      for (const [key, claim] of verified) if (claim.owner === id || claim.unbound) forget(verified, key);
    },
    close() {
      closed = true;
      for (const key of pending.keys()) forget(pending, key);
      for (const key of verified.keys()) forget(verified, key);
    },
    async status(token?: string) {
      const account = token ? await store.account(token) : undefined;
      return { providers: available, linked: account ? await store.providers(account.id) : [], authenticated: !!account };
    },
    async begin(body: Record<string, unknown>, token?: string) {
      const { provider, mode, challenge } = body;
      if (closed || !isProvider(provider) || !proof(challenge) || (mode !== 'link' && mode !== 'restore')) return;
      const adapter = adapters[provider];
      if (!adapter) return;
      const deadline = now() + TTL;
      let owner: string | undefined;
      if (mode === 'link') {
        if (!token) return;
        while (!closed && now() < deadline) {
          const revision = erasureRevision;
          owner = (await store.account(token))?.id;
          if (revision === erasureRevision) break;
          owner = undefined;
        }
        if (!owner) return;
      }
      if (closed || now() >= deadline || pending.size >= MAX_PENDING) return;
      const state = random(), nonce = random(), pkce = random();
      const authorization = adapter.authorize({ state, nonce, pkce });
      remember(pending, state, { provider, owner, challenge, deadline, nonce, pkce, revision: erasureRevision });
      return authorization;
    },
    async callback(provider: Provider, body: Record<string, unknown>) {
      const { state, code, error } = body;
      if (!proof(state)) return;
      const attempt = pending.get(state);
      const adapter = adapters[provider];
      if (!adapter || !attempt || attempt.provider !== provider || attempt.exchanging || !current(pending, state, attempt)) return;
      attempt.exchanging = true;
      try {
        if (error !== undefined || typeof code !== 'string' || !code || code.length > 4096) return;
        const identity = await adapter.exchange({ code, nonce: attempt.nonce, pkce: attempt.pkce });
        if (!identity || identity.provider !== provider) return;
        if (!current(pending, state, attempt)) return;
        let revision = erasureRevision;
        const bound = await store.ownerOf(identity);
        if (attempt.owner && bound && bound !== attempt.owner) return;
        while (bound && revision !== erasureRevision && current(pending, state, attempt)) {
          // Only reconfirm the same binding; never reinterpret a disappeared binding as unbound.
          revision = erasureRevision;
          if (await store.ownerOf(identity) !== bound) return;
        }
        const unbound = bound === undefined;
        if (unbound && (erasing || attempt.revision !== erasureRevision)) return;
        const owner = attempt.owner ?? bound;
        if (!owner || !current(pending, state, attempt) || verified.size >= MAX_PENDING) return;
        const claim = random();
        remember(verified, claim, { owner, identity, link: !!attempt.owner, ...(unbound && { unbound: true }), challenge: attempt.challenge,
          deadline: Math.min(attempt.deadline, now() + 60_000) });
        return claim;
      } finally { forget(pending, state); }
    },
    async redeem(body: Record<string, unknown>, token?: string) {
      const { code, verifier } = body;
      if (!proof(code) || !proof(verifier)) return;
      const claim = verified.get(code);
      if (!claim || claim.redeeming || !current(verified, code, claim)) return;
      const { owner, identity, link } = claim;
      if (!timingSafeEqual(Buffer.from(claim.challenge), Buffer.from(sha256url(verifier)))) return;
      if (link && (!token || (await store.account(token))?.id !== owner)) return;
      if (claim.redeeming || !current(verified, code, claim)) return;
      if (claim.unbound && erasing) return;
      claim.redeeming = true;
      // Expiry governs admission; admitted work is tracked until settlement or explicit cancellation.
      clearTimeout(claim.timer);
      try {
        let result;
        if (link) {
          const write = store.link(owner, identity, claim.unbound ? null : owner);
          if (claim.unbound) newLinks.add(write);
          try { if (await write) result = { linked: true }; }
          finally { newLinks.delete(write); }
        } else {
          result = await store.restore(identity, owner);
        }
        if (verified.get(code) === claim) return result;
      } finally { forget(verified, code); }
    },
  };
}
