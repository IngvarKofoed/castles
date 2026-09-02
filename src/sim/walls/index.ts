import { buildingAt } from "../buildings";
import { ItemType, Loc, type ItemTypeValue, type Sim } from "../store";
import {
  GATE_BUILD_TICKS,
  STONE_BUILD_TICKS,
  STONE_GATE_BUILD_TICKS,
  WALL_BUILD_TICKS,
} from "../tuning";
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
 * tier appended four values without a single consumer being edited, which is
 * the rule earning its keep — it only holds while they all ask `isBlocking` /
 * `isWalkable` / `isBuilt` instead of testing for equality. (`state ===
 * WallState.None`, "is there anything here at all", is the one comparison the
 * renderer and the pickers are allowed, because it can never grow a case.)
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
  /** The permanent tier. Appended, never inserted, for the same reason
   *  `TaskKind` is: these numbers are in every save file. */
  StoneBp: 5,
  Stone: 6,
  StoneGateBp: 7,
  StoneGate: 8,
} as const;
export type WallStateValue = (typeof WallState)[keyof typeof WallState];

/**
 * What a wall tool builds. A string rather than an enum because it travels in
 * commands, which are never serialized — and because the tool kind carries it,
 * so there is no toggle whose forgotten setting could raise the wrong
 * material (docs/specs/2026-09-02-stone-and-terraform.md).
 */
export type WallMaterial = "timber" | "stone";

/**
 * The state table, once. Every predicate below is a lookup into it, so
 * appending a state means adding one row rather than auditing five functions
 * for the one that forgot it.
 */
interface WallDef {
  /** Stops the enclosure flood-fill. */
  readonly blocks: boolean;
  /** A colonist may stand here. */
  readonly walkable: boolean;
  readonly blueprint: boolean;
  /** What a blueprint becomes when its last work tick lands. */
  readonly built: WallStateValue;
  readonly material: WallMaterial;
  /** A gateway: it has a side you walk through, and costs more labour. */
  readonly gate: boolean;
}

const WALL_DEFS: Record<WallStateValue, WallDef> = {
  [WallState.None]: {
    blocks: false, walkable: true, blueprint: false, built: WallState.None, material: "timber", gate: false,
  },
  [WallState.PalisadeBp]: {
    blocks: false, walkable: true, blueprint: true, built: WallState.Palisade, material: "timber", gate: false,
  },
  [WallState.Palisade]: {
    blocks: true, walkable: false, blueprint: false, built: WallState.Palisade, material: "timber", gate: false,
  },
  [WallState.GateBp]: {
    blocks: false, walkable: true, blueprint: true, built: WallState.Gate, material: "timber", gate: true,
  },
  [WallState.Gate]: {
    blocks: true, walkable: true, blueprint: false, built: WallState.Gate, material: "timber", gate: true,
  },
  [WallState.StoneBp]: {
    blocks: false, walkable: true, blueprint: true, built: WallState.Stone, material: "stone", gate: false,
  },
  [WallState.Stone]: {
    blocks: true, walkable: false, blueprint: false, built: WallState.Stone, material: "stone", gate: false,
  },
  [WallState.StoneGateBp]: {
    blocks: false, walkable: true, blueprint: true, built: WallState.StoneGate, material: "stone", gate: true,
  },
  [WallState.StoneGate]: {
    blocks: true, walkable: true, blueprint: false, built: WallState.StoneGate, material: "stone", gate: true,
  },
};

/** An unknown byte reads as open ground rather than throwing: a save from a
 *  future build is refused by the codec, not here. */
function defOf(state: number): WallDef {
  return WALL_DEFS[state as WallStateValue] ?? WALL_DEFS[WallState.None];
}

/** Does this state stop the enclosure flood-fill? Built wall, gates included. */
export function isBlocking(state: number): boolean {
  return defOf(state).blocks;
}

/** Can a colonist stand here? Everything but raised palisade and stone — a
 *  gate is traffic, and a blueprint is still open ground. */
export function isWalkable(state: number): boolean {
  return defOf(state).walkable;
}

export function isBlueprint(state: number): boolean {
  return defOf(state).blueprint;
}

export function isBuilt(state: number): boolean {
  // Table membership, not `!== None`: an unknown byte has to read as open
  // ground *here too*, or the one state the other four predicates all call
  // empty would be the one this one calls a standing segment — razeable, and
  // refunding a log for a wall that was never there.
  const def = WALL_DEFS[state as WallStateValue];
  return def !== undefined && state !== WallState.None && !def.blueprint;
}

/** What a blueprint becomes when its last work tick lands. */
export function builtForm(state: number): number {
  return defOf(state).built;
}

/** What a segment of this state is made of — the item its construction
 *  consumes and its dismantling gives back. */
export function wallMaterial(state: number): WallMaterial {
  return defOf(state).material;
}

/** Is this a gateway — of either material, drawn or standing? */
export function isGateway(state: number): boolean {
  return defOf(state).gate;
}

export function isStoneWall(state: number): boolean {
  return defOf(state).material === "stone" && state !== WallState.None;
}

/** The blueprint a wall tool places. */
export function blueprintFor(material: WallMaterial, gate: boolean): WallStateValue {
  if (material === "stone") return gate ? WallState.StoneGateBp : WallState.StoneBp;
  return gate ? WallState.GateBp : WallState.PalisadeBp;
}

/** The item one segment of this material costs, and refunds when razed. */
export function wallItem(material: WallMaterial): ItemTypeValue {
  return material === "stone" ? ItemType.Block : ItemType.Log;
}

/** Work ticks to raise this blueprint. Stone is twice timber, and a gateway
 *  costs more labour than a plain run of the same material. */
export function wallBuildTicks(state: number): number {
  const def = defOf(state);
  if (def.material === "stone") return def.gate ? STONE_GATE_BUILD_TICKS : STONE_BUILD_TICKS;
  return def.gate ? GATE_BUILD_TICKS : WALL_BUILD_TICKS;
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
