import type { FastifyInstance, FastifyRequest } from 'fastify';
import { accountFlows, isProvider, type IdentityStore, type ProviderAdapters } from './flows.ts';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function bearer(req: FastifyRequest): string | undefined {
  return /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(req.headers.authorization ?? '')?.[1];
}

export function accountRoutes(app: FastifyInstance, adapters: ProviderAdapters, store: IdentityStore,
  erase?: (token: string, committed: (id: string) => void) => Promise<boolean>) {
  const flows = accountFlows(adapters, store);
  app.addHook('preClose', async () => flows.close());
  const headers = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' };
  app.get('/account', async (req, reply) => reply.headers(headers).send(await flows.status(bearer(req))));
  if (erase) app.delete('/account', async (req, reply) => {
    const token = bearer(req);
    if (!token || !await store.account(token) || !await flows.duringErasure(() => erase(token, flows.erase))) {
      return reply.headers(headers).code(401).send({ error: 'invalid_token' });
    }
    return reply.headers(headers).code(204).send();
  });
  app.post('/account/begin', { bodyLimit: 2048 }, async (req, reply) => {
    const url = await flows.begin(record(req.body), bearer(req));
    return reply.headers(headers).code(url ? 200 : 403).send(url ? { url } : { error: 'sign_in_unavailable' });
  });
  app.get('/account/callback/:provider', async (req, reply) => {
    const { provider } = record(req.params);
    const query = record(req.query);
    const code = isProvider(provider) ? await flows.callback(provider, query).catch(() => undefined) : undefined;
    // Only an opaque, device-bound code crosses the native redirect. No account/provider credentials.
    const cancelled = query.error === 'access_denied' || query.error === 'user_cancelled_authorize';
    const fragment = code ? `code=${code}` : cancelled ? 'cancelled' : 'refused';
    return reply.headers(headers).redirect(`atlas://account-auth#${fragment}`, 303);
  });
  app.post('/account/redeem', { bodyLimit: 2048 }, async (req, reply) => {
    const result = await flows.redeem(record(req.body), bearer(req));
    return reply.headers(headers).code(result ? 200 : 403).send(result ?? { error: 'sign_in_refused' });
  });
}
