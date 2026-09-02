import { buildingAt } from "./buildings";
import { inBounds } from "./path";
import { Loc, type Sim } from "./store";
import { GROUND_MAX, GROUND_MIN } from "./tuning";
import { WallState } from "./walls";
import { Terrain, terrainFor, tileIndex, type World } from "./world/world";

/**
 * The ground as something labour can change: which tiles may be quarried,
 * which may be levelled, and what height the work leaves behind.
 *
 * Both jobs are paid for in people-hours alone — mining yields rock as a
 * *product*, terraforming yields nothing but flat ground (docs/CONCEPT.md:
 * "terraforming follows the same currency: it costs labour only"). The
 * predicates live here rather than in `labour/` because the tools ask them
 * before designating and the tasks re-ask them at every step; the acting is in
 * `labour/colonists.ts` with the rest of the work.
 */

const ORTHOGONAL: readonly (readonly [number, number])[] = [
  [0, -1],
  [-1, 0],
  [1, 0],
  [0, 1],
];

function heightAt(world: World, x: number, y: number): number {
  return world.hmap[tileIndex(x, y, world.size)];
}

/**
 * Can this outcrop be quarried?
 *
 * Rock, and with at least one orthogonal tile that is *land* — a sea stack has
 * nowhere to stand and nowhere for its own rubble to go, so it is refused at
 * designation rather than left as a task that retries forever. Whether the
 * stand tile is reachable *today* is not asked here: the pathfinder discovers
 * that at claim time, as everywhere, and an outcrop's ring becomes reachable
 * as its edge tiles come down.
 */
export function canMine(sim: Sim, x: number, y: number): boolean {
  const world = sim.world;
  if (!inBounds(world, x, y)) return false;
  if (world.tmap[tileIndex(x, y, world.size)] !== Terrain.Rock) return false;
  return landNeighbours(world, x, y).length > 0;
}

function landNeighbours(world: World, x: number, y: number): number[] {
  const out: number[] = [];
  for (const [dx, dy] of ORTHOGONAL) {
    const nx = x + dx;
    const ny = y + dy;
    if (!inBounds(world, nx, ny)) continue;
    if (world.tmap[tileIndex(nx, ny, world.size)] === Terrain.Water) continue;
    out.push(heightAt(world, nx, ny));
  }
  return out;
}

/**
 * What a quarried tile erodes to: its **lowest** orthogonal land neighbour's
 * height, clamped to the workable band. Null when there is no land neighbour
 * at all, which `canMine` already refuses.
 *
 * Lowest, not average: the result is then always step-reachable from that
 * neighbour, so mining can never leave a pit with somebody in it — which is
 * why mining needs none of terraforming's eviction. The upper clamp is what
 * guarantees worked ground never re-derives to rock, so an outcrop is a
 * one-time yield and the map's stone is finite.
 */
export function erodesTo(sim: Sim, x: number, y: number): number | null {
  const neighbours = landNeighbours(sim.world, x, y);
  if (!neighbours.length) return null;
  return clampHeight(Math.min(...neighbours));
}

export function clampHeight(h: number): number {
  return Math.max(GROUND_MIN, Math.min(GROUND_MAX, h));
}

export function isTargetHeight(h: number): boolean {
  return Number.isInteger(h) && h >= GROUND_MIN && h <= GROUND_MAX;
}

/**
 * Can this tile be **designated** for levelling?
 *
 * Grass or sand — **never rock**, because mining is the only way an outcrop
 * comes down and a careless marquee across an outcrop would otherwise
 * demolish the colony's finite stone for no yield at all. Never water either:
 * the island's shape is not for sale. Its own height has to be in the workable
 * band, and the tile has to be clear of trees, walls and buildings — plus, at
 * designation only, clear of ground items, so a drag does not pick tiles the
 * player can see are covered in logs.
 */
export function canTerraform(sim: Sim, x: number, y: number): boolean {
  if (!keepsTerraforming(sim, x, y)) return false;
  for (const it of sim.items) {
    if (it.loc === Loc.Ground && it.x === x && it.y === y) return false;
  }
  return true;
}

/**
 * The half of that which still has to hold **once the work has started** — and
 * deliberately *not* the ground-item check.
 *
 * Items on a tile being levelled simply ride the height change; they store
 * only x and y (docs/specs/2026-09-02-stone-and-terraform.md). Re-asking the
 * full designation test at every step made an arriving item cancel the rest of
 * the job, which the system did to itself: `stepOffTile` gets a carrying
 * bystander off the tile by handing their errand back, and that drops their
 * cargo through the spiral — which starts *on* the tile, because unlike a
 * finished wall segment the tile is perfectly droppable. A half-levelled shelf
 * and a silently cleared designation was the result.
 *
 * What does still cancel a job mid-flow is a wall, a building or a tree raised
 * across the area since, which is exactly what the spec asks for.
 */
export function keepsTerraforming(sim: Sim, x: number, y: number): boolean {
  const world = sim.world;
  if (!inBounds(world, x, y)) return false;
  const i = tileIndex(x, y, world.size);
  const t = world.tmap[i];
  if (t !== Terrain.Grass && t !== Terrain.Sand) return false;
  if (!isTargetHeight(world.hmap[i])) return false;
  if (world.treeMap[i]) return false;
  if (sim.wallMap[i] !== WallState.None) return false;
  if (buildingAt(sim, x, y)) return false;
  return true;
}

/**
 * Write a tile's new height and re-derive its terrain by generation's own
 * thresholds. The single place either job changes the ground, so the two can
 * never disagree about what a height means.
 *
 * The caller marks the chunk dirty and deals with whoever is standing there:
 * this is the store write, nothing else.
 */
export function setHeight(sim: Sim, x: number, y: number, h: number): void {
  const i = tileIndex(x, y, sim.world.size);
  sim.world.hmap[i] = h;
  sim.world.tmap[i] = terrainFor(h);
}
