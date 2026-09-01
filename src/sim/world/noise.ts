/**
 * Spatial hashing and value noise for world generation.
 *
 * The mockup's sin-based hash is replaced by an integer avalanche hash:
 * `Math.sin` bit-equality across JS engines is de facto, not guaranteed,
 * and the shareable-seed promise must not rest on it (spec
 * 2026-09-01-bootstrap-world, Key decisions).
 */

/** Deterministic hash of an integer lattice point and seed, in [0, 1). */
export function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ (seed | 0);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 0x100000000;
}

/**
 * Two-dimensional value noise in [0, 1) — the mockup's `vnoise` with the
 * seed threaded through to the lattice hash. `f` is the frequency.
 */
export function vnoise(x: number, y: number, f: number, seed: number): number {
  const gx = x * f;
  const gy = y * f;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash(x0, y0, seed);
  const b = hash(x0 + 1, y0, seed);
  const c = hash(x0, y0 + 1, seed);
  const d = hash(x0 + 1, y0 + 1, seed);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}
