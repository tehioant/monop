import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { serverUrl } from './config.ts';

export type Provider = 'apple' | 'google';
export type Mode = 'link' | 'restore';
export type AccountStatus = { providers: Provider[]; linked: Provider[]; authenticated: boolean };
export type RestoredAccount = { token: string; name: string };
const callbackUrl = 'atlas://account-auth';
const authorizedEndpoint: Record<Provider, string> = {
  apple: 'https://appleid.apple.com/auth/authorize', google: 'https://accounts.google.com/o/oauth2/v2/auth',
};
const isProvider = (value: unknown): value is Provider => value === 'apple' || value === 'google';
const base64url = (value: string) => value.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');

export function accountClient(io: typeof fetch = fetch) {
  const request = async (path: string, token: string | null, method = 'GET', body?: object) => {
    const endpoint = new URL(serverUrl);
    if (endpoint.protocol !== 'wss:' || endpoint.username || endpoint.password) throw Error('Account requires HTTPS');
    // The account routes share the game server origin, not the WebSocket path.
    const response = await io(`https://${endpoint.host}/account${path}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(10_000),
      headers: { ...(body && { 'Content-Type': 'application/json' }), ...(token && { Authorization: `Bearer ${token}` }) },
      ...(body && { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw Error('Account request refused');
    return response;
  };

  return {
    async status(token: string | null): Promise<AccountStatus> {
      const { providers, linked, authenticated } = await (await request('', token)).json();
      if (!Array.isArray(providers) || !providers.every(isProvider) || !Array.isArray(linked) || !linked.every(isProvider) ||
          typeof authenticated !== 'boolean') throw Error('Invalid account status');
      return { providers, linked, authenticated };
    },
    async signIn(provider: Provider, mode: Mode, token: string | null): Promise<RestoredAccount | { linked: true } | undefined> {
      const verifier = base64url(btoa(String.fromCharCode(...await Crypto.getRandomBytesAsync(32))));
      const challenge = base64url(await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, { encoding: Crypto.CryptoEncoding.BASE64 }));
      const { url } = await (await request('/begin', token, 'POST', { provider, mode, challenge })).json();
      const authorize = new URL(url);
      if (`${authorize.origin}${authorize.pathname}` !== authorizedEndpoint[provider] || authorize.username || authorize.password) {
        throw Error('Unknown provider authorization endpoint');
      }
      const callback = await WebBrowser.openAuthSessionAsync(authorize.href, callbackUrl);
      if (callback.type !== 'success' || callback.url === `${callbackUrl}#cancelled`) return;
      const code = /^atlas:\/\/account-auth#code=([A-Za-z0-9_-]{43})$/.exec(callback.url)?.[1];
      if (!code) throw Error('Invalid account callback');
      const result = await (await request('/redeem', token, 'POST', { code, verifier })).json();
      if (mode === 'link' && result.linked === true) return { linked: true };
      if (mode === 'restore' && typeof result.token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(result.token) &&
          typeof result.name === 'string') return { token: result.token, name: result.name };
      throw Error('Invalid account response');
    },
  };
}
