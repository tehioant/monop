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
  link(id: string, identity: VerifiedIdentity): Promise<boolean>;
  restore(identity: VerifiedIdentity): Promise<Session | undefined>;
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

type Attempt = { provider: Provider; owner?: string; challenge: string; deadline: number; nonce: string; pkce: string };

/** Bounded single-use browser state and device-bound redemption. Provider data never goes back to the browser. */
export function accountFlows(adapters: ProviderAdapters, store: IdentityStore, now = Date.now) {
  const pending = new Map<string, Attempt>();
  const verified = new Map<string, { attempt: Attempt; identity: VerifiedIdentity; deadline: number }>();
  const available = providers.filter(provider => adapters[provider]);
  const prune = () => {
    const time = now();
    for (const map of [pending, verified]) for (const [key, value] of map) {
      if (value.deadline <= time) map.delete(key);
    }
  };
  return {
    async status(token?: string) {
      const account = token ? await store.account(token) : undefined;
      return { providers: available, linked: account ? await store.providers(account.id) : [], authenticated: !!account };
    },
    async begin(body: Record<string, unknown>, token?: string) {
      const { provider, mode, challenge } = body;
      if (!isProvider(provider) || !proof(challenge) || (mode !== 'link' && mode !== 'restore')) return;
      const adapter = adapters[provider];
      if (!adapter) return;
      const owner = mode === 'link' && token ? (await store.account(token))?.id : undefined;
      if (mode === 'link' && !owner) return;
      prune();
      if (pending.size >= MAX_PENDING) return;
      const state = random(), nonce = random(), pkce = random();
      const authorization = adapter.authorize({ state, nonce, pkce });
      pending.set(state, { provider, owner, challenge, deadline: now() + TTL, nonce, pkce });
      return authorization;
    },
    async callback(provider: Provider, body: Record<string, unknown>) {
      const { state, code, error } = body;
      if (!proof(state)) return;
      prune();
      const attempt = pending.get(state);
      const adapter = adapters[provider];
      if (!adapter || !attempt || attempt.provider !== provider) return;
      pending.delete(state);
      if (error !== undefined || typeof code !== 'string' || !code || code.length > 4096) return;
      const identity = await adapter.exchange({ code, nonce: attempt.nonce, pkce: attempt.pkce });
      if (!identity || identity.provider !== provider || now() >= attempt.deadline || verified.size >= MAX_PENDING) return;
      const claim = random();
      verified.set(claim, { attempt, identity, deadline: Math.min(attempt.deadline, now() + 60_000) });
      return claim;
    },
    async redeem(body: Record<string, unknown>, token?: string) {
      const { code, verifier } = body;
      if (!proof(code) || !proof(verifier)) return;
      prune();
      const result = verified.get(code);
      if (!result) return;
      const { attempt, identity } = result;
      if (!timingSafeEqual(Buffer.from(attempt.challenge), Buffer.from(sha256url(verifier)))) return;
      if (attempt.owner && (!token || (await store.account(token))?.id !== attempt.owner)) return;
      // Ownership lookup yields: another request may have consumed this exact code in the meantime.
      if (now() >= result.deadline || !verified.delete(code)) return;
      if (!attempt.owner) return store.restore(identity);
      if (await store.link(attempt.owner, identity)) return { linked: true };
    },
  };
}
