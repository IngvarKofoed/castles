import { CHUNK, chunkCount, chunksPerSide } from "./chunks";
import { vnoise } from "./noise";

/** World side length in tiles. Tunable; the chunking is not. */
export const WORLD_SIZE = 256;

/**
 * Terrain kinds as a Uint8Array-friendly enum. A frozen `as const` object,
 * not a `const enum` — Vite's isolatedModules transpilation degrades those.
 */
export const Terrain = {
  Water: 0,
  Sand: 1,
  Grass: 2,
  Rock: 3,
} as const;
export type TerrainValue = (typeof Terrain)[keyof typeof Terrain];

export interface World {
  readonly size: number;
  readonly seed: number;
  /** Height in blocks, 1..8, row-major. */
  readonly hmap: Uint8Array;
  /** Terrain values, row-major. */
  readonly tmap: Uint8Array;
  /**
   * Bumped by whatever changes a chunk; generation leaves every entry at 1.
   * The renderer keeps its own last-seen copy and rebuilds chunks whose
   * versions moved — it never writes sim state.
   */
  readonly chunkVersion: Uint32Array;
}

export const tileIndex = (x: number, y: number, size: number): number => y * size + x;

// Noise channels: base landforms on the world seed, rock outcrops on a
// derived seed so the two fields are uncorrelated.
const ROCK_SEED_SALT = 0x9e3779b9;

// Height thresholds — types by height exactly as the mockup.
const MAX_HEIGHT = 8;
const WATER_MAX = 1;
const SAND_HEIGHT = 2;
const ROCK_MIN = 7;

// Rock outcrop pass: rare, low-frequency peaks raised to ROCK_MIN so rock is
// a feature, not topography (the flat base tops out below the rock threshold).
const ROCK_FREQ = 0.045;
const ROCK_THRESHOLD = 0.9;

/** Generate the world for a seed. Same seed, same world — byte for byte. */
export function generate(seed: number): World {
  const size = WORLD_SIZE;
  const hmap = new Uint8Array(size * size);
  const tmap = new Uint8Array(size * size);
  const chunkVersion = new Uint32Array(chunkCount(size)).fill(1);

  const centre = (size - 1) / 2;
  const half = size / 2;
  const rockSeed = (seed ^ ROCK_SEED_SALT) | 0;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Two-octave base, retuned flat: most land lands on 3–5.
      let h = 3 + vnoise(x, y, 0.02, seed) * 1.6 + vnoise(x, y, 0.06, seed) * 0.5;

      // Island falloff: all edge tiles end up water, which also suits the
      // future flood-fill-from-the-map-edge enclosure test.
      const r = Math.hypot(x - centre, y - centre) / half;
      if (r > 0.85) h -= (r - 0.85) * 30;

      h = Math.round(h);
      h = Math.max(1, Math.min(MAX_HEIGHT, h));

      // Rock outcrops only on land that would be grass.
      if (h > SAND_HEIGHT && vnoise(x, y, ROCK_FREQ, rockSeed) > ROCK_THRESHOLD) {
        h = ROCK_MIN;
      }

      const i = tileIndex(x, y, size);
      hmap[i] = h;
      tmap[i] =
        h <= WATER_MAX ? Terrain.Water
        : h === SAND_HEIGHT ? Terrain.Sand
        : h >= ROCK_MIN ? Terrain.Rock
        : Terrain.Grass;
    }
  }

  return { size, seed, hmap, tmap, chunkVersion };
}

/**
 * Bump the versions of every chunk whose geometry depends on tile (x, y) —
 * the sim-side write for "this tile changed".
 *
 * That is the tile's own chunk *and* any chunk within one tile of it: the
 * mesher reads 4-neighbour heights across chunk borders for its side faces,
 * and the renderer's baked AO reads all 8 neighbours. Bumping only the owning
 * chunk leaves stale step faces and stale AO in the chunk next door whenever
 * an edit lands on a border tile — up to three neighbours at a chunk corner.
 */
export function markChunkDirty(world: World, x: number, y: number): void {
  const size = world.size;
  if (x < 0 || x >= size || y < 0 || y >= size) return;
  const n = chunksPerSide(size);
  const cx0 = Math.max(0, Math.floor((x - 1) / CHUNK));
  const cx1 = Math.min(n - 1, Math.floor((x + 1) / CHUNK));
  const cy0 = Math.max(0, Math.floor((y - 1) / CHUNK));
  const cy1 = Math.min(n - 1, Math.floor((y + 1) / CHUNK));
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      world.chunkVersion[cy * n + cx]++;
    }
  }
}
