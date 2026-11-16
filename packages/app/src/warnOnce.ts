type Scope = 'flights' | 'audio' | 'haptics' | 'settings-save';
const warned = new Set<Scope>();

/** One sanitized developer warning per capability per app session. Never disrupt gameplay. */
export function warnOnce(scope: Scope, message: string): void {
  if (warned.has(scope)) return;
  warned.add(scope);
  try { console.warn(`[atlas:${scope}] ${message}`); } catch { /* Diagnostics are nonfatal too. */ }
}
