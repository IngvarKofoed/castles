import { groundItem } from "../items";
import { abandonTask } from "../labour/tasks";
import { canStepTo, nearestPath, type Occupancy } from "../path";
import {
  MonsterPhase,
  findBuilding,
  findItem,
  findTask,
  type Colonist,
  type Monster,
  type Sim,
} from "../store";
import { FLEE_DEPTH, FLEE_RANGE } from "../tuning";
import { tileIndex } from "../world/world";
import { reach } from "./index";
import { bury } from "./graves";

/**
 * The safety boundary, from the colonist's side: who runs, where to, and what
 * happens when running was not enough.
 *
 * **`insideMap` is the whole of it.** A colonist standing on enclosed ground
 * ignores monsters entirely; one on open ground with a prowler near drops
 * everything and runs. That single test is what makes pillar one structural
 * rather than promised — and it is also the whole of the breach model, because
 * when a segment falls the enclosure recompute flips the exposed tiles to
 * outside and the calm zone shrinks by itself. There is no special breach code
 * anywhere, and there must not be: danger pours in because "inside" honestly
 * stopped being inside.
 *
 * What enclosure is *not* is line of sight. Two colonists on outside ground flee
 * even with a palisade line between them and the prowler, because the line
 * encloses nothing. Stated aloud rather than left as a surprise: it is the price
 * of the boundary being one flood-fill instead of a visibility model, and it is
 * cheap — outside ground is meant to feel exposed.
 */

/**
 * The prowling monster within `FLEE_RANGE` of a **point**, or null — the
 * boundary asked about a place rather than about a person.
 *
 * Resting and homeward monsters are ignored, which is what makes CONCEPT's
 * "hold until it leaves" trustworthy: a leaving monster is already harmless and
 * the colony can see it walking away. So is a point on inside ground.
 *
 * **Coordinates are tile-centre floats**, the same `x + 0.5` every other caller
 * of `reach` passes (`threatNear` from `c.x, c.y`, `watched` for its beach).
 * Integers would shift the range boundary by half a tile and leave two callers
 * disagreeing about the same tile.
 */
export function prowlerNear(sim: Sim, x: number, y: number): Monster | null {
  const size = sim.world.size;
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  if (cx < 0 || cy < 0 || cx >= size || cy >= size) return null;
  if (sim.insideMap[tileIndex(cx, cy, size)]) return null;

  let best: Monster | null = null;
  let bestD = Infinity;
  for (const m of sim.monsters) {
    if (m.phase !== MonsterPhase.Prowl) continue;
    const d = reach(m, x, y);
    if (d > FLEE_RANGE) continue;
    // Ties break by id, so two monsters equidistant never make the choice
    // depend on array order.
    if (d < bestD || (d === bestD && best !== null && m.id < best.id)) {
      best = m;
      bestD = d;
    }
  }
  return best;
}

/**
 * The prowling monster this colonist should be running from, or null.
 *
 * Anyone *inside a building* is exempt: they are physically indoors and cannot
 * be noticed or caught wherever the building happens to stand. That makes an
 * outside-the-walls workshop a bunker for its slot worker — and the bunker is
 * now sound at its one former hole, the self-errands, which ask `prowlerNear`
 * about the doorstep before stepping out
 * (docs/specs/2026-09-14-hives-and-mead.md). The haulers feeding such a
 * building still enjoy no shelter at all.
 */
export function threatNear(sim: Sim, c: Colonist): Monster | null {
  if (c.inside) return null;
  return prowlerNear(sim, c.x, c.y);
}

/**
 * Where a fleeing colonist heads: the nearest inside tile, by a **bounded BFS**
 * rather than the A\* goal-list search — which is O(goals) per node and would
 * crawl over every one of thousands of enclosed tiles.
 *
 * When nothing enclosed is within reach, they run *away* instead, one tile at a
 * time. That covers the whole early game: before the first ring closes there is
 * nowhere safe to run to, and running away is the era's intended texture rather
 * than a missing case.
 */
export function fleeRoute(sim: Sim, occ: Occupancy, c: Colonist, from: Monster): number[] | null {
  const cx = Math.floor(c.x);
  const cy = Math.floor(c.y);
  const inside = sim.insideMap;
  const home = anyInsideNear(sim, cx, cy) ? nearestPath(sim, occ, cx, cy, (i) => inside[i] === 1, FLEE_DEPTH) : null;
  if (home && home.length) return home;
  return awayStep(sim, occ, cx, cy, from);
}

/**
 * Is there an enclosed tile the bounded search could even *reach*?
 *
 * A miss is the expensive case, not the hit: `nearestPath` finding nothing
 * expands its whole frontier before returning null — thousands of nodes with a
 * `Set` and a `Map` behind them — and the away-step it falls back to is a
 * one-tile route that ends on outside ground, so `fleeing` is false and the
 * next tick pays for it all over again. That is the *whole* pre-wall game and
 * every push beyond the wall, which is precisely when the most else is
 * happening.
 *
 * The guard is exact rather than a heuristic: a `FLEE_DEPTH`-step 4-neighbour
 * BFS can never leave the Chebyshev box of that radius, so a box with no
 * enclosed tile in it makes the search a guaranteed miss and skipping it cannot
 * change a route. Flat typed-array reads with an early exit, an order of
 * magnitude under the search it replaces.
 */
function anyInsideNear(sim: Sim, cx: number, cy: number): boolean {
  const size = sim.world.size;
  const inside = sim.insideMap;
  const x0 = Math.max(0, cx - FLEE_DEPTH);
  const x1 = Math.min(size - 1, cx + FLEE_DEPTH);
  const y0 = Math.max(0, cy - FLEE_DEPTH);
  const y1 = Math.min(size - 1, cy + FLEE_DEPTH);
  for (let y = y0; y <= y1; y++) {
    const row = y * size;
    for (let x = x0; x <= x1; x++) if (inside[row + x]) return true;
  }
  return false;
}

/** One step directly away from a monster: the walkable neighbour that puts the
 *  most ground between them, ties broken by a fixed neighbour order. */
function awayStep(sim: Sim, occ: Occupancy, cx: number, cy: number, from: Monster): number[] | null {
  const world = sim.world;
  const size = world.size;
  const h = world.hmap[tileIndex(cx, cy, size)];
  let best = -1;
  let bestD = reach(from, cx + 0.5, cy + 0.5);
  for (const [dx, dy] of [
    [0, -1],
    [-1, 0],
    [1, 0],
    [0, 1],
  ] as const) {
    const nx = cx + dx;
    const ny = cy + dy;
    // The colonist's own step rule, height included: fleeing is not a licence
    // to climb a cliff, and a gate is still a way through.
    if (!canStepTo(world, sim.wallMap, occ, nx, ny, h)) continue;
    const d = reach(from, nx + 0.5, ny + 0.5);
    if (d > bestD) {
      best = tileIndex(nx, ny, size);
      bestD = d;
    }
  }
  return best < 0 ? null : [best];
}

/**
 * Hand back whatever this colonist was carrying or doing, so they can run
 * unencumbered. The standard release-and-drop, so every downstream invariant —
 * item reservations, incoming capacity, the task queue's top-up — settles
 * itself exactly as it does for an eviction.
 */
export function abandonForFlight(sim: Sim, occ: Occupancy, c: Colonist): void {
  if (c.task < 0) return;
  const task = findTask(sim, c.task);
  if (task) abandonTask(sim, occ, task);
  c.task = -1;
  c.work = 0;
  c.path = [];
  c.step = 0;
}

/**
 * Is the route this colonist is already walking one that gets them *out*?
 *
 * Asked because dropping the task is not enough on its own: a slot worker on
 * its way to a workshop, or anyone mid step-aside, carries a live route with no
 * task behind it — and a fleeing colonist who keeps walking that route walks it
 * straight past the monster. Judged by where the route *ends* rather than by
 * remembering who is fleeing: a route onto enclosed ground is an escape by
 * definition, whoever planned it and whatever they thought they were doing, and
 * anything else has to be re-planned. That keeps the "re-evaluated per repath"
 * rule — a route that is already good is walked to its end, not thrown away
 * every tick — with no extra field in the store.
 */
export function fleeing(sim: Sim, c: Colonist): boolean {
  if (c.path.length <= c.step) return false;
  return sim.insideMap[c.path[c.path.length - 1]] === 1;
}

/**
 * A colonist was caught. They are gone: the slot they held is vacated, the task
 * they were on is released, what they were carrying is on the ground, and a
 * grave marks the tile.
 *
 * No mourning mechanics and no announcement — the folk readout shrinking and a
 * grave in the grass are the game's whole obituary (docs/CONCEPT.md). Deaths are
 * permanent, and the labour model is what prices the absence.
 */
export function killColonist(sim: Sim, occ: Occupancy, c: Colonist): void {
  if (c.task >= 0) {
    const task = findTask(sim, c.task);
    if (task) abandonTask(sim, occ, task);
  }
  if (c.carrying >= 0) {
    const carried = findItem(sim, c.carrying);
    if (carried) groundItem(sim, occ, carried, Math.floor(c.x), Math.floor(c.y));
    c.carrying = -1;
  }
  if (c.slot >= 0) {
    const b = findBuilding(sim, c.slot);
    if (b && b.worker === c.id) b.worker = -1;
    c.slot = -1;
  }
  bury(sim, Math.floor(c.x), Math.floor(c.y));
  const i = sim.colonists.indexOf(c);
  if (i >= 0) sim.colonists.splice(i, 1);
  // Nobody is chasing a colonist who no longer exists.
  for (const m of sim.monsters) if (m.target === c.id) m.target = -1;
}
