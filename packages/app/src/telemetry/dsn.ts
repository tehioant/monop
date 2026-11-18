/** Public HTTPS Sentry project DSN, without a password, query string or fragment. */
export function sentryProject(value: string | undefined) {
  const dsn = value?.trim();
  if (!dsn) return null;
  const match = /^https:\/\/([a-f0-9]{32})@([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)(?::([1-9]\d{0,4}))?((?:\/[a-z0-9_-]+)*)\/([1-9]\d*)$/i.exec(dsn);
  if (!match) return null;
  const [, publicKey, rawHost, port, path, project] = match;
  if (!publicKey || !rawHost || path === undefined || !project) return null;
  const host = rawHost.toLowerCase();
  if (host.length > 253 || host.split('.').some(label => label.length > 63)) return null;
  if (port && Number(port) > 65535) return null;
  const authority = port ? `${host}:${port}` : host;
  try {
    // Expo's winter URL checks numeric hosts. Parse only the authority, not DSN credentials.
    if (new URL(`https://${authority}`).hostname !== host) return null;
  } catch {
    return null;
  }
  return {
    dsn: `https://${publicKey}@${authority}${path}/${project}`,
    publicKey,
    apiBase: `https://${authority}${path}/api/${project}`,
  };
}
