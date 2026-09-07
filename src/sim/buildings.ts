import { stockpileAccepts } from "./goods";
import {
  BuildingKind,
  BuildingState,
  ItemType,
  Loc,
  lairAt,
  type Building,
  type BuildingKindValue,
  type ItemTypeValue,
  type Sim,
} from "./store";
import {
  MASON_TICKS,
  MILL_TICKS,
  ROCK_PER_BLOCK,
  STOCKPILE_PER_TILE,
  WORKSHOP_INPUT_CAP,
  WORKSHOP_OUTPUT_CAP,
} from "./tuning";
import { Terrain, tileIndex } from "./world/world";

/**
 * Content definitions for the buildings the game ships. These are data, not
 * behaviour — when `assets/` grows a content format (ARCHITECTURE.md) this
 * table is what moves into it.
 */
export interface BuildingDef {
  readonly kind: BuildingKindValue;
  readonly name: string;
  readonly w: number;
  readonly h: number;
  /** Logs a blueprint must be fed before it can be built. */
  readonly cost: number;
  /** True if a colonist can be bound to it as a slot worker. */
  readonly hasSlot: boolean;
  /** What its slot worker makes, or null for a building that produces
   *  nothing. A workshop *is* its recipe: everything the mason needed beyond
   *  the sawmill is a second row here. */
  readonly recipe: Recipe | null;
}

/**
 * One workshop's conversion. `per` is how many inputs one output eats — the
 * ratio is the chain's cost dial, and the only difference between milling a
 * plank (1 log) and cutting a block (2 rock).
 */
export interface Recipe {
  readonly input: ItemTypeValue;
  readonly per: number;
  readonly output: ItemTypeValue;
  readonly ticks: number;
  readonly inputCap: number;
  readonly outputCap: number;
}

export const BUILDING_DEFS: Record<BuildingKindValue, BuildingDef> = {
  [BuildingKind.Stockpile]: {
    kind: BuildingKind.Stockpile,
    name: "Stockpile",
    w: 2,
    h: 2,
    cost: 2,
    hasSlot: false,
    recipe: null,
  },
  [BuildingKind.Sawmill]: {
    kind: BuildingKind.Sawmill,
    name: "Sawmill",
    w: 2,
    h: 2,
    cost: 4,
    hasSlot: true,
    recipe: {
      input: ItemType.Log,
      per: 1,
      output: ItemType.Plank,
      ticks: MILL_TICKS,
      inputCap: WORKSHOP_INPUT_CAP,
      outputCap: WORKSHOP_OUTPUT_CAP,
    },
  },
  /**
   * The mason: the sawmill's shape verbatim, one row down. Its real purpose is
   * systemic rather than economic — two slot workshops against five colonists
   * is what makes staffing a genuine trade-off for the first time, which is
   * CONCEPT's labour trap made playable.
   */
  [BuildingKind.Mason]: {
    kind: BuildingKind.Mason,
    name: "Mason",
    w: 2,
    h: 2,
    cost: 4,
    hasSlot: true,
    recipe: {
      input: ItemType.Rock,
      per: ROCK_PER_BLOCK,
      output: ItemType.Block,
      ticks: MASON_TICKS,
      inputCap: WORKSHOP_INPUT_CAP,
      outputCap: WORKSHOP_OUTPUT_CAP,
    },
  },
};

export function defOf(b: Building): BuildingDef {
  return BUILDING_DEFS[b.kind as BuildingKindValue];
}

/** The recipe this building works, or null if it is not a workshop. */
export function recipeOf(b: Building): Recipe | null {
  return defOf(b).recipe;
}

/** Every tile of a building's footprint, in row-major order. */
export function footprint(b: { x: number; y: number; w: number; h: number }): [number, number][] {
  const out: [number, number][] = [];
  for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) out.push([x, y]);
  return out;
}

export function coversTile(b: { x: number; y: number; w: number; h: number }, x: number, y: number): boolean {
  return x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;
}

/** The building at a tile, or null. */
export function buildingAt(sim: Sim, x: number, y: number): Building | null {
  for (const b of sim.buildings) if (coversTile(b, x, y)) return b;
  return null;
}

/**
 * The one tile a slot worker stands on: adjacent to the centre of the
 * footprint's south edge (+y). Deterministic and always the same tile for a
 * given building, so a restaffed worker returns to exactly where the last one
 * stood.
 */
export function workTile(b: Building): [number, number] {
  return [b.x + Math.floor(b.w / 2), b.y + b.h];
}

/** Items of a type held inside a building — buffer contents or delivered materials. */
export function storedCount(sim: Sim, buildingId: number, type: number): number {
  let n = 0;
  for (const it of sim.items) if (it.loc === Loc.Stored && it.holder === buildingId && it.type === type) n++;
  return n;
}

export function storedTotal(sim: Sim, buildingId: number): number {
  let n = 0;
  for (const it of sim.items) if (it.loc === Loc.Stored && it.holder === buildingId) n++;
  return n;
}

/** How many more items this building will take in, ignoring reservations. */
export function freeCapacity(sim: Sim, b: Building, type: number): number {
  if (b.state === BuildingState.Blueprint) {
    // A blueprint only takes its construction materials.
    if (type !== ItemType.Log) return 0;
    return defOf(b).cost - storedCount(sim, b.id, ItemType.Log);
  }
  if (b.state !== BuildingState.Active) return 0;
  const recipe = recipeOf(b);
  if (!recipe) {
    // A stockpile takes anything its filters allow, up to its floor area.
    if (b.kind !== BuildingKind.Stockpile) return 0;
    if (!stockpileAccepts(b, type)) return 0;
    return b.w * b.h * STOCKPILE_PER_TILE - storedTotal(sim, b.id);
  }
  // A workshop takes its input and nothing else — its output leaves, and is
  // never hauled back in.
  if (type !== recipe.input) return 0;
  return recipe.inputCap - storedCount(sim, b.id, recipe.input);
}

/** No room for what this workshop makes, so it must not start another. */
export function outputFull(sim: Sim, b: Building): boolean {
  const recipe = recipeOf(b);
  if (!recipe) return false;
  return storedCount(sim, b.id, recipe.output) >= recipe.outputCap;
}

/**
 * Can a footprint of `kind` be placed with its origin at (x, y)?
 *
 * Flat (one height across the whole footprint), on grass or sand, no trees,
 * no water, no overlap with another building, no ground items underneath, and
 * no lair anywhere in it — a den cannot be built over, or a monster could be
 * permanently shut away. Colonists deliberately do *not* block placement — the
 * footprint turns impassable and anyone standing in it walks out (see
 * commands.ts).
 */
export function canPlace(sim: Sim, kind: BuildingKindValue, x: number, y: number): boolean {
  const def = BUILDING_DEFS[kind];
  const { size, hmap, tmap, treeMap } = sim.world;
  if (x < 0 || y < 0 || x + def.w > size || y + def.h > size) return false;

  const h0 = hmap[tileIndex(x, y, size)];
  for (const [tx, ty] of footprint({ x, y, w: def.w, h: def.h })) {
    const i = tileIndex(tx, ty, size);
    if (hmap[i] !== h0) return false;
    if (tmap[i] !== Terrain.Grass && tmap[i] !== Terrain.Sand) return false;
    if (treeMap[i]) return false;
    if (buildingAt(sim, tx, ty)) return false;
    if (lairAt(sim, tx, ty)) return false;
  }
  for (const it of sim.items) {
    if (it.loc === Loc.Ground && coversTile({ x, y, w: def.w, h: def.h }, it.x, it.y)) return false;
  }
  // The work tile has to exist on the map, or the slot could never be filled.
  if (def.hasSlot && y + def.h >= size) return false;
  return true;
}
