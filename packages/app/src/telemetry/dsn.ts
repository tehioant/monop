/** Public HTTPS Sentry project DSN, without a password, query string or fragment. */
export function sentryProject(value: string | undefined) {
  const dsn = value?.trim();
  if (!dsn) return null;
  const match = /^https:\/\/([a-f0-9]{32})@([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)(?::([1-9]\d{0,4}))?((?:\/[a-z0-9_-]+)*)\/([1-9]\d*)$/i.exec(dsn);
  if (!match) return null;
  const [, publicKey, host, port, path, project] = match;
  if (port && Number(port) > 65535) return null;
  return { dsn, publicKey, apiBase: `https://${host}${port ? `:${port}` : ''}${path}/api/${project}` };
}