import {
  BUILDING_DEFS,
  buildingAt,
  canPlace,
  defOf,
  footprint,
  recipeOf,
  storedCount,
  workTile,
} from "../buildings";
import { GOODS, GOOD_LIST, stockpileAccepts } from "../goods";
import { canMine, canTerraform, isTargetHeight } from "../ground";
import { groundItemsAt } from "../items";
import {
  BuildingKind,
  BuildingState,
  ItemType,
  Loc,
  type Building,
  type Colonist,
  type Item,
  type Sim,
} from "../store";
import { BUILD_TICKS, DAY_TICKS, STOCKPILE_PER_TILE, WALL_ITEM_COST } from "../tuning";
import { WallState, canPlaceWall, isGateway, isStoneWall, razeMarked, wallAt, wallItem } from "../walls";
import { enclosedLand } from "../walls/enclosure";
import { tileIndex } from "../world/world";

/**
 * What the player is allowed to know.
 *
 * `render/` and `ui/` import from here and nowhere else in `sim/`, because the
 * moment they read the sim's truth directly, the watchtower mechanic quietly
 * stops being a mechanic (docs/ARCHITECTURE.md, "Truth and knowledge"). In
 * step 2 nothing is hidden, so most of this is an identity projection over the
 * live arrays — deliberately zero-copy, so the render loop allocates nothing.
 * When threats arrive, this module starts filtering and the consumers do not
 * have to change shape.
 */

export type { Building, Colonist, Item, Sim };
export { BuildingKind, BuildingState, ItemType, Loc, BUILDING_DEFS, defOf, footprint, workTile, canPlace };
export type { BuildingKindValue, ItemTypeValue } from "../store";
/**
 * The wall predicates the renderer is allowed: what a segment is made of,
 * whether it is a gateway, whether it is still a drawing. Exported so
 * `render/` can pick a model per segment without ever comparing a wall byte to
 * a state — which is the rule that let the stone tier append four states
 * without touching a consumer (`sim/walls`).
 */
export { WallState, canPlaceWall, wallAt, isGateway, isStoneWall };
export { isBlueprint as wallIsBlueprint } from "../walls";
export { GOODS, GOOD_LIST };
export type { GoodDef } from "../goods";
/** What one wall segment costs, and of what. The rail's cost captions read
 *  these rather than hard-coding "1 log" twice and "1 block" twice. */
export { WALL_ITEM_COST, wallItem };
export type { WallMaterial } from "../walls";

export function colonists(sim: Sim): readonly Colonist[] {
  return sim.colonists;
}

export function buildings(sim: Sim): readonly Building[] {
  return sim.buildings;
}

export function items(sim: Sim): readonly Item[] {
  return sim.items;
}

/** The ribbon's numbers. */
export interface Readout {
  /** How much of each good the colony holds, indexed by `ItemType` — every
   *  good the game has, so a new one appears on the ribbon by existing. */
  goods: number[];
  /** Everyone. */
  folk: number;
  /** Pool workers not currently on a task — the number staffing a slot eats into. */
  idle: number;
  /** Pool workers: population minus everyone locked in a workshop. */
  pool: number;
  slots: number;
  day: number;
  /**
   * Enclosed *land* tiles — the game's progress bar (docs/CONCEPT.md: land is
   * grabbed bite by bite). Water inside the wall is inside and deliberately
   * uncounted; so is the ground under the wall itself, which is not buildable.
   */
  enclosed: number;
}

export function readout(sim: Sim): Readout {
  const goods = GOOD_LIST.map(() => 0);
  for (const it of sim.items) {
    // Indexed by type rather than counted into named locals: an `else`
    // branch counting "everything that isn't a log" as planks is exactly the
    // shape that broke the moment a third good existed.
    if (it.type >= 0 && it.type < goods.length) goods[it.type]++;
  }
  let pool = 0;
  let idle = 0;
  for (const c of sim.colonists) {
    if (c.slot >= 0) continue;
    pool++;
    if (c.task < 0) idle++;
  }
  return {
    goods,
    folk: sim.colonists.length,
    idle,
    pool,
    slots: sim.colonists.length - pool,
    day: Math.floor(sim.tick / DAY_TICKS) + 1,
    enclosed: enclosedLand(sim),
  };
}

/** Is this tree marked for felling? */
export function isDesignated(sim: Sim, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= sim.world.size || y >= sim.world.size) return false;
  return sim.chopMap[y * sim.world.size + x] === 1;
}

/** Is this outcrop marked for quarrying? */
export function isMineMarked(sim: Sim, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= sim.world.size || y >= sim.world.size) return false;
  return sim.mineMap[y * sim.world.size + x] === 1;
}

/** Is this tile marked for levelling? */
export function isTerraformMarked(sim: Sim, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= sim.world.size || y >= sim.world.size) return false;
  return sim.terraformMap[y * sim.world.size + x] !== 0;
}

/**
 * The ground's own height — what the terraform tool captures from the tile the
 * player presses on, and turns into the whole drag's target. Knowledge rather
 * than truth in the strict sense: the shape of the land is something you can
 * see by looking at it.
 */
export function groundHeight(sim: Sim, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= sim.world.size || y >= sim.world.size) return 0;
  return sim.world.hmap[tileIndex(x, y, sim.world.size)];
}

/** Can these tools act on this tile at all? The tools ask before designating,
 *  so an ineligible tile ghosts as skipped instead of silently doing nothing. */
export { canMine, canTerraform, isTargetHeight };

export function hasTree(sim: Sim, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= sim.world.size || y >= sim.world.size) return false;
  return sim.world.treeMap[y * sim.world.size + x] === 1;
}

/**
 * The raw designation and tree layers, for the bulk per-tile work the renderer
 * does — meshing a chunk's trees, projecting every tree to test a drag-box.
 * Zero-copy, like the rest of this module: nothing here is hidden from the
 * player, and a per-tile predicate call would cost more than the read.
 */
export function chopLayer(sim: Sim): Uint8Array {
  return sim.chopMap;
}

export function treeLayer(sim: Sim): Uint8Array {
  return sim.world.treeMap;
}

export function mineLayer(sim: Sim): Uint8Array {
  return sim.mineMap;
}

export function terraformLayer(sim: Sim): Uint8Array {
  return sim.terraformMap;
}

export function wallLayer(sim: Sim): Uint8Array {
  return sim.wallMap;
}

export function razeLayer(sim: Sim): Uint8Array {
  return sim.razeMap;
}

/**
 * The enclosure layer, and the single-tile question threats will ask of it
 * from step 4. Nothing about inside/outside is hidden from the player — it is
 * read off the map by looking, per CONCEPT — so this is an identity projection
 * like the rest of this module.
 */
export function insideLayer(sim: Sim): Uint8Array {
  return sim.insideMap;
}

export function isInside(sim: Sim, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= sim.world.size || y >= sim.world.size) return false;
  return sim.insideMap[y * sim.world.size + x] === 1;
}

/** Is this tile marked for dismantling? `sim/walls` owns the bounds rule. */
export function isRazeMarked(sim: Sim, x: number, y: number): boolean {
  return razeMarked(sim, x, y);
}

/** Does this tile hold a wall of any kind — blueprint, palisade or gate? */
export function hasWall(sim: Sim, x: number, y: number): boolean {
  return wallAt(sim, x, y) !== WallState.None;
}

/** One good a building holds, for the panel to list. */
export interface StoredGood {
  type: number;
  name: string;
  count: number;
  accepted: boolean;
}

/** Everything the inspector panel shows about one building. */
export interface Inspection {
  id: number;
  name: string;
  kind: number;
  state: number;
  /** 0..1 while under construction. */
  progress: number;
  /** Logs delivered against logs required, for a blueprint. */
  delivered: number;
  cost: number;
  hasSlot: boolean;
  staffed: boolean;
  /**
   * Where the slot worker is. Once they are `inside` the renderer stops
   * drawing them, so this row and the labour meter's rust segment are the
   * only things telling the player someone is in there.
   */
  worker: "none" | "walking" | "inside";
  /**
   * Every good in the building, in `ItemType` order — the stockpile panel
   * walks this rather than naming logs and planks, which is what keeps a new
   * good from needing a new row of hard-coded UI.
   */
  stored: StoredGood[];
  storedTotal: number;
  capacity: number;
  /** The workshop's chain, or null for anything that produces nothing. Its
   *  names are what the panel's chain chips read. */
  chain: { input: string; output: string } | null;
  inputCount: number;
  inputCap: number;
  outputCount: number;
  outputCap: number;
  /** 0..1 through the current batch, or -1 when the workshop is not working. */
  milling: number;
  /**
   * Why a staffed workshop is not working, for the panel to say plainly. The
   * panel is the only place the game ever explains a stall — no alerts, no
   * colour changes — so it has to name the real reason rather than guess at
   * the commonest one. "no-input" rather than "no logs", because the mason
   * stalls on rock.
   */
  stall: "none" | "no-input" | "output-full";
}

export function inspect(sim: Sim, id: number): Inspection | null {
  const b = sim.buildings.find((x) => x.id === id);
  if (!b) return null;
  const def = defOf(b);
  const recipe = recipeOf(b);
  const stored = GOOD_LIST.map((good) => ({
    type: good.type,
    name: good.name,
    count: storedCount(sim, b.id, good.type),
    accepted: stockpileAccepts(b, good.type),
  }));
  const held = (type: number): number => stored.find((s) => s.type === type)?.count ?? 0;
  const inputCount = recipe ? held(recipe.input) : 0;
  const outputCount = recipe ? held(recipe.output) : 0;
  return {
    id: b.id,
    name: def.name,
    kind: b.kind,
    state: b.state,
    progress: Math.min(1, b.progress / BUILD_TICKS),
    delivered: held(ItemType.Log),
    cost: def.cost,
    hasSlot: def.hasSlot,
    staffed: b.worker >= 0,
    worker: workerState(sim, b),
    stored,
    storedTotal: stored.reduce((n, s) => n + s.count, 0),
    capacity: b.kind === BuildingKind.Stockpile ? b.w * b.h * STOCKPILE_PER_TILE : 0,
    chain: recipe ? { input: GOODS[recipe.input].name, output: GOODS[recipe.output].name } : null,
    inputCount,
    inputCap: recipe?.inputCap ?? 0,
    outputCount,
    outputCap: recipe?.outputCap ?? 0,
    milling: !recipe || b.millProgress < 0 ? -1 : Math.min(1, b.millProgress / recipe.ticks),
    stall:
      !recipe || b.worker < 0 || b.millProgress >= 0 ? "none"
      : outputCount >= recipe.outputCap ? "output-full"
      : "no-input",
  };
}

function workerState(sim: Sim, b: Building): "none" | "walking" | "inside" {
  if (b.worker < 0) return "none";
  const worker = sim.colonists.find((c) => c.id === b.worker);
  if (!worker) return "none";
  return worker.inside ? "inside" : "walking";
}

/** Which building, if any, the player just clicked. */
export function buildingAtTile(sim: Sim, x: number, y: number): Building | null {
  return buildingAt(sim, x, y);
}

/** Items lying loose on a tile — what the mover layer draws on the ground. */
export function groundItems(sim: Sim, x: number, y: number): Item[] {
  return groundItemsAt(sim, x, y);
}
