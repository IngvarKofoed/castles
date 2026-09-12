import { defOf, freeCapacity, recipeOf, storedCount } from "../buildings";
import { atLimit } from "../economy/limits";
import { canMine, isTargetHeight, keepsTerraforming } from "../ground";
import { groundItem, isFree, itemTile } from "../items";
import { occupancy, type Occupancy } from "../path";
import {
  BuildingKind,
  BuildingState,
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
import { WallState, isBlueprint, isBuilt, wallItem, wallMaterial, wallNeedsRepair } from "../walls";
import { markEnclosureStale } from "../walls/enclosure";
import { nextRand } from "../world/rng";
import { markChunkDirty, tileIndex } from "../world/world";

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

  // Generated in `TASK_PRIORITY` order, so when two needs compete for the same
  // free log the more urgent one reserves it first.
  generateBuild(sim);
  generateBuildWall(sim);
  generateHaulToSite(sim);
  generateHaulToInput(sim);
  generateDesignations(sim);
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

/**
 * A blueprint short of its materials wants one haul task per missing,
 * unreserved unit — of **the material its def names**, which is planks for a
 * House and logs for everything else. Sourced exactly as a workshop's input
 * is, so a plank reaches a building site from a stockpile or off the ground
 * with no second rule.
 */
function generateHaulToSite(sim: Sim): void {
  for (const b of sim.buildings) {
    if (b.state !== BuildingState.Blueprint) continue;
    const def = defOf(b);
    let missing = def.cost - storedCount(sim, b.id, def.costType) - b.reservedIncoming;
    while (missing > 0) {
      const stuff = nearestFreeItem(sim, def.costType, b.x, b.y, sourceForSite);
      if (!stuff) break;
      addTask(sim, TaskKind.HaulToSite, stuff, b);
      missing--;
    }
  }
}

/**
 * A staffed workshop with input room wants its input — from a stockpile or the
 * ground. Which good that is comes off the recipe, so the mason's rock flows
 * exactly as the sawmill's logs do.
 *
 * Unless its output is at its ceiling: then no new input is ordered, which is
 * the brake's first half (the second is `stepWorkshop` not starting a batch).
 * Hauls already generated are left alone — they deliver, and up to `inputCap`
 * logs then sit in the buffer until the count drops and milling resumes. That
 * is the accepted quirk (docs/specs/2026-09-07-production-control.md): inputs
 * are never taken back out of a workshop.
 */
function generateHaulToInput(sim: Sim): void {
  for (const b of sim.buildings) {
    if (b.state !== BuildingState.Active || b.worker < 0) continue;
    const recipe = recipeOf(b);
    if (!recipe) continue;
    if (atLimit(sim, recipe.output)) continue;
    let room = freeCapacity(sim, b, recipe.input) - b.reservedIncoming;
    while (room > 0) {
      const good = nearestFreeItem(sim, recipe.input, b.x, b.y, sourceForSite);
      if (!good) break;
      addTask(sim, TaskKind.HaulToInput, good, b);
      room--;
    }
  }
}

/**
 * Every wall blueprint gets one build-wall task — once a free item of **its
 * own material** exists for it: a log for timber, a block for stone. The item
 * is reserved at creation like any other task's, so two builders can never be
 * sent for the same one; a segment with nothing available simply has no task
 * yet and sits as a ghost frame until something turns up. Which is the whole
 * of the stone tier's plumbing on this side: a stone line drawn before the
 * mason is running is a line of frames, waiting.
 *
 * Deduplicated by *tile*, the same idempotence rule chop already proves, so
 * running every tick tops the queue up instead of piling duplicates on.
 */
function generateBuildWall(sim: Sim): void {
  const size = sim.world.size;
  const has = new Set(liveTasks(sim, TaskKind.BuildWall).map((t) => tileIndex(t.x, t.y, size)));
  for (let i = 0; i < sim.wallMap.length; i++) {
    if (!isBlueprint(sim.wallMap[i])) continue;
    if (has.has(i)) continue;
    const x = i % size;
    const y = (i - x) / size;
    const stuff = nearestFreeItem(sim, wallItem(wallMaterial(sim.wallMap[i])), x, y, sourceForSite);
    if (!stuff) continue;
    addTask(sim, TaskKind.BuildWall, stuff, null, x, y);
  }
}

/**
 * Dismantling. A **built** segment gets a raze task; a segment that is still a
 * *blueprint* is torn up on the spot, here, because there is nothing to work
 * down — the blueprint clears and any live build-wall task for it goes through
 * `abandonTask`, which releases the item's reservation and drops it wherever
 * the builder is standing. That drop **is** the refund, for a block exactly as
 * for a log: no ledger tracks delivery, because the material is carried right
 * up to the completion instant.
 */
function razeTile(
  sim: Sim,
  i: number,
  x: number,
  y: number,
  has: Set<number>,
  occ: Occupancy | null,
): Occupancy | null {
  const state = sim.wallMap[i];

  if (isBlueprint(state)) {
    sim.wallMap[i] = WallState.None;
    sim.razeMap[i] = 0;
    const pending = occ ?? occupancy(sim);
    for (const task of [...sim.tasks]) {
      if (task.kind === TaskKind.BuildWall && task.x === x && task.y === y) abandonTask(sim, pending, task);
    }
    markChunkDirty(sim.world, x, y);
    markEnclosureStale(sim);
    return pending;
  }
  if (!isBuilt(state)) {
    // The wall went away without the mark being cleared; tidy up.
    sim.razeMap[i] = 0;
    markChunkDirty(sim.world, x, y);
    return occ;
  }
  if (!has.has(i)) addTask(sim, TaskKind.Raze, null, null, x, y);
  return occ;
}

/**
 * The four designation layers — chop, mine, raze, terraform — **and wall
 * damage**, in one walk of the grid: one task per marked or wounded tile, plus
 * the tidy-up for a mark whose subject has gone away.
 *
 * One walk rather than one per layer because the walk *is* the cost: at 256²
 * the loop overhead dwarfs the byte reads inside it, and this is the hottest
 * thing in the tick. It is also why the earlier three-scan version was
 * already the recorded thing to index first
 * (docs/changelog/2026-09-02-palisade-walls.md); merging is the cheap half of
 * that, and it is why bite damage joined this pass rather than adding a scan
 * of its own.
 *
 * **Their relative order is immaterial and that is load-bearing** — none of
 * the five reserves an item, so nothing here competes for a log the way
 * build-wall and the hauls do. What decides which of them a colonist actually
 * picks up is `TASK_PRIORITY` at claim time, not the order they were made in,
 * which is exactly why repair can be generated last and still outrank hauling.
 * A future designation kind that *does* reserve something must not join this
 * pass; it belongs at its own place in the priority run above.
 */
function generateDesignations(sim: Sim): void {
  const size = sim.world.size;
  const chopping = tileTasks(sim, TaskKind.Chop, size);
  const mining = tileTasks(sim, TaskKind.Mine, size);
  const razing = tileTasks(sim, TaskKind.Raze, size);
  const levelling = tileTasks(sim, TaskKind.Terraform, size);
  const repairing = tileTasks(sim, TaskKind.Repair, size);
  let occ: Occupancy | null = null;

  // Repair is the one tile task whose *subject* can vanish without leaving a
  // mark behind: a segment bitten to pieces takes its damage to zero as it
  // falls, so the grid walk below never reaches that tile again and the tidy-up
  // there can never fire. Left alone the task outlives the wall — and it sits
  // above hauling, so somebody claims it and walks to open ground before
  // discovering there is nothing to mend.
  for (const task of [...sim.tasks]) {
    if (task.kind !== TaskKind.Repair) continue;
    const i = tileIndex(task.x, task.y, size);
    if (wallNeedsRepair(sim, i)) continue;
    occ ??= occupancy(sim);
    abandonTask(sim, occ, task);
    repairing.delete(i);
  }

  for (let i = 0; i < sim.chopMap.length; i++) {
    const chop = sim.chopMap[i];
    const mine = sim.mineMap[i];
    const raze = sim.razeMap[i];
    const level = sim.terraformMap[i];
    const hurt = sim.wallDamageMap[i];
    if (!chop && !mine && !raze && !level && !hurt) continue;
    const x = i % size;
    const y = (i - x) / size;

    // A wounded segment wants exactly one repairer, deduplicated by tile like
    // every other tile task. Nothing to hand it: repair is labour alone.
    if (hurt) {
      if (!wallNeedsRepair(sim, i)) sim.wallDamageMap[i] = 0;
      else if (!repairing.has(i)) addTask(sim, TaskKind.Repair, null, null, x, y);
    }

    if (chop) {
      if (!sim.world.treeMap[i]) {
        // The tree went away without the designation being cleared; tidy up.
        sim.chopMap[i] = 0;
      } else if (!chopping.has(i)) {
        addTask(sim, TaskKind.Chop, null, null, x, y);
      }
    }

    if (mine) {
      // Already quarried, or somehow no longer rock: drop the mark rather than
      // keep a task nobody can finish. The mark is baked, so this dirties the
      // chunk like clearing a chop mark by hand does.
      if (!canMine(sim, x, y)) {
        sim.mineMap[i] = 0;
        markChunkDirty(sim.world, x, y);
      } else if (!mining.has(i)) {
        addTask(sim, TaskKind.Mine, null, null, x, y);
      }
    }

    if (raze) occ = razeTile(sim, i, x, y, razing, occ);

    if (level) {
      // A tile at its target is finished; one that has grown a wall, a
      // building or a tree since is not levellable at all. Both drop the mark
      // here rather than only in the task, so a designation the player can no
      // longer act on cannot sit on the map looking like work.
      const target = level - 1;
      if (!isTargetHeight(target) || sim.world.hmap[i] === target || !keepsTerraforming(sim, x, y)) {
        sim.terraformMap[i] = 0;
      } else if (!levelling.has(i)) {
        addTask(sim, TaskKind.Terraform, null, null, x, y);
      }
    }
  }
}

/** Tiles that already have a live task of this kind — the dedup key that makes
 *  generation a top-up rather than a pile-up. */
function tileTasks(sim: Sim, kind: number, size: number): Set<number> {
  const out = new Set<number>();
  for (const t of sim.tasks) if (t.kind === kind) out.add(tileIndex(t.x, t.y, size));
  return out;
}

/**
 * Loose goods want a home: an item on the ground, or a finished good sitting
 * in a workshop's output buffer, is hauled to any stockpile that accepts it
 * and has room. Buildings never hand items to each other — everything goes
 * through filtered storage (CONCEPT.md's Kubifaktorium model), which is why a
 * block reaches a wall by way of a stockpile unless a builder happens to be
 * the one who empties the mason.
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

/** On the ground, or sitting in a workshop's output buffer. */
function isLoose(sim: Sim, item: Item): boolean {
  if (item.loc === Loc.Ground) return true;
  if (item.loc !== Loc.Stored) return false;
  const b = findBuilding(sim, item.holder);
  return b !== null && isOutputOf(b, item);
}

/**
 * Items a construction site or a workshop may pull from: loose, or in a
 * stockpile. Asked of the *recipe* rather than of the building's kind, so a
 * finished block may leave the mason exactly as a finished plank may leave the
 * sawmill — and neither workshop's inputs may be taken back out.
 *
 * Exported for the meal errand (`labour/colonists`), which sources a loaf by
 * exactly this rule: a colonist eats off the ground, out of a stockpile, or
 * out of the oven's own output buffer, and from nowhere else.
 */
export function sourceForSite(sim: Sim, item: Item): boolean {
  if (item.loc === Loc.Ground) return true;
  if (item.loc !== Loc.Stored) return false;
  const b = findBuilding(sim, item.holder);
  if (!b || b.state !== BuildingState.Active) return false;
  if (b.kind === BuildingKind.Stockpile) return true;
  return isOutputOf(b, item);
}

/** Is this item the finished good of the workshop holding it? */
function isOutputOf(b: Building, item: Item): boolean {
  const recipe = recipeOf(b);
  return recipe !== null && item.type === recipe.output;
}

/**
 * The nearest unreserved item of a type that `ok` accepts, by Manhattan
 * distance with ties broken by id. Exported alongside `sourceForSite` for the
 * self-errands, which ask the same question about food and clothes that task
 * generation asks about logs.
 *
 * `type` takes a **list** as well as a single good, for the meal errand's sake:
 * a colonist eats the nearest free *food* of any kind, with no preference order
 * between bread and cheese, and comparing per-type winners afterwards would
 * break the id tie-break across the boundary between two equally near goods
 * (docs/specs/2026-09-10-sheep-and-clothes.md).
 */
export function nearestFreeItem(
  sim: Sim,
  type: number | readonly number[],
  x: number,
  y: number,
  ok: (sim: Sim, item: Item) => boolean,
): Item | null {
  let best: Item | null = null;
  let bestD = Infinity;
  const wanted = (t: number): boolean => (typeof type === "number" ? t === type : type.includes(t));
  for (const item of sim.items) {
    if (!wanted(item.type) || !isFree(item) || !ok(sim, item)) continue;
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
