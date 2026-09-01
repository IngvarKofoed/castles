import { Color } from "three";
import { hash } from "../sim/world/noise";
import { Terrain, tileIndex, type TerrainValue, type World } from "../sim/world/world";

/** Terrain palette — the mockup's colours keyed by the Terrain enum. */
export const TERRAIN_HEX: Record<TerrainValue, number> = {
  [Terrain.Water]: 0x3c87ab, // seabed
  [Terrain.Sand]: 0xe3c983,
  [Terrain.Grass]: 0x7ec043,
  [Terrain.Rock]: 0x939aa1,
};

/**
 * Per-block colour wobble so nothing reads as poured concrete. Water has no
 * entry, exactly as the mockup's JITTER table — a jittered seabed would read
 * as dapple the mockup doesn't have.
 */
const TERRAIN_JITTER: Record<TerrainValue, number> = {
  [Terrain.Water]: 0,
  [Terrain.Sand]: 0.09,
  [Terrain.Grass]: 0.14,
  [Terrain.Rock]: 0.1,
};

const JITTER_SEED_SALT = 0x6a09e667;

const AO_KERNEL: readonly (readonly [number, number, number])[] = [
  [1, 0, 0.06],
  [-1, 0, 0.06],
  [0, 1, 0.06],
  [0, -1, 0.06],
  [1, 1, 0.032],
  [-1, -1, 0.032],
  [1, -1, 0.032],
  [-1, 1, 0.032],
];

/** Cheap baked occlusion: a tile sitting below its neighbours goes darker. */
export function tileAO(world: World, x: number, y: number): number {
  const h = world.hmap[tileIndex(x, y, world.size)];
  let occ = 0;
  for (const [dx, dy, w] of AO_KERNEL) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || nx >= world.size || ny < 0 || ny >= world.size) continue;
    const rise = world.hmap[tileIndex(nx, ny, world.size)] - h;
    if (rise > 0) occ += Math.min(rise, 3) * w;
  }
  return 1 - Math.min(0.32, occ);
}

const COL = new Color();

/**
 * Final linear-space colour of a tile: palette × jitter × AO. Water gets
 * neither jitter nor AO. Returns a shared Color — copy, don't keep.
 */
export function tileColor(world: World, x: number, y: number): Color {
  const t = world.tmap[tileIndex(x, y, world.size)] as TerrainValue;
  COL.setHex(TERRAIN_HEX[t]);
  if (t !== Terrain.Water) {
    const amt = TERRAIN_JITTER[t];
    if (amt) {
      const j = hash(x, y, world.seed ^ JITTER_SEED_SALT);
      COL.multiplyScalar(1 - amt * 0.5 + j * amt);
    }
    COL.multiplyScalar(tileAO(world, x, y));
  }
  return COL;
}
