import { BUILDING_DEFS, canPlace, defOf, footprint } from "./buildings";
import { clampLimit, limitOf, stepLimit } from "./economy/limits";
import { goodOf } from "./goods";
import { canMine, canTerraform, isTargetHeight } from "./ground";
import { countItems, groundItem } from "./items";
import { evictFromFootprint, leaveBuilding } from "./labour/colonists";
import { abandonTask, releaseTask } from "./labour/tasks";
import { occupancy } from "./path";
import { clearGrave } from "./threats/graves";
import {
  BuildingKind,
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
import { WallState, blueprintFor, canPlaceWall, type WallMaterial } from "./walls";
import { markEnclosureStale } from "./walls/enclosure";
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
  | { kind: "unstaff"; building: number }
  /** Mark rock outcrops for quarrying. Additive, exactly as `designateChop`. */
  | { kind: "designateMine"; tiles: number[] }
  | { kind: "cancelMine"; x: number; y: number }
  /**
   * Level an area to one height. Unlike the other designations this one is
   * **not** additive: a tile already marked has its stored target *overwritten*,
   * because the target came off the tile the player pressed on and fixing a
   * mis-pressed area has to be one more drag rather than a tile-by-tile
   * clean-up. `cancelTerraform` is still how a single tile is taken back.
   */
  | { kind: "designateTerraform"; tiles: number[]; target: number }
  | { kind: "cancelTerraform"; x: number; y: number }
  /**
   * A drawn wall run, as one command — the same "one gesture, one entry in the
   * log" rule `designateChop` follows. The tool sends only the tiles it judged
   * valid, so one bad tile in the middle of a drag costs that segment and not
   * the run; the sim re-checks each of them anyway, because a command may be
   * replayed against a world a tick older than the preview.
   *
   * `material` is carried by the command rather than held as a mode, so there
   * is no toggle whose forgotten setting raises the wrong wall: the rail has a
   * button per material and each one says what it costs.
   */
  | { kind: "placeWall"; tiles: number[]; material: WallMaterial }
  | { kind: "placeGate"; tiles: number[]; material: WallMaterial }
  /** Mark wall segments for dismantling. Additive, like `designateChop`, and
   *  material-blind — a segment refunds whatever it was made of. */
  | { kind: "designateRaze"; tiles: number[] }
  | { kind: "cancelRaze"; x: number; y: number }
  /**
   * Set a good's production ceiling — "make this until `value` exist", or
   * `-1` for unlimited. **Global per good, not per workshop**: two sawmills
   * share one plank ceiling because the player's question is how many planks
   * exist, not which mill made them. Clamped on arrival (`clampLimit`), so a
   * replayed command lands on the same number whatever the range was tuned to
   * when it was recorded (docs/specs/2026-09-07-production-control.md).
   */
  | { kind: "setLimit"; type: number; value: number }
  /**
   * Move a good's ceiling by one press — `dir` -1 lowers, +1 raises — with the
   * landings `stepLimit` defines (economy/limits.ts), **resolved against the
   * live ceiling and count when the tick applies it**, not against whatever
   * the panel showed when the button was pressed. This is what the `−`/`+`
   * steppers send. A press that carried an absolute target would replay a
   * stale snapshot: commands land a tick later at the earliest and queue for
   * as long as the game is paused, so two quick presses would both send the
   * same number and three presses while paused would move the ceiling once.
   * `setLimit` stays for an absolute write — scripts, replays, tests.
   */
  | { kind: "stepLimit"; type: number; dir: -1 | 1 }
  /**
   * Flip one of a stockpile's accept filters. A filter is **routing, not a
   * brake** — it gates what the pile takes in and never what leaves it, and
   * what it already holds stays put. A workshop or a House has no filters to
   * flip, so the command is refused for anything but a stockpile.
   */
  | { kind: "toggleFilter"; building: number; type: number };

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
    case "designateMine":
      return designateMineTiles(sim, command.tiles);
    case "cancelMine":
      return designateMine(sim, command.x, command.y, 0);
    case "designateTerraform":
      return designateTerraformTiles(sim, command.tiles, command.target);
    case "cancelTerraform":
      return clearTerraform(sim, command.x, command.y);
    case "placeWall":
      return placeWalls(sim, command.tiles, blueprintFor(command.material, false));
    case "placeGate":
      return placeWalls(sim, command.tiles, blueprintFor(command.material, true));
    case "designateRaze":
      return designateRazeTiles(sim, command.tiles);
    case "cancelRaze":
      return designateRaze(sim, command.x, command.y, 0);
    case "setLimit":
      return setLimit(sim, command.type, command.value);
    case "stepLimit":
      return nudgeLimit(sim, command.type, command.dir);
    case "toggleFilter":
      return toggleFilter(sim, command.building, command.type);
  }
}

/**
 * Write a ceiling. Only a good the store has a slot for takes it — the slot
 * exists exactly when the good does, since both are appended in step — and the
 * value is clamped rather than trusted, so nothing outside `-1` or
 * `0 .. LIMIT_MAX` ever reaches a save.
 */
function setLimit(sim: Sim, type: number, value: number): void {
  if (!Number.isInteger(type) || type < 0 || type >= sim.limits.length) return;
  const clamped = clampLimit(value);
  if (clamped === null) return;
  sim.limits[type] = clamped;
}

/**
 * One press of the panel's stepper, landing where `stepLimit` says from the
 * ceiling and count **as they are now** — so a burst of presses, or a queue of
 * them released by unpausing, applies press by press and arrives where the
 * same presses would have taken a live panel.
 */
function nudgeLimit(sim: Sim, type: number, dir: number): void {
  if (!Number.isInteger(type) || type < 0 || type >= sim.limits.length) return;
  if (dir !== -1 && dir !== 1) return;
  sim.limits[type] = stepLimit(limitOf(sim, type), countItems(sim, type), dir);
}

/**
 * Flip a stockpile's filter for one good. Nothing else moves: items already
 * in the pile stay (stored items are not loose, so nothing re-homes them; sites
 * and workshops drain them as they always did), and a haul already on its way
 * delivers — `freeCapacity` is asked at generation, not at arrival, and a
 * cancelled haul would drop the good on the ground for the sake of a rule the
 * player just changed.
 */
function toggleFilter(sim: Sim, id: number, type: number): void {
  const b = findBuilding(sim, id);
  if (!b || b.kind !== BuildingKind.Stockpile) return;
  const good = goodOf(type);
  if (!good) return;
  b[good.accept] = b[good.accept] === 1 ? 0 : 1;
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

/** Mark a whole selection of outcrops. Only tiles that can actually be
 *  quarried take — a sea stack with nowhere to stand is refused here rather
 *  than becoming a task that retries forever (`canMine`). */
function designateMineTiles(sim: Sim, tiles: readonly number[]): void {
  const size = sim.world.size;
  for (const i of tiles) {
    if (!Number.isInteger(i) || i < 0 || i >= sim.mineMap.length) continue;
    designateMine(sim, i % size, Math.floor(i / size), 1);
  }
}

function designateMine(sim: Sim, x: number, y: number, on: number): void {
  if (!inBounds(sim.world, x, y)) return;
  const i = tileIndex(x, y, sim.world.size);
  if (on && !canMine(sim, x, y)) return;
  if (sim.mineMap[i] === on) return;
  sim.mineMap[i] = on;
  // Half of this mark is baked — a doomed outcrop's top face bakes
  // gold-shifted, the styleguide's two-marks rule — so marking one is a
  // geometry change, exactly as marking a tree is.
  markChunkDirty(sim.world, x, y);
  if (!on) {
    const occ = occupancy(sim);
    for (const task of [...sim.tasks]) {
      if (task.kind === TaskKind.Mine && task.x === x && task.y === y) abandonTask(sim, occ, task);
    }
  }
}

/**
 * Designate an area for levelling to one height.
 *
 * The target came off the tile the player pressed on, so it is the same for
 * every tile of the drag; tiles already at it, and tiles that cannot be
 * levelled at all, are simply skipped (the marquee's rust-skip rule). A tile
 * that already carries a *different* target is **overwritten** rather than
 * left alone, which is what makes re-dragging the fix for a mis-pressed area.
 */
function designateTerraformTiles(sim: Sim, tiles: readonly number[], target: number): void {
  if (!isTargetHeight(target)) return;
  const size = sim.world.size;
  for (const i of tiles) {
    if (!Number.isInteger(i) || i < 0 || i >= sim.terraformMap.length) continue;
    const x = i % size;
    const y = (i - x) / size;
    if (!canTerraform(sim, x, y)) continue;
    if (sim.world.hmap[i] === target) continue;
    if (sim.terraformMap[i] === target + 1) continue;
    sim.terraformMap[i] = target + 1;
    // Any task on the old target is stale: the tile it was walking toward is
    // going somewhere else now, and its stint restarts against the new figure.
    cancelTerraformTasks(sim, x, y);
  }
}

function clearTerraform(sim: Sim, x: number, y: number): void {
  if (!inBounds(sim.world, x, y)) return;
  const i = tileIndex(x, y, sim.world.size);
  if (!sim.terraformMap[i]) return;
  sim.terraformMap[i] = 0;
  cancelTerraformTasks(sim, x, y);
}

/** No chunk to dirty: a levelling mark is drawn as an overlay and nothing
 *  about it is baked, so unlike chop, mine and raze it changes no geometry. */
function cancelTerraformTasks(sim: Sim, x: number, y: number): void {
  const occ = occupancy(sim);
  for (const task of [...sim.tasks]) {
    if (task.kind === TaskKind.Terraform && task.x === x && task.y === y) abandonTask(sim, occ, task);
  }
}

/**
 * Write wall blueprints into `wallMap`. Only tiles that still pass
 * `canPlaceWall` take, so an invalid tile in a run is skipped rather than
 * killing it.
 *
 * Nothing is evicted here: a blueprint is walkable, and stays walkable until
 * the segment is actually raised. Placing one does move the enclosure, though
 * — a wall tile is not enclosed ground even before it stands — so the
 * recompute is flagged.
 */
function placeWalls(sim: Sim, tiles: readonly number[], state: number): void {
  const size = sim.world.size;
  for (const i of tiles) {
    if (!Number.isInteger(i) || i < 0 || i >= sim.wallMap.length) continue;
    const x = i % size;
    const y = (i - x) / size;
    if (!canPlaceWall(sim, x, y)) continue;
    sim.wallMap[i] = state;
    // A wall drawn over a grave takes the marker with it, silently.
    clearGrave(sim, x, y);
    markChunkDirty(sim.world, x, y);
    markEnclosureStale(sim);
  }
}

/** Mark a whole selection for dismantling. Only tiles holding a wall take. */
function designateRazeTiles(sim: Sim, tiles: readonly number[]): void {
  const size = sim.world.size;
  for (const i of tiles) {
    if (!Number.isInteger(i) || i < 0 || i >= sim.razeMap.length) continue;
    designateRaze(sim, i % size, Math.floor(i / size), 1);
  }
}

function designateRaze(sim: Sim, x: number, y: number, on: number): void {
  if (!inBounds(sim.world, x, y)) return;
  const i = tileIndex(x, y, sim.world.size);
  if (on && sim.wallMap[i] === WallState.None) return;
  if (sim.razeMap[i] === on) return;
  sim.razeMap[i] = on;
  // Like a chop mark, half of this is baked — a doomed segment's timber bakes
  // gold-shifted — so marking one is a geometry change.
  markChunkDirty(sim.world, x, y);
  if (!on) {
    const occ = occupancy(sim);
    for (const task of [...sim.tasks]) {
      if (task.kind === TaskKind.Raze && task.x === x && task.y === y) abandonTask(sim, occ, task);
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
    acceptRock: 1,
    acceptBlock: 1,
    acceptGrain: 1,
    acceptFlour: 1,
    acceptBread: 1,
    acceptWool: 1,
    acceptCloth: 1,
    acceptClothes: 1,
    acceptCheese: 1,
    worker: -1,
    millProgress: -1,
  };
  sim.buildings.push(b);
  for (const [tx, ty] of footprint(b)) {
    clearGrave(sim, tx, ty);
    markChunkDirty(sim.world, tx, ty);
  }
  // The ground is impassable from this moment; anyone standing on it walks off.
  evictFromFootprint(sim, b);
}

/**
 * Cancel a blueprint. Whatever was delivered goes back on the ground —
 * planks from a House exactly as logs from a mill — rather than being refunded
 * as a number: items are entities everywhere, so a cancelled site leaves a
 * pile someone has to fetch.
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
    // A wanderer still walking in from the coast is not a pair of hands yet
    // (sim/settlers.ts). Bound to a slot they would keep walking anyway —
    // `stepColonists` checks `dest` first — leaving the workshop marked
    // staffed by somebody who never arrives.
    if (c.dest >= 0) continue;
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
