import { CompactEncrypt, compactDecrypt, createRemoteJWKSet, customFetch, jwtVerify } from 'jose';
import { sha256url, type Provider, type ProviderAdapter, type ProviderAdapters } from './flows.ts';

const google = { authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token',
  jwks: 'https://www.googleapis.com/oauth2/v3/certs', issuer: ['https://accounts.google.com', 'accounts.google.com'] };
const appleIssuer = 'https://appleid.apple.com';
const apple = { authorize: `${appleIssuer}/auth/authorize`, token: `${appleIssuer}/auth/token`,
  jwks: `${appleIssuer}/auth/keys`, issuer: [appleIssuer] };

function httpsOrigin(value: string | undefined): string | undefined {
  if (!value) return;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && (value === url.origin || value === `${url.origin}/`)) return url.origin;
  } catch { /* Disabled until configured. */ }
}

/** Only complete server-side configurations are advertised to the app. */
export function configuredProviders(env: NodeJS.ProcessEnv, fetcher: typeof fetch = fetch): ProviderAdapters {
  const origin = httpsOrigin(env.ACCOUNT_ORIGIN);
  if (!origin) return {};
  const adapters: ProviderAdapters = {};
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    adapters.google = oidc('google', google, origin, env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, fetcher);
  }
  const key = env.APPLE_TOKEN_KEY;
  if (env.APPLE_CLIENT_ID && env.APPLE_CLIENT_SECRET && key && /^[A-Za-z0-9_-]{43}$/.test(key)) {
    adapters.apple = oidc('apple', apple, origin, env.APPLE_CLIENT_ID, env.APPLE_CLIENT_SECRET, fetcher, Buffer.from(key, 'base64url'));
  }
  return adapters;
}

function oidc(provider: Provider, endpoint: typeof google, origin: string, clientId: string, clientSecret: string,
  fetcher: typeof fetch, revocationKey?: Uint8Array): ProviderAdapter {
  const redirect = `${origin}/account/callback/${provider}`;
  const jwks = createRemoteJWKSet(new URL(endpoint.jwks), { [customFetch]: fetcher, timeoutDuration: 5000 });
  const post = (url: string, params: Record<string, string>) => fetcher(url, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...params }),
  });
  return {
    authorize({ state, nonce, pkce }) {
      const url = new URL(endpoint.authorize);
      url.search = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirect, state, nonce,
        // Apple doesn't support PKCE here. Use a confidential code exchange, state and nonce, with no profile scopes.
        ...(provider === 'apple' ? { response_mode: 'query' } : {
          scope: 'openid', code_challenge_method: 'S256', code_challenge: sha256url(pkce), prompt: 'select_account',
        }),
      }).toString();
      return url.href;
    },
    async exchange({ code, nonce, pkce }) {
      const response = await post(endpoint.token, { grant_type: 'authorization_code', code, redirect_uri: redirect,
        ...(provider === 'google' && { code_verifier: pkce }) });
      if (!response.ok) return;
      const { id_token: idToken, refresh_token: refresh } = await response.json() as Record<string, unknown>;
      if (typeof idToken !== 'string' || idToken.length > 16384) return;
      try {
        const { payload } = await jwtVerify(idToken, jwks, { algorithms: ['RS256'], issuer: endpoint.issuer,
          audience: clientId, requiredClaims: ['exp', 'sub', 'nonce'] });
        if (payload.nonce !== nonce || typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 255 ||
            (payload.azp !== undefined && payload.azp !== clientId) ||
            (Array.isArray(payload.aud) && payload.aud.length !== 1)) return;
        if (!revocationKey) return { provider, subject: payload.sub };
        if (typeof refresh !== 'string' || !refresh || refresh.length > 4096) return { provider, subject: payload.sub };
        const revocation = await new CompactEncrypt(Buffer.from(refresh))
          .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' }).encrypt(revocationKey);
        return { provider, subject: payload.sub, revocation };
      } catch { /* Do not log provider payloads, proofs or tokens. */ }
    },
    ...(revocationKey && { async revoke(encrypted: string) {
      const { plaintext } = await compactDecrypt(encrypted, revocationKey, { keyManagementAlgorithms: ['dir'], contentEncryptionAlgorithms: ['A256GCM'] });
      const response = await post(`${appleIssuer}/auth/revoke`, { token: Buffer.from(plaintext).toString(), token_type_hint: 'refresh_token' });
      if (!response.ok) throw Error('Apple token revocation failed');
    } }),
  };
}
