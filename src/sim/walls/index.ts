import { buildingAt } from "../buildings";
import { Loc, type Sim } from "../store";
import { Terrain, tileIndex } from "../world/world";

/**
 * The wall layer: what a tile's wall byte means, and the predicates every
 * consumer is required to read it through.
 *
 * Walls are a **grid layer**, not entities (docs/specs/2026-09-02-palisade-walls.md):
 * a castle is hundreds of segments, and the flood-fill, the mesher and the
 * pathfinder all read grids. `sim.wallMap` holds one `WallState` per tile;
 * `sim.razeMap` is the player's dismantle intent beside it, exactly as
 * `chopMap` sits beside `treeMap`.
 *
 * **Nothing outside this folder may compare a wall byte to a state.** The stone
 * tier appends values (`StoneBp`, `Stone`, …) and every consumer has to keep
 * working without being edited, which only holds if they all ask
 * `isBlocking` / `isWalkable` instead of testing for equality.
 *
 * The two predicates are deliberately **not complements**, and a gate is why:
 * CONCEPT requires a gate to be passable to colonists and wall to the world,
 * so `isWalkable(Gate)` and `isBlocking(Gate)` are both true. Pathing asks the
 * first, the enclosure fill asks the second. A single "solid?" predicate would
 * make a walled colony with a gate never count as enclosed.
 */

export const WallState = {
  None: 0,
  /** Drawn, not yet raised: passable, so a long run cannot wall in its own builders. */
  PalisadeBp: 1,
  Palisade: 2,
  GateBp: 3,
  Gate: 4,
} as const;
export type WallStateValue = (typeof WallState)[keyof typeof WallState];

/** Does this state stop the enclosure flood-fill? Built wall, gates included. */
export function isBlocking(state: number): boolean {
  return state === WallState.Palisade || state === WallState.Gate;
}

/** Can a colonist stand here? Everything but a raised palisade — a gate is
 *  traffic, and a blueprint is still open ground. */
export function isWalkable(state: number): boolean {
  return state !== WallState.Palisade;
}

export function isBlueprint(state: number): boolean {
  return state === WallState.PalisadeBp || state === WallState.GateBp;
}

export function isBuilt(state: number): boolean {
  return state === WallState.Palisade || state === WallState.Gate;
}

/** What a blueprint becomes when its last work tick lands. */
export function builtForm(state: number): number {
  return state === WallState.GateBp ? WallState.Gate : WallState.Palisade;
}

export function wallAt(sim: Sim, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= sim.world.size || y >= sim.world.size) return WallState.None;
  return sim.wallMap[tileIndex(x, y, sim.world.size)];
}

export function razeMarked(sim: Sim, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= sim.world.size || y >= sim.world.size) return false;
  return sim.razeMap[tileIndex(x, y, sim.world.size)] === 1;
}

/**
 * Can a wall segment go on this tile?
 *
 * `canPlace`'s checks minus flatness, which is moot for a 1×1 footprint:
 * segments follow the terrain, and a height step between neighbouring segments
 * is a hillside palisade rather than a defect. Grass or sand, no tree, no
 * water, no rock, no building, no existing wall, no ground item.
 */
export function canPlaceWall(sim: Sim, x: number, y: number): boolean {
  const { size, tmap, treeMap } = sim.world;
  if (x < 0 || y < 0 || x >= size || y >= size) return false;
  const i = tileIndex(x, y, size);
  if (tmap[i] !== Terrain.Grass && tmap[i] !== Terrain.Sand) return false;
  if (treeMap[i]) return false;
  if (sim.wallMap[i] !== WallState.None) return false;
  if (buildingAt(sim, x, y)) return false;
  for (const it of sim.items) {
    if (it.loc === Loc.Ground && it.x === x && it.y === y) return false;
  }
  return true;
}
