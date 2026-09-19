import { Color } from "three";
import { ItemType, type ItemTypeValue } from "../sim/know";
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
  /** Quarried rubble — cooler and rawer than the cut stone below it, so a
   *  rock pile and a block pile are not the same grey. */
  rock: 0x8a9096,
  block: 0xb3ab97,
  /**
   * The bread chain's three goods. Straw, sacking and crust: grain reads olive
   * against the plank's tan, flour is the palest thing in the game, and the
   * loaf is **darker and redder than timber** so a bread pile and a log pile
   * are not the same brown at a glance.
   */
  grain: 0xa89b3e,
  flour: 0xeae3cd,
  bread: 0x96552b,
  /**
   * The cloth chain's three goods, and the dairy's. Named `fleece` / `bolt` /
   * `garment` rather than after the goods themselves because `wool` below is
   * already taken — by one of the *colonist* cloth colours, which predates the
   * good by seven steps and is what a dressed colonist actually wears.
   *
   * Raw fleece is cream, warmer and darker than `flour`'s sacking; the woven
   * bolt is the game's only blue *good*, so a bolt on the ground is never a
   * plank; the garment is that blue deepened, which is the rock/block move one
   * chain over. Cheese is a pale yellow kept clear of both `grain`'s olive and
   * the overlay grammar's gold.
   */
  fleece: 0xddd0b0,
  bolt: 0x7e93a3,
  garment: 0x4d6d8e,
  /**
   * The drink chain's two goods. **Honey must not read as `gold`** — gold is
   * player intent and nothing else in the world may wear it — so it is a deep
   * amber, darker and redder than the overlay's `0xdca23c`, the way `bread` is
   * darker and redder than `timber`. Mead is a pale straw, lifted clear of
   * `sand`'s grey-beige and of `cheese`'s yellow.
   */
  honey: 0xc07a1e,
  mead: 0xe8d79a,
  cheese: 0xe0c765,
  linen: 0xe3d8ba,
  tunic: 0x3f79ab,
  smock: 0x5f9438,
  wool: 0xc4763f,
  /**
   * What an **unclothed** colonist wears: one drab, undyed tone, against the
   * three dyed cloths above. That is the whole visual of the equipment step —
   * dressing the colony literally brings colour to it, and the difference reads
   * at map distance without the HUD saying a word
   * (docs/specs/2026-09-10-sheep-and-clothes.md).
   */
  drab: 0x8a8272,
  stake: 0x7a5a3c,
  /**
   * The Wilds. Orcs read green and lean, trolls grey and bulky — the split has
   * to be legible at a glance, because reading the map is the player's whole
   * toolkit (docs/CONCEPT.md). Deliberately *not* rust or red: these are things
   * in the world, not warnings, and the HUD's colour law owns the alarm.
   */
  orcHide: 0x5c7a3a,
  orcRag: 0x4a5230,
  trollHide: 0x7d8286,
  trollRag: 0x5c6165,
  /** Worked farmland: turned earth, and the green standing in its furrows.
   *  Darker and browner than the grass it sits in, so a farm reads as a plot. */
  soil: 0x6b5433,
  crop: 0x7f9a3c,
  /** A doorway, or anything else that has to read as an opening rather than as
   *  a shadow: the darkest thing in the world palette. */
  doorway: 0x241f18,
  /**
   * A beached longship: a tarred hull, a pale trim along its sheer and a furled
   * sail on the mast.
   *
   * It is the one thing on the map that says *they came from there*, so it is
   * read by silhouette and by contrast against pale sand — dark hull, tall mast,
   * nothing else on a beach that shape. Deliberately not rust or red: a boat is
   * a thing in the world, not a warning, and the HUD's colour law owns the
   * alarm (docs/STYLEGUIDE.md).
   */
  hull: 0x33291f,
  hullTrim: 0x8a6f45,
  sail: 0xc9b997,
  /** A grave marker: weathered board and turned earth. */
  graveBoard: 0x7d6b4e,
  graveEarth: 0x4a4231,
  /**
   * The motes: bees over a hive or a field, chimney smoke, birds on a circuit.
   *
   * All three are specks a pixel or two across at the opening zoom, so they are
   * read by *contrast* rather than by hue. The bee is a dark amber kept beside
   * `honey` — bees and honey are the same fact — the smoke is the palest warm
   * grey in the world palette so it lifts off both roof and grass, and the bird
   * is near-charcoal because it is seen against lit ground from this camera and
   * nothing else. **None of them is gold**: gold is player intent and nothing in
   * the world may wear it.
   */
  bee: 0x6b4f18,
  smoke: 0xc4bdae,
  bird: 0x3c3a33,
  /**
   * The wandering fauna. A sheep is the Pasture's `fleece` over the `door`
   * brown its face and legs already used when the flock was baked into the
   * fence; a deer is a warm tan with a pale rump.
   *
   * **A deer must never be mistaken for a monster.** Orcs are lean and green,
   * trolls bulky and grey, and both stand at folk height on two legs; a deer is
   * low, four-legged and tan, which is a different silhouette before it is a
   * different colour. Tan is also kept clear of `timber` and `crate` so a deer
   * on open grass is not read as a dropped log.
   */
  deerHide: 0x9c6b3c,
  deerRump: 0xd9c3a0,
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

/**
 * Which colour a good is drawn in, keyed by `ItemType` — one table, so the
 * mover layer's ground pile and a building's buffer contents cannot disagree
 * about what a rock looks like. These are the styleguide's good tokens, the
 * same ones the Stores panel's pips read as CSS vars: the pip and the pile
 * are one object seen twice.
 */
export const GOOD_HEX: Record<ItemTypeValue, number> = {
  [ItemType.Log]: PROP.timber,
  [ItemType.Plank]: PROP.plank,
  [ItemType.Rock]: PROP.rock,
  [ItemType.Block]: PROP.block,
  [ItemType.Grain]: PROP.grain,
  [ItemType.Flour]: PROP.flour,
  [ItemType.Bread]: PROP.bread,
  [ItemType.Wool]: PROP.fleece,
  [ItemType.Cloth]: PROP.bolt,
  [ItemType.Clothes]: PROP.garment,
  [ItemType.Cheese]: PROP.cheese,
  [ItemType.Honey]: PROP.honey,
  [ItemType.Mead]: PROP.mead,
};

/**
 * How far a designated thing shifts toward the gold accent, per the
 * styleguide's two-marks rule: enough to pick a marked wood or outcrop out at
 * a distance, small enough that it still reads as a tree or as rock rather
 * than as an overlay. Shared by the tree canopy, the raze-marked timber and
 * the mine-marked rock face so the three cannot drift apart.
 */
export const DESIGNATED_TINT = 0.15;

/**
 * How dark a bitten segment goes, per third of damage — sound, past a third,
 * past two thirds. Multiplicative on the member's own colour, so a chewed
 * palisade reads as *worn timber* rather than as a coloured overlay: the world
 * stays the world, and the panel is still where numbers live
 * (docs/STYLEGUIDE.md, Tone).
 */
export const DAMAGE_SHADE = [1, 0.82, 0.64] as const;

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
 *
 * `tint` shifts the palette colour toward the gold accent *before* the
 * conversion out of sRGB, which is where the tree canopy's designation tint
 * happens too — folded in afterwards, in linear space, the same fraction
 * reads visibly weaker.
 */
export function tileColor(world: World, x: number, y: number, tint = 0): Color {
  const t = world.tmap[tileIndex(x, y, world.size)] as TerrainValue;
  COL.setHex(tint > 0 ? lerpHex(TERRAIN_HEX[t], OVERLAY.gold, tint) : TERRAIN_HEX[t]);
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
