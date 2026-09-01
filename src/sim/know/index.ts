import {
  BUILDING_DEFS,
  buildingAt,
  canPlace,
  defOf,
  footprint,
  storedCount,
  workTile,
} from "../buildings";
import { groundItemsAt } from "../items";
import {
  BuildingKind,
  BuildingState,
  ItemType,
  Loc,
  type Building,
  type BuildingKindValue,
  type Colonist,
  type Item,
  type Sim,
} from "../store";
import {
  BUILD_TICKS,
  DAY_TICKS,
  MILL_TICKS,
  SAWMILL_INPUT_CAP,
  SAWMILL_OUTPUT_CAP,
  STOCKPILE_PER_TILE,
} from "../tuning";

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
export type { BuildingKindValue };

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
  logs: number;
  planks: number;
  /** Everyone. */
  folk: number;
  /** Pool workers not currently on a task — the number staffing a slot eats into. */
  idle: number;
  /** Pool workers: population minus everyone locked in a workshop. */
  pool: number;
  slots: number;
  day: number;
}

export function readout(sim: Sim): Readout {
  let logs = 0;
  let planks = 0;
  for (const it of sim.items) {
    if (it.type === ItemType.Log) logs++;
    else planks++;
  }
  let pool = 0;
  let idle = 0;
  for (const c of sim.colonists) {
    if (c.slot >= 0) continue;
    pool++;
    if (c.task < 0) idle++;
  }
  return {
    logs,
    planks,
    folk: sim.colonists.length,
    idle,
    pool,
    slots: sim.colonists.length - pool,
    day: Math.floor(sim.tick / DAY_TICKS) + 1,
  };
}

/** Is this tree marked for felling? */
export function isDesignated(sim: Sim, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= sim.world.size || y >= sim.world.size) return false;
  return sim.chopMap[y * sim.world.size + x] === 1;
}

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
  storedLogs: number;
  storedPlanks: number;
  capacity: number;
  inputCap: number;
  outputCap: number;
  /** 0..1 through the current cut, or -1 when the mill is not cutting. */
  milling: number;
  /**
   * Why a staffed mill is not cutting, for the panel to say plainly. The panel
   * is the only place the game ever explains a stall — no alerts, no colour
   * changes — so it has to name the real reason rather than guess at the
   * commonest one.
   */
  stall: "none" | "no-logs" | "output-full";
}

export function inspect(sim: Sim, id: number): Inspection | null {
  const b = sim.buildings.find((x) => x.id === id);
  if (!b) return null;
  const def = defOf(b);
  const logs = storedCount(sim, b.id, ItemType.Log);
  const planks = storedCount(sim, b.id, ItemType.Plank);
  return {
    id: b.id,
    name: def.name,
    kind: b.kind,
    state: b.state,
    progress: Math.min(1, b.progress / BUILD_TICKS),
    delivered: logs,
    cost: def.cost,
    hasSlot: def.hasSlot,
    staffed: b.worker >= 0,
    worker: workerState(sim, b),
    storedLogs: logs,
    storedPlanks: planks,
    capacity: b.kind === BuildingKind.Stockpile ? b.w * b.h * STOCKPILE_PER_TILE : 0,
    inputCap: SAWMILL_INPUT_CAP,
    outputCap: SAWMILL_OUTPUT_CAP,
    milling: b.millProgress < 0 ? -1 : Math.min(1, b.millProgress / MILL_TICKS),
    stall:
      b.kind !== BuildingKind.Sawmill || b.worker < 0 || b.millProgress >= 0 ? "none"
      : planks >= SAWMILL_OUTPUT_CAP ? "output-full"
      : "no-logs",
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
