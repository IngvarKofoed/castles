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
  BEDS_PER_HOUSE,
  FARM_TICKS,
  MASON_TICKS,
  MILL_TICKS,
  MILL_TICKS_5B,
  OVEN_TICKS,
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
  /** How many items a blueprint must be fed before it can be built. */
  readonly cost: number;
  /**
   * Which item that is. **One type per def, never a mixture** — a multi-item
   * cost needs the per-site ledger the blueprint deliberately does not have
   * (see `actBuildWall`), and nothing has wanted one yet.
   *
   * Every consumer of `cost` reads this beside it: the blueprint's own
   * capacity, the haul that feeds it, the count that flips it to `Building`,
   * and the words the panel and the rail put on the number. Leaving any one of
   * them saying "log" is how the House ends up unbuildable while its planks
   * pile up inside it.
   */
  readonly costType: ItemTypeValue;
  /** True if a colonist can be bound to it as a slot worker. */
  readonly hasSlot: boolean;
  /**
   * Beds this building adds to the population cap once it is **active**. 0 for
   * everything that is not housing, so the cap is a sum over the whole array
   * with no kind test in it (`sim/settlers.ts`).
   */
  readonly beds: number;
  /** What its slot worker makes, or null for a building that produces
   *  nothing. A workshop *is* its recipe: everything the mason needed beyond
   *  the sawmill is a second row here. */
  readonly recipe: Recipe | null;
}

/**
 * One workshop's conversion. `per` is how many inputs one output eats — the
 * ratio is the chain's cost dial, and the only difference between milling a
 * plank (1 log) and cutting a block (2 rock).
 *
 * **`per: 0` with `inputCap: 0` is the no-input convention**, and the Farm is
 * its one user: a workshop that consumes nothing at all
 * (docs/specs/2026-09-08-bread-economy.md). The pair is pinned so two readers
 * cannot diverge, and `input` keeps its required type — set to the output good,
 * a dummy nobody reads — rather than becoming nullable, which would ripple a
 * type change through every consumer for the sake of one row.
 *
 * Almost nothing has to know: `stepWorkshop`'s batch gathering takes an empty
 * slice and passes, and `freeCapacity` / `generateHaulToInput` go inert off
 * `inputCap: 0`, so no haul is ever ordered. What *does* have to know is the
 * presentation — `know/inspect` renders a one-sided chain chip, suppresses the
 * input row, and never says "waiting for" about a recipe with no input.
 */
export interface Recipe {
  readonly input: ItemTypeValue;
  readonly per: number;
  readonly output: ItemTypeValue;
  readonly ticks: number;
  readonly inputCap: number;
  readonly outputCap: number;
}

/** Does this recipe eat anything at all? See `Recipe`'s no-input convention. */
export function consumes(recipe: Recipe): boolean {
  return recipe.per > 0;
}

export const BUILDING_DEFS: Record<BuildingKindValue, BuildingDef> = {
  [BuildingKind.Stockpile]: {
    kind: BuildingKind.Stockpile,
    name: "Stockpile",
    w: 2,
    h: 2,
    cost: 2,
    costType: ItemType.Log,
    hasSlot: false,
    beds: 0,
    recipe: null,
  },
  [BuildingKind.Sawmill]: {
    kind: BuildingKind.Sawmill,
    name: "Sawmill",
    w: 2,
    h: 2,
    cost: 4,
    costType: ItemType.Log,
    hasSlot: true,
    beds: 0,
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
    costType: ItemType.Log,
    hasSlot: true,
    beds: 0,
    recipe: {
      input: ItemType.Rock,
      per: ROCK_PER_BLOCK,
      output: ItemType.Block,
      ticks: MASON_TICKS,
      inputCap: WORKSHOP_INPUT_CAP,
      outputCap: WORKSHOP_OUTPUT_CAP,
    },
  },
  /**
   * The House: beds, and the sawmill's first real customer.
   *
   * It produces nothing and staffs nobody — its whole output is the population
   * cap it raises, which is what makes growth a placement decision rather than
   * a score (docs/CONCEPT.md: people are the only scarce currency). Built from
   * **planks**, which is why `costType` exists at all: it is the first building
   * in the game whose cost is not logs, so the log → plank chain finally has
   * somewhere to go.
   */
  [BuildingKind.House]: {
    kind: BuildingKind.House,
    name: "House",
    w: 2,
    h: 2,
    cost: 4,
    costType: ItemType.Plank,
    hasSlot: false,
    beds: BEDS_PER_HOUSE,
    recipe: null,
  },
  /**
   * The Farm: grain out of nothing but a farmer's hours, and **the biggest
   * footprint in the game** at 3×3 — a nudge toward land pressure, since
   * feeding more mouths means enclosing more flat ground.
   *
   * Its recipe is the `per: 0` convention (see `Recipe`): no input, no input
   * buffer, no haul ever ordered for it. Everything else about it is an
   * ordinary slot workshop — ceilings, stall notes, the produce-until row and
   * the panel's anatomy all come off `recipeOf()`, which is production
   * control's "any workshop with a recipe" promise being cashed.
   */
  [BuildingKind.Farm]: {
    kind: BuildingKind.Farm,
    name: "Farm",
    w: 3,
    h: 3,
    cost: 4,
    costType: ItemType.Log,
    hasSlot: true,
    beds: 0,
    recipe: {
      input: ItemType.Grain,
      per: 0,
      output: ItemType.Grain,
      ticks: FARM_TICKS,
      inputCap: 0,
      outputCap: WORKSHOP_OUTPUT_CAP,
    },
  },
  /** The grain mill: the Mason move repeated, one def row and no machinery. */
  [BuildingKind.Mill]: {
    kind: BuildingKind.Mill,
    name: "Mill",
    w: 2,
    h: 2,
    cost: 4,
    costType: ItemType.Log,
    hasSlot: true,
    beds: 0,
    recipe: {
      input: ItemType.Grain,
      per: 1,
      output: ItemType.Flour,
      ticks: MILL_TICKS_5B,
      inputCap: WORKSHOP_INPUT_CAP,
      outputCap: WORKSHOP_OUTPUT_CAP,
    },
  },
  /**
   * The Oven: flour into bread, and **the first building priced in blocks** —
   * the mason's first customer that is not a wall, which is the real outward
   * pull of the food chain (stone wants outcrops, and outcrops are out there).
   */
  [BuildingKind.Oven]: {
    kind: BuildingKind.Oven,
    name: "Oven",
    w: 2,
    h: 2,
    cost: 4,
    costType: ItemType.Block,
    hasSlot: true,
    beds: 0,
    recipe: {
      input: ItemType.Flour,
      per: 1,
      output: ItemType.Bread,
      ticks: OVEN_TICKS,
      inputCap: WORKSHOP_INPUT_CAP,
      outputCap: WORKSHOP_OUTPUT_CAP,
    },
  },
  /**
   * The Watchtower: **the first slot building with no recipe**, and the first
   * 1×1 footprint. Its whole output is knowledge — while its watcher is
   * inside, every den within `WATCH_RANGE` reads in tenths rather than fifths
   * (docs/specs/2026-09-09-watchtowers.md).
   *
   * `recipe: null` is what makes that cheap rather than a phantom good:
   * `stepWorkshops` skips it, `generateHaulToInput` never orders it anything,
   * `freeCapacity` gives it no room, and staffing, unstaffing and the labour
   * meter all work by table. The watcher is a slot like any other — a pair of
   * hands spent on information, which is CONCEPT's "information is
   * infrastructure" made literal, and it is the *running* price that makes
   * coverage rented rather than banked.
   */
  [BuildingKind.Watchtower]: {
    kind: BuildingKind.Watchtower,
    name: "Watchtower",
    w: 1,
    h: 1,
    cost: 4,
    costType: ItemType.Plank,
    hasSlot: true,
    beds: 0,
    recipe: null,
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
 * Is (x, y) a tile **beside** this footprint — Chebyshev 1 from its nearest
 * tile, so the eight around a 1×1 and the ring around anything larger?
 *
 * Shared rather than written twice: it is how a slot worker decides it has
 * reached its workshop (`atStation`) and how a wanderer decides it has reached
 * the House that invited it. Both want "standing next to the building" rather
 * than a fixed tile, because a fixed work tile can be water or off the map.
 */
export function besideFootprint(b: { x: number; y: number; w: number; h: number }, x: number, y: number): boolean {
  const dx = Math.max(b.x - x, 0, x - (b.x + b.w - 1));
  const dy = Math.max(b.y - y, 0, y - (b.y + b.h - 1));
  return Math.max(dx, dy) === 1;
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
    // A blueprint only takes its construction materials, and only the one type
    // its def names — planks for a House, logs for everything else.
    const def = defOf(b);
    if (type !== def.costType) return 0;
    return def.cost - storedCount(sim, b.id, def.costType);
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
  // never hauled back in. A **no-input** recipe takes nothing at all: its
  // `input` is a dummy naming its own output good (see `Recipe`), so without
  // the first clause the answer would go *negative* as the farm's own grain
  // piled up in its buffer.
  if (!consumes(recipe) || type !== recipe.input) return 0;
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
