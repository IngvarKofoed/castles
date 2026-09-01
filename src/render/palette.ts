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
 * Prop palette — trees, buildings and the goods they hold, lifted verbatim
 * from `mockups/mockup3d.html`'s colour table. These are *world* colours and
 * belong here; the HUD's tokens live in `docs/STYLEGUIDE.md` and never mix
 * with these. The one crossover is the in-world overlay grammar (sage / rust /
 * gold), which is UI vocabulary drawn into the world on purpose.
 */
export const PROP = {
  trunk: 0x6a4a2e,
  birch: 0xc9c0a4,
  leafA: 0x3c7d28,
  leafB: 0x529936,
  leafC: 0x74b23a,
  timber: 0xa9713f,
  stone: 0x9c9b8d,
  stoneWarm: 0xa69b83,
  clay: 0xc55430,
  door: 0x67452a,
  crate: 0xb08a56,
  plank: 0xd0b078,
  linen: 0xe3d8ba,
  tunic: 0x3f79ab,
  smock: 0x5f9438,
  wool: 0xc4763f,
  stake: 0x7a5a3c,
} as const;

/** Per-prop colour wobble, so a wood doesn't read as poured concrete. */
export const PROP_JITTER = 0.12;

/**
 * The in-world overlay grammar's tokens (docs/STYLEGUIDE.md). These are UI
 * vocabulary deliberately drawn into the world — gold = player intent, sage =
 * valid, rust = invalid, over a dark keyline so they survive the terrain. They
 * live beside the world palette because both feed `render/`, but they are the
 * styleguide's values and must match it exactly; never tune them here.
 */
export const OVERLAY = {
  gold: 0xdca23c,
  sage: 0x8fbf52,
  rust: 0xb8503a,
  keyline: 0x14170f,
} as const;

/** Straight-line blend between two packed sRGB hex colours. */
export function lerpHex(a: number, b: number, t: number): number {
  const mix = (shift: number): number => {
    const from = (a >> shift) & 0xff;
    const to = (b >> shift) & 0xff;
    return Math.round(from + (to - from) * t) << shift;
  };
  return mix(16) | mix(8) | mix(0);
}

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
