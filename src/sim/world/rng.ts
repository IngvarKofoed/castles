/**
 * mulberry32 — the sim's stream PRNG. Two forms of the same generator:
 *
 * - `nextRand(state)` is the form the sim store uses. The store holds
 *   `rngState: number` and each draw threads a new state through, because a
 *   closure hides its state where `structuredClone` can't reach it and a
 *   save that can't capture the RNG can't be replayed (docs/specs/
 *   2026-09-01-tick-and-labour.md, "RNG state is a stored number").
 * - `mulberry32(seed)` is the closure form, kept for callers outside the
 *   store that just want a stream (tests, tools).
 *
 * World generation uses neither: it is the stateless spatial hash in
 * noise.ts, so a tile's value never depends on generation order.
 */

/** One mulberry32 step: the new state and its draw in [0, 1). Pure. */
export function nextRand(state: number): { state: number; value: number } {
  const a = (state + 0x6d2b79f5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { state: a, value: ((t ^ (t >>> 14)) >>> 0) / 0x100000000 };
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    const next = nextRand(a);
    a = next.state;
    return next.value;
  };
}
