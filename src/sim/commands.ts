import { BUILDING_DEFS, canPlace, defOf, footprint } from "./buildings";
import { groundItem } from "./items";
import { evictFromFootprint, leaveBuilding } from "./labour/colonists";
import { abandonTask, releaseTask } from "./labour/tasks";
import { occupancy } from "./path";
import {
  BuildingState,
  Loc,
  TaskKind,
  mintId,
  findBuilding,
  findColonist,
  findTask,
  type Building,
  type BuildingKindValue,
  type Colonist,
  type Sim,
} from "./store";
import { markChunkDirty, tileIndex, type World } from "./world/world";

/**
 * Player intent as plain data. Commands are the only way anything outside the
 * sim changes it, and they are applied at the *start* of a tick — the seam
 * ARCHITECTURE.md reserves for saves and replays. Same seed + the same command
 * log at the same ticks = the same colony, byte for byte.
 *
 * Pause and speed are deliberately not commands: they change how fast real
 * time is converted into ticks, which is the app's business, not the sim's. A
 * replay of the same command log at ×1 and at ×4 must give the same colony.
 */
export type Command =
  /**
   * Mark trees for felling. Carries a *list* of tile indices, not one tile,
   * because a drag-box over a wood is one gesture and has to be one command:
   * five hundred separate commands would bloat the log the golden test and
   * saves replay, and would let a box land half-applied across a tick
   * boundary. A single click sends a one-element list.
   *
   * Additive by definition — it never clears a mark. Un-marking is
   * `cancelChop`, so a marquee dragged over already-marked trees can only ever
   * add to the selection.
   */
  | { kind: "designateChop"; tiles: number[] }
  | { kind: "cancelChop"; x: number; y: number }
  | { kind: "place"; building: BuildingKindValue; x: number; y: number }
  | { kind: "cancelBlueprint"; building: number }
  | { kind: "staff"; building: number }
  | { kind: "unstaff"; building: number };

export function applyCommands(sim: Sim, commands: readonly Command[]): void {
  for (const command of commands) applyCommand(sim, command);
}

function applyCommand(sim: Sim, command: Command): void {
  switch (command.kind) {
    case "designateChop":
      return designateTiles(sim, command.tiles);
    case "cancelChop":
      return designate(sim, command.x, command.y, 0);
    case "place":
      return place(sim, command.building, command.x, command.y);
    case "cancelBlueprint":
      return cancelBlueprint(sim, command.building);
    case "staff":
      return staff(sim, command.building);
    case "unstaff":
      return unstaff(sim, command.building);
  }
}

function inBounds(world: World, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < world.size && y < world.size;
}

/** Mark a whole selection at once. Only tiles that actually hold a tree take. */
function designateTiles(sim: Sim, tiles: readonly number[]): void {
  const size = sim.world.size;
  for (const i of tiles) {
    if (!Number.isInteger(i) || i < 0 || i >= sim.chopMap.length) continue;
    designate(sim, i % size, Math.floor(i / size), 1);
  }
}

function designate(sim: Sim, x: number, y: number, on: number): void {
  if (!inBounds(sim.world, x, y)) return;
  const i = tileIndex(x, y, sim.world.size);
  if (on && !sim.world.treeMap[i]) return;
  if (sim.chopMap[i] === on) return;
  sim.chopMap[i] = on;
  // The mark is partly baked — a designated tree's canopy bakes gold-shifted
  // (render/props.ts) — so marking one is a geometry change, not just an
  // overlay change, and the chunk has to rebuild.
  markChunkDirty(sim.world, x, y);
  if (!on) {
    // Undesignating kills the task; a colonist already swinging at it stops.
    const occ = occupancy(sim);
    for (const task of [...sim.tasks]) {
      if (task.kind === TaskKind.Chop && task.x === x && task.y === y) abandonTask(sim, occ, task);
    }
  }
}

function place(sim: Sim, kind: BuildingKindValue, x: number, y: number): void {
  if (!canPlace(sim, kind, x, y)) return;
  const def = BUILDING_DEFS[kind];
  const b: Building = {
    id: mintId(sim),
    kind,
    x,
    y,
    w: def.w,
    h: def.h,
    state: BuildingState.Blueprint,
    progress: 0,
    reservedIncoming: 0,
    acceptLog: 1,
    acceptPlank: 1,
    worker: -1,
    millProgress: -1,
  };
  sim.buildings.push(b);
  for (const [tx, ty] of footprint(b)) markChunkDirty(sim.world, tx, ty);
  // The ground is impassable from this moment; anyone standing on it walks off.
  evictFromFootprint(sim, b);
}

/**
 * Cancel a blueprint. Delivered logs are put back on the ground rather than
 * refunded as a number — items are entities everywhere, so a cancelled site
 * leaves a pile someone has to fetch.
 */
function cancelBlueprint(sim: Sim, id: number): void {
  const b = findBuilding(sim, id);
  if (!b || b.state === BuildingState.Active) return;

  const pending = occupancy(sim);
  for (const task of [...sim.tasks]) {
    if (task.building === b.id) abandonTask(sim, pending, task);
  }
  if (b.worker >= 0) {
    const worker = findColonist(sim, b.worker);
    if (worker) {
      leaveBuilding(sim, worker, b);
      worker.slot = -1;
    }
    b.worker = -1;
  }

  const i = sim.buildings.indexOf(b);
  if (i >= 0) sim.buildings.splice(i, 1);
  // Occupancy is recomputed after the removal, so logs may land on the tiles
  // the site was standing on.
  const occ = occupancy(sim);
  for (const item of sim.items) {
    if (item.loc === Loc.Stored && item.holder === b.id) groundItem(sim, occ, item, b.x, b.y);
  }
  for (const [tx, ty] of footprint(b)) markChunkDirty(sim.world, tx, ty);
}

/**
 * Bind the nearest pool worker to a building's slot — idle or not. Taking a
 * busy colonist is the point: staffing a workshop is *supposed* to cost the
 * pool a pair of hands, and the interrupted task goes straight back to the
 * queue for someone else.
 */
function staff(sim: Sim, id: number): void {
  const b = findBuilding(sim, id);
  if (!b || b.state !== BuildingState.Active || !defOf(b).hasSlot || b.worker >= 0) return;

  let best: Colonist | null = null;
  let bestD = Infinity;
  for (const c of sim.colonists) {
    if (c.slot >= 0) continue;
    const d = Math.abs(Math.floor(c.x) - b.x) + Math.abs(Math.floor(c.y) - b.y);
    if (d < bestD || (d === bestD && best !== null && c.id < best.id)) {
      best = c;
      bestD = d;
    }
  }
  if (!best) return;

  if (best.task >= 0) {
    const task = findTask(sim, best.task);
    if (task) {
      if (best.carrying >= 0) {
        const occ = occupancy(sim);
        const carried = sim.items.find((it) => it.id === best.carrying);
        if (carried) groundItem(sim, occ, carried, Math.floor(best.x), Math.floor(best.y));
        best.carrying = -1;
      }
      task.claimedBy = -1;
      releaseTask(sim, task);
    }
    best.task = -1;
  }
  best.path = [];
  best.step = 0;
  best.work = 0;
  best.slot = b.id;
  b.worker = best.id;
}

/**
 * Return a slot worker to the pool. They step back out of the building to its
 * work tile — or the nearest free ground if something has blocked it since —
 * and are available for queue tasks from this tick on. Milling progress waits
 * on the building, so pulling someone out mid-cut costs nothing but time.
 */
function unstaff(sim: Sim, id: number): void {
  const b = findBuilding(sim, id);
  if (!b || b.worker < 0) return;
  const worker = findColonist(sim, b.worker);
  if (worker) {
    leaveBuilding(sim, worker, b);
    worker.slot = -1;
  }
  b.worker = -1;
}
