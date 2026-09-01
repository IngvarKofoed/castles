import {
  BuildingKind,
  BuildingState,
  ItemType,
  Loc,
  type Building,
  type BuildingKindValue,
  type Sim,
} from "./store";
import { SAWMILL_INPUT_CAP, SAWMILL_OUTPUT_CAP, STOCKPILE_PER_TILE } from "./tuning";
import { Terrain, tileIndex } from "./world/world";

/**
 * Content definitions for the two buildings step 2 ships. These are data, not
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
}

export const BUILDING_DEFS: Record<BuildingKindValue, BuildingDef> = {
  [BuildingKind.Stockpile]: {
    kind: BuildingKind.Stockpile,
    name: "Stockpile",
    w: 2,
    h: 2,
    cost: 2,
    hasSlot: false,
  },
  [BuildingKind.Sawmill]: {
    kind: BuildingKind.Sawmill,
    name: "Sawmill",
    w: 2,
    h: 2,
    cost: 4,
    hasSlot: true,
  },
};

export function defOf(b: Building): BuildingDef {
  return BUILDING_DEFS[b.kind as BuildingKindValue];
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
  if (b.kind === BuildingKind.Stockpile) {
    if (type === ItemType.Log && !b.acceptLog) return 0;
    if (type === ItemType.Plank && !b.acceptPlank) return 0;
    return b.w * b.h * STOCKPILE_PER_TILE - storedTotal(sim, b.id);
  }
  // Sawmill: logs into the input buffer; planks are output, never hauled in.
  if (type !== ItemType.Log) return 0;
  return SAWMILL_INPUT_CAP - storedCount(sim, b.id, ItemType.Log);
}

export function sawmillOutputFull(sim: Sim, b: Building): boolean {
  return storedCount(sim, b.id, ItemType.Plank) >= SAWMILL_OUTPUT_CAP;
}

/**
 * Can a footprint of `kind` be placed with its origin at (x, y)?
 *
 * Flat (one height across the whole footprint), on grass or sand, no trees,
 * no water, no overlap with another building, no ground items underneath.
 * Colonists deliberately do *not* block placement — the footprint turns
 * impassable and anyone standing in it walks out (see commands.ts).
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
  }
  for (const it of sim.items) {
    if (it.loc === Loc.Ground && coversTile({ x, y, w: def.w, h: def.h }, it.x, it.y)) return false;
  }
  // The work tile has to exist on the map, or the slot could never be filled.
  if (def.hasSlot && y + def.h >= size) return false;
  return true;
}
