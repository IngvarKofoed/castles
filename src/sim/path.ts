import type { Sim } from "./store";
import { isWalkable } from "./walls";
import { Terrain, tileIndex, type World } from "./world/world";

/**
 * A* on the tile grid, 4-neighbour. Water, trees, raised palisade and building
 * footprints are impassable; a height step of one block is a stair, two or
 * more is a cliff. No hierarchy until a profiler asks for one (spec
 * 2026-09-01-tick-and-labour).
 *
 * Occupancy is rebuilt per call from the buildings array rather than cached in
 * the store: a derived index in the store is a second source of truth waiting
 * to desync, and total footprint area stays tiny. Walls deliberately do **not**
 * join it — they are a grid layer and there are hundreds of them, which is
 * exactly what would blow that "footprint area stays tiny" rationale up.
 */

/** Height difference a colonist can step up or down between adjacent tiles. */
const MAX_STEP = 1;

/** Search ceiling. A colony path is tens of tiles; this only stops a doomed
 *  search from sweeping a 65k-tile map before it gives up. */
const MAX_VISITED = 6000;

export type Occupancy = Set<number>;

/** Tile indices covered by any building. */
export function occupancy(sim: Sim): Occupancy {
  const occ: Occupancy = new Set();
  for (const b of sim.buildings) {
    for (let y = b.y; y < b.y + b.h; y++) {
      for (let x = b.x; x < b.x + b.w; x++) occ.add(tileIndex(x, y, sim.world.size));
    }
  }
  return occ;
}

export function inBounds(world: World, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < world.size && y < world.size;
}

/**
 * Ground a colonist can stand on, ignoring who else is standing there.
 *
 * The wall table, stated once and read nowhere else: `None`, `PalisadeBp`,
 * `GateBp` and `Gate` are walkable, `Palisade` is not — via `isWalkable`, so
 * the stone tier appends states without this line changing. Blueprints being
 * walkable is load-bearing: a long run must not wall its own builders off
 * halfway through construction.
 *
 * `wallMap` is a required argument rather than an optional one on purpose — an
 * omitted layer would read as "no walls anywhere" and let colonists ghost
 * straight through a finished segment with nothing failing.
 */
export function passable(world: World, wallMap: Uint8Array, occ: Occupancy, x: number, y: number): boolean {
  if (!inBounds(world, x, y)) return false;
  const i = tileIndex(x, y, world.size);
  if (world.tmap[i] === Terrain.Water) return false;
  if (world.treeMap[i]) return false;
  if (!isWalkable(wallMap[i])) return false;
  return !occ.has(i);
}

/**
 * Passable, and reachable in one step from a tile at height `fromH`.
 *
 * Exported because the *walker* has to ask it too, not only the planner: a
 * route is planned once, and ground-changing labour (a terraform step, an
 * outcrop quarried away) can raise a cliff across a route somebody is already
 * walking. One rule, one place — a second copy of the height test in
 * `colonists.ts` would be free to drift from this one.
 */
export function canStepTo(
  world: World,
  wallMap: Uint8Array,
  occ: Occupancy,
  x: number,
  y: number,
  fromH: number,
): boolean {
  if (!passable(world, wallMap, occ, x, y)) return false;
  return Math.abs(world.hmap[tileIndex(x, y, world.size)] - fromH) <= MAX_STEP;
}

const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [0, -1],
  [-1, 0],
  [1, 0],
  [0, 1],
];

/**
 * Shortest route from (sx, sy) to any tile in `goals`, as tile indices
 * excluding the start. Returns null when nothing is reachable, and an empty
 * array when the start already satisfies the goal.
 */
export function findPath(sim: Sim, occ: Occupancy, sx: number, sy: number, goals: Set<number>): number[] | null {
  const world = sim.world;
  const size = world.size;
  const start = tileIndex(sx, sy, size);
  if (goals.has(start)) return [];
  if (goals.size === 0) return null;

  // Heuristic anchor: Manhattan to the nearest goal stays admissible on a
  // 4-neighbour grid with unit costs.
  const goalList = [...goals];
  const h = (i: number): number => {
    const x = i % size;
    const y = (i - x) / size;
    let best = Infinity;
    for (const g of goalList) {
      const gx = g % size;
      const gy = (g - gx) / size;
      const d = Math.abs(gx - x) + Math.abs(gy - y);
      if (d < best) best = d;
    }
    return best;
  };

  const gScore = new Map<number, number>([[start, 0]]);
  const cameFrom = new Map<number, number>();
  const open = new Heap();
  open.push(start, h(start));
  let visited = 0;

  while (open.size > 0) {
    const current = open.pop();
    if (goals.has(current)) return rebuild(cameFrom, current);
    if (++visited > MAX_VISITED) return null;

    const cx = current % size;
    const cy = (current - cx) / size;
    const ch = world.hmap[current];
    const cg = gScore.get(current) ?? 0;

    for (const [dx, dy] of NEIGHBOURS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!canStepTo(world, sim.wallMap, occ, nx, ny, ch)) continue;
      const n = tileIndex(nx, ny, size);
      const tentative = cg + 1;
      const known = gScore.get(n);
      if (known !== undefined && known <= tentative) continue;
      gScore.set(n, tentative);
      cameFrom.set(n, current);
      open.push(n, tentative + h(n));
    }
  }
  return null;
}

function rebuild(cameFrom: Map<number, number>, end: number): number[] {
  const out = [end];
  let cur = end;
  for (;;) {
    const prev = cameFrom.get(cur);
    if (prev === undefined) break;
    out.push(prev);
    cur = prev;
  }
  out.reverse();
  out.shift(); // drop the start tile — the colonist is already on it
  return out;
}

/**
 * Route out of a tile that has just become impassable — a footprint dropped
 * on top of someone. Ordinary A* can't help: the start itself is blocked.
 * Breadth-first so the destination is the nearest free tile by step count,
 * with neighbours visited in a fixed order so the choice is deterministic.
 */
export function escapePath(sim: Sim, occ: Occupancy, sx: number, sy: number): number[] | null {
  const world = sim.world;
  const size = world.size;
  const start = tileIndex(sx, sy, size);
  if (passable(world, sim.wallMap, occ, sx, sy)) return [];

  const seen = new Set<number>([start]);
  const cameFrom = new Map<number, number>();
  let frontier = [start];
  for (let depth = 0; depth < 32 && frontier.length; depth++) {
    const next: number[] = [];
    for (const cur of frontier) {
      const cx = cur % size;
      const cy = (cur - cx) / size;
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!inBounds(world, nx, ny)) continue;
        const n = tileIndex(nx, ny, size);
        if (seen.has(n)) continue;
        seen.add(n);
        cameFrom.set(n, cur);
        // Walking out ignores the height rule: standing inside a footprint is
        // not a position the pathfinder ever chose, so it may not be
        // step-reachable from anywhere. Getting clear beats getting clear
        // gracefully.
        if (passable(world, sim.wallMap, occ, nx, ny)) return rebuild(cameFrom, n);
        next.push(n);
      }
    }
    frontier = next;
  }
  return null;
}

/** Goal set: the tile itself if it can be stood on, else its free neighbours. */
export function reachTile(sim: Sim, occ: Occupancy, x: number, y: number): Set<number> {
  const world = sim.world;
  if (passable(world, sim.wallMap, occ, x, y)) return new Set([tileIndex(x, y, world.size)]);
  return neighbourGoals(sim, occ, [[x, y]]);
}

/**
 * Goal set: beside a wall tile, never on it. Wall work is done from an
 * adjacent tile even though a blueprint and a gate can both be stood on — a
 * builder standing on the segment they are finishing would have to evict
 * itself at the completion instant.
 */
export function adjacentToTile(sim: Sim, occ: Occupancy, x: number, y: number): Set<number> {
  return neighbourGoals(sim, occ, [[x, y]]);
}

/** Goal set: every free tile orthogonally adjacent to any of `tiles`. */
export function neighbourGoals(sim: Sim, occ: Occupancy, tiles: readonly (readonly [number, number])[]): Set<number> {
  const world = sim.world;
  const goals = new Set<number>();
  const inside = new Set(tiles.map(([tx, ty]) => tileIndex(tx, ty, world.size)));
  for (const [x, y] of tiles) {
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!passable(world, sim.wallMap, occ, nx, ny)) continue;
      const n = tileIndex(nx, ny, world.size);
      if (inside.has(n)) continue;
      goals.add(n);
    }
  }
  return goals;
}

/** Goal set: adjacent to a building's whole footprint. */
export function adjacentToBuilding(
  sim: Sim,
  occ: Occupancy,
  b: { x: number; y: number; w: number; h: number },
): Set<number> {
  const tiles: [number, number][] = [];
  for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) tiles.push([x, y]);
  return neighbourGoals(sim, occ, tiles);
}

/** Min-heap keyed by f-score. Ties break by insertion order, so equal-cost
 *  routes resolve the same way on every run. */
class Heap {
  private readonly items: number[] = [];
  private readonly keys: number[] = [];
  private readonly seq: number[] = [];
  private counter = 0;

  get size(): number {
    return this.items.length;
  }

  push(item: number, key: number): void {
    this.items.push(item);
    this.keys.push(key);
    this.seq.push(this.counter++);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(i, parent)) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): number {
    const top = this.items[0];
    const last = this.items.length - 1;
    this.swap(0, last);
    this.items.pop();
    this.keys.pop();
    this.seq.pop();
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let best = i;
      if (l < this.items.length && this.less(l, best)) best = l;
      if (r < this.items.length && this.less(r, best)) best = r;
      if (best === i) break;
      this.swap(i, best);
      i = best;
    }
    return top;
  }

  private less(a: number, b: number): boolean {
    return this.keys[a] < this.keys[b] || (this.keys[a] === this.keys[b] && this.seq[a] < this.seq[b]);
  }

  private swap(a: number, b: number): void {
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
    [this.seq[a], this.seq[b]] = [this.seq[b], this.seq[a]];
  }
}
