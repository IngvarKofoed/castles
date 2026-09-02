import { buildingAt, defOf, footprint, workTile } from "../buildings";
import {
  carryItem,
  dropTile,
  groundItem,
  groundItemsAt,
  itemTile,
  removeItem,
  spawnItem,
  storeItem,
} from "../items";
import {
  adjacentToBuilding,
  adjacentToTile,
  escapePath,
  findPath,
  occupancy,
  passable,
  reachTile,
  type Occupancy,
} from "../path";
import {
  BuildingState,
  ItemType,
  Loc,
  Phase,
  TaskKind,
  findBuilding,
  findItem,
  findTask,
  type Building,
  type Colonist,
  type Item,
  type Sim,
  type Task,
} from "../store";
import {
  BUILD_TICKS,
  CHOP_TICKS,
  GATE_BUILD_TICKS,
  RAZE_TICKS,
  TASK_PRIORITY,
  WALK_TILES_PER_TICK,
  WALL_BUILD_TICKS,
} from "../tuning";
import { WallState, builtForm, isBlueprint, isBuilt, isWalkable } from "../walls";
import { markEnclosureStale } from "../walls/enclosure";
import { markChunkDirty, tileIndex } from "../world/world";
import { abandonTask, finishTask, releaseTask } from "./tasks";

/**
 * Colonist behaviour: claim → reserve → walk → act → release.
 *
 * Colonists step in id order, which is the whole tie-break story — no
 * simultaneity, no shuffling. Every position write goes through `move`, which
 * records the previous tick's position first so the renderer can interpolate
 * between two ticks and 10 Hz never looks like 10 Hz.
 */
export function stepColonists(sim: Sim): void {
  const occ = occupancy(sim);
  for (const c of sim.colonists) {
    c.px = c.x;
    c.py = c.y;
    if (c.slot >= 0) stepSlotWorker(sim, occ, c);
    else stepPoolWorker(sim, occ, c);
  }
}

/**
 * A slot worker walks to its building's station and then steps inside it. It
 * never takes a queue task: priorities stop applying to a colonist in a slot,
 * exactly as CONCEPT.md's labour section demands.
 */
function stepSlotWorker(sim: Sim, occ: Occupancy, c: Colonist): void {
  const b = findBuilding(sim, c.slot);
  if (!b) {
    // The building went away underneath them; they are standing on open
    // ground again, wherever the pin left them.
    c.slot = -1;
    c.inside = 0;
    return;
  }
  if (c.inside) return;
  if (c.path.length > c.step) {
    // A slot worker whose route is blocked and cannot be re-planned simply
    // loses its path; the goal is recomputed from the building below on the
    // next tick, so there is nothing to hand back.
    walk(sim, occ, c);
    return;
  }
  if (atStation(c, b)) {
    enterBuilding(c, b);
    return;
  }
  const [wx, wy] = workTile(b);
  const goals = passable(sim.world, sim.wallMap, occ, wx, wy)
    ? reachTile(sim, occ, wx, wy)
    : adjacentToBuilding(sim, occ, b);
  const path = findPath(sim, occ, Math.floor(c.x), Math.floor(c.y), goals);
  if (path) {
    c.path = path;
    c.step = 0;
  }
}

/**
 * A slot worker counts as arrived once it is standing beside its building.
 * The work tile is the tile it aims for, but a mill whose south side is water
 * or another building would otherwise strand its worker walking forever, so
 * "next to the footprint" is what decides they have got there.
 *
 * This only decides when to step *inside*; production gates on `inside`, so a
 * worker who can never reach the station never starts work — same outcome as
 * before, one field instead of a distance test.
 */
function atStation(c: Colonist, b: { x: number; y: number; w: number; h: number }): boolean {
  if (c.path.length > c.step) return false;
  const cx = Math.floor(c.x);
  const cy = Math.floor(c.y);
  const dx = Math.max(b.x - cx, 0, cx - (b.x + b.w - 1));
  const dy = Math.max(b.y - cy, 0, cy - (b.y + b.h - 1));
  return Math.max(dx, dy) === 1;
}

/**
 * Step inside: the colonist's position is pinned to the centre of the
 * footprint and the renderer stops drawing them. Pinning rather than leaving
 * the last outdoor position means nothing downstream has to remember where
 * they were standing — the panel's worker row and the labour meter's rust
 * segment are how the player knows someone is in there.
 */
function enterBuilding(c: Colonist, b: { x: number; y: number; w: number; h: number }): void {
  c.inside = 1;
  c.x = b.x + b.w / 2;
  c.y = b.y + b.h / 2;
  c.px = c.x;
  c.py = c.y;
  c.path = [];
  c.step = 0;
}

/**
 * Step back out to the work tile, or the nearest free tile around the
 * building if something has since blocked it. A worker leaving a slot must
 * always land somewhere walkable: they rejoin the pool on the same tick and
 * will be asked to path away from wherever this puts them.
 */
export function leaveBuilding(sim: Sim, c: Colonist, b: Building): void {
  c.inside = 0;
  c.path = [];
  c.step = 0;
  const occ = occupancy(sim);
  const [wx, wy] = workTile(b);
  const spot =
    passable(sim.world, sim.wallMap, occ, wx, wy) ? ([wx, wy] as [number, number])
    : dropTile(sim, occ, b.x, b.y);
  if (!spot) return;
  c.x = spot[0] + 0.5;
  c.y = spot[1] + 0.5;
  c.px = c.x;
  c.py = c.y;
}

function stepPoolWorker(sim: Sim, occ: Occupancy, c: Colonist): void {
  if (c.task < 0) {
    // Nothing claimed: either finish walking clear of something, or look for work.
    if (c.path.length > c.step) {
      walk(sim, occ, c);
      return;
    }
    if (!claim(sim, occ, c)) return;
  }
  const task = findTask(sim, c.task);
  if (!task) {
    c.task = -1;
    return;
  }
  if (c.path.length > c.step) {
    // Arrival is acted on next tick, so a colonist is never seen mid-tile
    // doing work. A route with no way round its blockage hands the errand
    // back, cargo and all, exactly as an eviction does.
    if (walk(sim, occ, c)) stepAside(sim, occ, c, Math.floor(c.x), Math.floor(c.y));
    return;
  }
  act(sim, occ, c, task);
}

/**
 * Advance along the route by one tick's worth of walking.
 *
 * A route is planned once and then followed, so ground can stop being walkable
 * underneath it — a palisade segment finishing across it is the common case now
 * that blueprints are walkable and every route is free to cross a drawn run.
 * Stepping onto the next tile is therefore gated on it still being passable,
 * and a stale route is re-planned to the same destination rather than
 * abandoned: the route went stale, the errand usually did not. This is the
 * "repath when a step is blocked" rule `docs/specs/2026-09-01-tick-and-labour.md`
 * asks for; without it a walker strolls straight through standing wall.
 *
 * Returns true only when there is genuinely no way round, which is the
 * caller's cue to hand the task back.
 */
function walk(sim: Sim, occ: Occupancy, c: Colonist): boolean {
  const size = sim.world.size;
  // Someone standing on ground that is *already* impassable is walking an
  // escape route, and those deliberately cut through blocked tiles (see
  // `escapePath`). Only a walker on legal ground is held to a legal route.
  const escaping = !passable(sim.world, sim.wallMap, occ, Math.floor(c.x), Math.floor(c.y));
  let budget = WALK_TILES_PER_TICK;
  while (budget > 0 && c.step < c.path.length) {
    const tile = c.path[c.step];
    const tx = tile % size;
    const ty = (tile - tx) / size;
    if (!escaping && !passable(sim.world, sim.wallMap, occ, tx, ty)) {
      const goal = c.path[c.path.length - 1];
      const around = findPath(sim, occ, Math.floor(c.x), Math.floor(c.y), new Set([goal]));
      c.path = around ?? [];
      c.step = 0;
      return around === null;
    }
    const dx = tx + 0.5 - c.x;
    const dy = ty + 0.5 - c.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 1e-9) c.heading = Math.atan2(dx, dy);
    if (dist <= budget) {
      c.x = tx + 0.5;
      c.y = ty + 0.5;
      c.step++;
      budget -= dist;
    } else {
      c.x += (dx / dist) * budget;
      c.y += (dy / dist) * budget;
      budget = 0;
    }
  }
  if (c.step >= c.path.length) {
    c.path = [];
    c.step = 0;
  }
  return false;
}

/**
 * Take the best available task: strict priority by kind, then nearest by
 * Manhattan distance, then lowest task id. No path-cost ranking — cheap,
 * deterministic, and good enough at colony distances.
 */
function claim(sim: Sim, occ: Occupancy, c: Colonist): boolean {
  const cx = Math.floor(c.x);
  const cy = Math.floor(c.y);
  for (const kind of TASK_PRIORITY) {
    let best: Task | null = null;
    let bestD = Infinity;
    for (const t of sim.tasks) {
      if (t.kind !== kind || t.claimedBy >= 0 || t.cooldown > 0) continue;
      const anchor = taskAnchor(sim, t);
      if (!anchor) continue;
      const d = Math.abs(anchor[0] - cx) + Math.abs(anchor[1] - cy);
      if (d < bestD || (d === bestD && best !== null && t.id < best.id)) {
        best = t;
        bestD = d;
      }
    }
    if (!best) continue;
    if (start(sim, occ, c, best)) return true;
    // Unreachable: the task sleeps, and this colonist waits for the next tick
    // rather than churning through every task in the queue in one go.
    releaseTask(sim, best);
    return false;
  }
  return false;
}

/** Where a task's work begins, for distance ranking. */
function taskAnchor(sim: Sim, t: Task): [number, number] | null {
  if (t.kind === TaskKind.Chop || t.kind === TaskKind.Raze) return [t.x, t.y];
  if (t.kind === TaskKind.Build) {
    const b = findBuilding(sim, t.building);
    return b ? [b.x, b.y] : null;
  }
  // Build-wall included: its first leg is the walk to its log, so the log is
  // what the distance ranking should measure.
  const item = findItem(sim, t.item);
  return item ? itemTile(sim, item) : null;
}

/** Claim a task and set the first leg of the route; false if it can't be reached. */
function start(sim: Sim, occ: Occupancy, c: Colonist, task: Task): boolean {
  const goals = firstGoal(sim, occ, task);
  if (!goals) return false;
  const path = findPath(sim, occ, Math.floor(c.x), Math.floor(c.y), goals);
  if (!path) return false;
  task.claimedBy = c.id;
  c.task = task.id;
  c.path = path;
  c.step = 0;
  c.work = 0;
  // Everything that starts by fetching something walks to the source first;
  // the rest walk straight at their target. Build-wall fetches a log, so it is
  // in the first group even though its target is a tile.
  c.phase = fetchesFirst(task.kind) ? Phase.ToSource : Phase.ToTarget;
  return true;
}

function fetchesFirst(kind: number): boolean {
  return kind === TaskKind.HaulToSite ||
    kind === TaskKind.HaulToInput ||
    kind === TaskKind.HaulToStore ||
    kind === TaskKind.BuildWall;
}

function firstGoal(sim: Sim, occ: Occupancy, task: Task): Set<number> | null {
  if (task.kind === TaskKind.Chop) return reachTile(sim, occ, task.x, task.y);
  if (task.kind === TaskKind.Raze) return adjacentToTile(sim, occ, task.x, task.y);
  if (task.kind === TaskKind.Build) {
    const b = findBuilding(sim, task.building);
    return b ? adjacentToBuilding(sim, occ, b) : null;
  }
  const item = findItem(sim, task.item);
  return item ? itemGoal(sim, occ, item) : null;
}

function itemGoal(sim: Sim, occ: Occupancy, item: Item): Set<number> | null {
  if (item.loc === Loc.Ground) return reachTile(sim, occ, item.x, item.y);
  if (item.loc === Loc.Stored) {
    const b = findBuilding(sim, item.holder);
    return b ? adjacentToBuilding(sim, occ, b) : null;
  }
  return null;
}

/** The colonist has arrived; do the thing this phase of the task is for. */
function act(sim: Sim, occ: Occupancy, c: Colonist, task: Task): void {
  switch (task.kind) {
    case TaskKind.Chop:
      return actChop(sim, occ, c, task);
    case TaskKind.Build:
      return actBuild(sim, occ, c, task);
    case TaskKind.BuildWall:
      return actBuildWall(sim, occ, c, task);
    case TaskKind.Raze:
      return actRaze(sim, occ, c, task);
    default:
      return actHaul(sim, occ, c, task);
  }
}

function actChop(sim: Sim, occ: Occupancy, c: Colonist, task: Task): void {
  const i = tileIndex(task.x, task.y, sim.world.size);
  if (!sim.world.treeMap[i]) {
    // Somebody else already felled it.
    abandonTask(sim, occ, task);
    return;
  }
  c.phase = Phase.Working;
  faceTile(c, task.x, task.y);
  if (++c.work < CHOP_TICKS) return;

  sim.world.treeMap[i] = 0;
  sim.chopMap[i] = 0;
  // The tile's geometry is baked into a chunk mesh, so the tree only vanishes
  // on screen because this bumps the version. First real customer of the
  // dirty seam (docs/changelog/2026-09-01-dirty-chunk-neighbours.md).
  markChunkDirty(sim.world, task.x, task.y);
  // The felled cell is passable now — `passable` reads treeMap live, and the
  // occupancy set only ever holds building footprints — so the log lands
  // exactly where the tree was.
  spawnItem(sim, ItemType.Log, task.x, task.y, occ);
  clearWorker(c);
  finishTask(sim, task);
}

function actBuild(sim: Sim, occ: Occupancy, c: Colonist, task: Task): void {
  const b = findBuilding(sim, task.building);
  if (!b || b.state !== BuildingState.Building) {
    abandonTask(sim, occ, task);
    return;
  }
  c.phase = Phase.Working;
  faceTile(c, b.x + (b.w - 1) / 2, b.y + (b.h - 1) / 2);
  b.progress++;
  if (b.progress < BUILD_TICKS) return;

  b.state = BuildingState.Active;
  // The delivered logs go into the structure.
  for (const item of [...sim.items]) {
    if (item.loc === Loc.Stored && item.holder === b.id) removeItem(sim, item.id);
  }
  for (const [x, y] of footprint(b)) markChunkDirty(sim.world, x, y);
  clearWorker(c);
  finishTask(sim, task);
}

/**
 * Raise one wall segment: fetch the log, carry it to a tile beside the
 * segment, work — **still carrying it** — and consume it at the completion
 * instant, not on arrival.
 *
 * Consuming last is the load-bearing decision. Every interruption path the
 * colony already has — `abandonTask`, the `staff` command taking the builder,
 * `evictFromFootprint` — drops a carried item where the colonist stands, so a
 * cancelled segment refunds its log for free and **no delivery ledger exists**.
 * Don't introduce one: it would have to be kept in step with all three.
 */
function actBuildWall(sim: Sim, occ: Occupancy, c: Colonist, task: Task): void {
  const i = tileIndex(task.x, task.y, sim.world.size);
  if (!isBlueprint(sim.wallMap[i])) {
    // Razed, or built by somebody else, while this one was walking.
    abandonTask(sim, occ, task);
    return;
  }

  if (c.phase === Phase.ToSource) {
    const item = findItem(sim, task.item);
    if (!item) {
      abandonTask(sim, occ, task);
      return;
    }
    const at = itemTile(sim, item);
    if (at) faceTile(c, at[0], at[1]);
    carryItem(item, c.id);
    c.carrying = item.id;
    const path = findPath(sim, occ, Math.floor(c.x), Math.floor(c.y), adjacentToTile(sim, occ, task.x, task.y));
    if (!path) {
      // Picked it up and now cannot get to the segment: put it down and let
      // the task sleep, exactly as a haul does.
      groundItem(sim, occ, item, Math.floor(c.x), Math.floor(c.y));
      c.carrying = -1;
      c.task = -1;
      releaseTask(sim, task);
      return;
    }
    c.phase = Phase.ToTarget;
    c.path = path;
    c.step = 0;
    return;
  }

  if (c.carrying < 0) {
    // The log left their hands some other way; the blueprint stands and task
    // generation will hire again once a log is free.
    abandonTask(sim, occ, task);
    return;
  }
  c.phase = Phase.Working;
  faceTile(c, task.x, task.y);
  const gate = sim.wallMap[i] === WallState.GateBp;
  if (++c.work < (gate ? GATE_BUILD_TICKS : WALL_BUILD_TICKS)) return;

  // The segment goes up *first*, so the sweep and the eviction below see the
  // tile as the obstacle it has just become.
  sim.wallMap[i] = builtForm(sim.wallMap[i]);
  removeItem(sim, c.carrying);
  c.carrying = -1;
  markChunkDirty(sim.world, task.x, task.y);
  markEnclosureStale(sim);
  // Anything standing or lying on a finished segment steps off it — the
  // building-placement rule, applied to a 1×1 of wall and to things as well
  // as people.
  for (const item of groundItemsAt(sim, task.x, task.y)) {
    groundItem(sim, occ, item, task.x, task.y);
  }
  // Only a segment that actually closed the ground evicts. A gate stays
  // walkable, and evicting off one costs whoever is in the gateway their task
  // and their cargo for nothing — `escapePath` would not even move them.
  if (!isWalkable(sim.wallMap[i])) evictFromTile(sim, occ, task.x, task.y);
  clearWorker(c);
  finishTask(sim, task);
}

/** Tear one built segment down: quick work, and the log comes back. */
function actRaze(sim: Sim, occ: Occupancy, c: Colonist, task: Task): void {
  const i = tileIndex(task.x, task.y, sim.world.size);
  if (!isBuilt(sim.wallMap[i])) {
    abandonTask(sim, occ, task);
    return;
  }
  c.phase = Phase.Working;
  faceTile(c, task.x, task.y);
  if (++c.work < RAZE_TICKS) return;

  sim.wallMap[i] = WallState.None;
  sim.razeMap[i] = 0;
  markChunkDirty(sim.world, task.x, task.y);
  markEnclosureStale(sim);
  // The tile has just become free, so the drop spiral starts on it — the chop
  // precedent, where the log lands where the tree stood.
  spawnItem(sim, ItemType.Log, task.x, task.y, occ);
  clearWorker(c);
  finishTask(sim, task);
}

function actHaul(sim: Sim, occ: Occupancy, c: Colonist, task: Task): void {
  const item = findItem(sim, task.item);
  const dest = findBuilding(sim, task.building);
  if (!item || !dest) {
    abandonTask(sim, occ, task);
    return;
  }

  if (c.phase === Phase.ToSource) {
    if (item.loc === Loc.Stored) {
      const from = findBuilding(sim, item.holder);
      if (from) faceTile(c, from.x + (from.w - 1) / 2, from.y + (from.h - 1) / 2);
    } else {
      faceTile(c, item.x, item.y);
    }
    carryItem(item, c.id);
    c.carrying = item.id;
    const path = findPath(sim, occ, Math.floor(c.x), Math.floor(c.y), adjacentToBuilding(sim, occ, dest));
    if (!path) {
      // Picked it up and now can't deliver: put it down and let the task sleep.
      groundItem(sim, occ, item, Math.floor(c.x), Math.floor(c.y));
      c.carrying = -1;
      c.task = -1;
      releaseTask(sim, task);
      return;
    }
    c.phase = Phase.ToTarget;
    c.path = path;
    c.step = 0;
    return;
  }

  // Arrived at the destination.
  faceTile(c, dest.x + (dest.w - 1) / 2, dest.y + (dest.h - 1) / 2);
  storeItem(item, dest.id);
  c.carrying = -1;
  if (dest.state === BuildingState.Blueprint) {
    const delivered = sim.items.filter(
      (it) => it.loc === Loc.Stored && it.holder === dest.id && it.type === ItemType.Log,
    ).length;
    if (delivered >= defOf(dest).cost) {
      dest.state = BuildingState.Building;
      for (const [x, y] of footprint(dest)) markChunkDirty(sim.world, x, y);
    }
  }
  clearWorker(c);
  finishTask(sim, task);
}

function clearWorker(c: Colonist): void {
  c.task = -1;
  c.phase = Phase.ToSource;
  c.work = 0;
  c.path = [];
  c.step = 0;
}

function faceTile(c: Colonist, x: number, y: number): void {
  const dx = x + 0.5 - c.x;
  const dy = y + 0.5 - c.y;
  if (Math.abs(dx) > 1e-6 || Math.abs(dy) > 1e-6) c.heading = Math.atan2(dx, dy);
}

/**
 * Get anyone standing inside a footprint out of it. Placement never fails
 * because a colonist is in the way — the ground turns impassable and whoever
 * is on it walks clear, dropping what they carry if they were mid-task.
 */
export function evictFromFootprint(sim: Sim, area: { x: number; y: number; w: number; h: number }): void {
  const occ = occupancy(sim);
  for (const c of sim.colonists) {
    // A colonist inside a workshop is pinned within its footprint, and
    // placement can't overlap an existing building — so they are never in a
    // new area. Skipped explicitly so the pin can't be walked out from under.
    if (c.inside) continue;
    const cx = Math.floor(c.x);
    const cy = Math.floor(c.y);
    if (cx < area.x || cx >= area.x + area.w || cy < area.y || cy >= area.y + area.h) continue;
    // A slot worker standing where a new footprint landed loses its post: its
    // building is not the one that just appeared under it.
    if (c.slot >= 0 && buildingAt(sim, cx, cy)?.id !== c.slot) {
      const old = findBuilding(sim, c.slot);
      if (old) old.worker = -1;
      c.slot = -1;
    }
    stepAside(sim, occ, c, cx, cy);
  }
}

/**
 * Get anyone standing on a single tile off it — a wall segment that has just
 * finished under their feet.
 *
 * Unlike a footprint this never unbinds a slot worker: no building appeared,
 * so their post is still theirs and `stepSlotWorker` simply walks the escape
 * route and then carries on to their workshop.
 */
export function evictFromTile(sim: Sim, occ: Occupancy, x: number, y: number): void {
  for (const c of sim.colonists) {
    if (c.inside) continue;
    if (Math.floor(c.x) !== x || Math.floor(c.y) !== y) continue;
    stepAside(sim, occ, c, x, y);
  }
}

/**
 * Hand back whatever this colonist was doing and route them off the tile they
 * are standing on, which has just stopped being ground they may stand on.
 */
function stepAside(sim: Sim, occ: Occupancy, c: Colonist, cx: number, cy: number): void {
  if (c.task >= 0) {
    const task = findTask(sim, c.task);
    if (task) {
      // Hand the work back rather than carrying it out of a wall.
      if (c.carrying >= 0) {
        const carried = findItem(sim, c.carrying);
        if (carried) groundItem(sim, occ, carried, cx, cy);
        c.carrying = -1;
      }
      task.claimedBy = -1;
      releaseTask(sim, task);
    }
  }
  clearWorker(c);
  const out = escapePath(sim, occ, cx, cy);
  if (out && out.length) {
    c.path = out;
    c.step = 0;
  }
}
