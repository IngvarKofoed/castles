import { defOf, freeCapacity, storedCount } from "../buildings";
import { groundItem, isFree, itemTile } from "../items";
import type { Occupancy } from "../path";
import {
  BuildingKind,
  BuildingState,
  ItemType,
  Loc,
  mintId,
  TaskKind,
  findBuilding,
  findColonist,
  findItem,
  type Building,
  type Item,
  type Sim,
  type Task,
} from "../store";
import { TASK_COOLDOWN_JITTER, TASK_COOLDOWN_TICKS } from "../tuning";
import { nextRand } from "../world/rng";
import { tileIndex } from "../world/world";

/**
 * Task generation and the reservation discipline.
 *
 * **A task owns its reservations.** Creating a task marks its item
 * (`item.reservedBy`) and claims one unit of the destination's incoming
 * capacity (`building.reservedIncoming`); finishing or cancelling it releases
 * both. That is a tick earlier than the spec's "reserve at claim", and
 * deliberately so: with the reservation attached to the task's whole life,
 * generation's "is this item free?" is one field read instead of a scan over
 * live tasks, and two haulers can never be sent for one log — the classic
 * colony-sim bug — by construction rather than by care.
 *
 * The cost is a priority inversion: a log reserved by a tidy-up haul is not
 * available to a blueprint raised a moment later. It self-heals — the log
 * reaches the stockpile and the site pulls it back out — so it costs a detour,
 * never a stall. Generating in priority order keeps it rare.
 *
 * Generation is a **top-up** and must stay idempotent: it only ever creates
 * the tasks the need is still short of, so running it every tick converges
 * instead of piling up duplicates.
 */

/** Create a task, taking its reservations. */
function addTask(sim: Sim, kind: number, item: Item | null, building: Building | null, x = -1, y = -1): Task {
  const task: Task = {
    id: mintId(sim),
    kind,
    item: item ? item.id : -1,
    building: building ? building.id : -1,
    x,
    y,
    claimedBy: -1,
    cooldown: 0,
  };
  if (item) item.reservedBy = task.id;
  // Build tasks subject a building rather than deliver into it.
  if (building && kind !== TaskKind.Build) building.reservedIncoming++;
  sim.tasks.push(task);
  return task;
}

/** Release a task's reservations and drop it. */
export function finishTask(sim: Sim, task: Task): void {
  releaseReservations(sim, task);
  const i = sim.tasks.indexOf(task);
  if (i >= 0) sim.tasks.splice(i, 1);
}

function releaseReservations(sim: Sim, task: Task): void {
  if (task.item >= 0) {
    const item = findItem(sim, task.item);
    if (item && item.reservedBy === task.id) item.reservedBy = -1;
  }
  if (task.building >= 0 && task.kind !== TaskKind.Build) {
    const b = findBuilding(sim, task.building);
    if (b) b.reservedIncoming = Math.max(0, b.reservedIncoming - 1);
  }
}

/**
 * Hand a task back to the queue after a failed claim: the colonist lets go,
 * the task sleeps briefly, and its reservations stay put so nobody else
 * targets the same item in the meantime. The jitter is the store PRNG's one
 * consumer — without it five colonists retry the same unreachable target on
 * the same tick, forever.
 */
export function releaseTask(sim: Sim, task: Task): void {
  task.claimedBy = -1;
  const roll = nextRand(sim.rngState);
  sim.rngState = roll.state;
  task.cooldown = TASK_COOLDOWN_TICKS + Math.floor(roll.value * TASK_COOLDOWN_JITTER);
}

/** Give up a task entirely — the colonist drops what they carry and the task dies. */
export function abandonTask(sim: Sim, occ: Occupancy, task: Task): void {
  const worker = task.claimedBy >= 0 ? findColonist(sim, task.claimedBy) : null;
  if (worker && worker.carrying >= 0) {
    const carried = findItem(sim, worker.carrying);
    if (carried) groundItem(sim, occ, carried, Math.floor(worker.x), Math.floor(worker.y));
    worker.carrying = -1;
  }
  if (worker) {
    worker.task = -1;
    worker.path = [];
    worker.step = 0;
    worker.work = 0;
  }
  finishTask(sim, task);
}

function liveTasks(sim: Sim, kind: number): Task[] {
  return sim.tasks.filter((t) => t.kind === kind);
}

/**
 * Top up the task queue so the live tasks of each kind match the colony's
 * outstanding need. Runs every tick, in priority order so that when two needs
 * compete for the same free log the more urgent one takes it.
 *
 * Generation never path-checks. Reachability is discovered when a colonist
 * claims the task; an unreachable target simply retries on a cooldown, which
 * is an accepted step-2 limit.
 */
export function generateTasks(sim: Sim): void {
  for (const t of sim.tasks) if (t.cooldown > 0) t.cooldown--;

  generateBuild(sim);
  generateHaulToSite(sim);
  generateHaulToInput(sim);
  generateChop(sim);
  generateHaulToStore(sim);
}

/** A building with its materials delivered wants exactly one build task. */
function generateBuild(sim: Sim): void {
  const has = new Set(liveTasks(sim, TaskKind.Build).map((t) => t.building));
  for (const b of sim.buildings) {
    if (b.state !== BuildingState.Building) continue;
    if (has.has(b.id)) continue;
    addTask(sim, TaskKind.Build, null, b, b.x, b.y);
  }
}

/** A blueprint short of logs wants one haul task per missing, unreserved unit. */
function generateHaulToSite(sim: Sim): void {
  for (const b of sim.buildings) {
    if (b.state !== BuildingState.Blueprint) continue;
    let missing = defOf(b).cost - storedCount(sim, b.id, ItemType.Log) - b.reservedIncoming;
    while (missing > 0) {
      const log = nearestFreeItem(sim, ItemType.Log, b.x, b.y, sourceForSite);
      if (!log) break;
      addTask(sim, TaskKind.HaulToSite, log, b);
      missing--;
    }
  }
}

/** A staffed sawmill with input room wants logs — from a stockpile or the ground. */
function generateHaulToInput(sim: Sim): void {
  for (const b of sim.buildings) {
    if (b.kind !== BuildingKind.Sawmill || b.state !== BuildingState.Active) continue;
    if (b.worker < 0) continue;
    let room = freeCapacity(sim, b, ItemType.Log) - b.reservedIncoming;
    while (room > 0) {
      const log = nearestFreeItem(sim, ItemType.Log, b.x, b.y, sourceForSite);
      if (!log) break;
      addTask(sim, TaskKind.HaulToInput, log, b);
      room--;
    }
  }
}

/** Every designated tree without a live chop task gets one. */
function generateChop(sim: Sim): void {
  const size = sim.world.size;
  const has = new Set(liveTasks(sim, TaskKind.Chop).map((t) => tileIndex(t.x, t.y, size)));
  for (let i = 0; i < sim.chopMap.length; i++) {
    if (!sim.chopMap[i]) continue;
    if (!sim.world.treeMap[i]) {
      // The tree went away without the designation being cleared; tidy up.
      sim.chopMap[i] = 0;
      continue;
    }
    if (has.has(i)) continue;
    const x = i % size;
    const y = (i - x) / size;
    addTask(sim, TaskKind.Chop, null, null, x, y);
  }
}

/**
 * Loose goods want a home: an item on the ground, or a plank finished in a
 * sawmill's output buffer, is hauled to any stockpile that accepts it and has
 * room. Buildings never hand items to each other — everything goes through
 * filtered storage (CONCEPT.md's Kubifaktorium model).
 */
function generateHaulToStore(sim: Sim): void {
  for (const item of sim.items) {
    if (!isFree(item)) continue;
    if (!isLoose(sim, item)) continue;
    const store = nearestStore(sim, item);
    if (!store) continue;
    addTask(sim, TaskKind.HaulToStore, item, store);
  }
}

/** On the ground, or sitting in a sawmill's output buffer. */
function isLoose(sim: Sim, item: Item): boolean {
  if (item.loc === Loc.Ground) return true;
  if (item.loc !== Loc.Stored) return false;
  const b = findBuilding(sim, item.holder);
  return b !== null && b.kind === BuildingKind.Sawmill && item.type === ItemType.Plank;
}

/** Items a construction site or a mill may pull from: loose, or in a stockpile. */
function sourceForSite(sim: Sim, item: Item): boolean {
  if (item.loc === Loc.Ground) return true;
  if (item.loc !== Loc.Stored) return false;
  const b = findBuilding(sim, item.holder);
  if (!b || b.state !== BuildingState.Active) return false;
  if (b.kind === BuildingKind.Stockpile) return true;
  // A finished plank may leave a sawmill, but its input logs may not.
  return b.kind === BuildingKind.Sawmill && item.type === ItemType.Plank;
}

function nearestFreeItem(
  sim: Sim,
  type: number,
  x: number,
  y: number,
  ok: (sim: Sim, item: Item) => boolean,
): Item | null {
  let best: Item | null = null;
  let bestD = Infinity;
  for (const item of sim.items) {
    if (item.type !== type || !isFree(item) || !ok(sim, item)) continue;
    const at = itemTile(sim, item);
    if (!at) continue;
    const d = Math.abs(at[0] - x) + Math.abs(at[1] - y);
    // Ties break by id, so the pick never depends on array order changing.
    if (d < bestD || (d === bestD && best !== null && item.id < best.id)) {
      best = item;
      bestD = d;
    }
  }
  return best;
}

function nearestStore(sim: Sim, item: Item): Building | null {
  const at = itemTile(sim, item);
  if (!at) return null;
  let best: Building | null = null;
  let bestD = Infinity;
  for (const b of sim.buildings) {
    if (b.kind !== BuildingKind.Stockpile || b.state !== BuildingState.Active) continue;
    if (b.id === item.holder) continue;
    if (freeCapacity(sim, b, item.type) - b.reservedIncoming <= 0) continue;
    const d = Math.abs(b.x - at[0]) + Math.abs(b.y - at[1]);
    if (d < bestD || (d === bestD && best !== null && b.id < best.id)) {
      best = b;
      bestD = d;
    }
  }
  return best;
}
