// Seeded randomness as a pure function: the generator state is a plain number kept in the game state.

/** Returns a shuffled copy of `items` and the generator state to use for the next shuffle. */
export function shuffle<T>(items: readonly T[], rng: number): { items: T[]; rng: number } {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    // mulberry32
    rng = (rng + 0x6d2b79f5) >>> 0;
    let t = Math.imul(rng ^ (rng >>> 15), rng | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const j = ((t ^ (t >>> 14)) >>> 0) % (i + 1);
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return { items: result, rng };
}
