import { STARTING_COLONISTS } from "./tuning";
import { generate, tileIndex, Terrain, type World } from "./world/world";

/**
 * The sim store: one serializable object holding everything the game is.
 *
 * The plain-data rule (docs/ARCHITECTURE.md, "The one hard boundary") is
 * absolute here and persistence lands next, so the shape below is what a save
 * freezes: plain objects, plain number arrays and typed arrays only. No Sets,
 * no Maps, no class instances, no closures, no `undefined`. Ids are numbers
 * and "none" is `-1`, never null — `structuredClone(sim)` must round-trip the
 * whole thing and `hashSim` must see a total order over it.
 *
 * Enums are frozen `as const` objects of small integers rather than string
 * unions: they hash compactly and serialize as themselves. **Every enum here is
 * append-only** — the numbers are in save files, so inserting a value silently
 * reinterprets every old save that held the ones after it.
 */

export const ItemType = {
  Log: 0,
  Plank: 1,
} as const;
export type ItemTypeValue = (typeof ItemType)[keyof typeof ItemType];

/** Where an item is. Exactly one of the location fields is meaningful. */
export const Loc = {
  /** On the ground at (x, y). */
  Ground: 0,
  /** In a colonist's hands; `holder` is the colonist id. */
  Carried: 1,
  /** Inside a building; `holder` is the building id. Delivered construction
   *  materials and workshop buffers are both this — never bare counts. */
  Stored: 2,
} as const;
export type LocValue = (typeof Loc)[keyof typeof Loc];

export const BuildingKind = {
  Stockpile: 0,
  Sawmill: 1,
} as const;
export type BuildingKindValue = (typeof BuildingKind)[keyof typeof BuildingKind];

export const BuildingState = {
  /** Placed, still short of its materials. */
  Blueprint: 0,
  /** Materials delivered; waiting on or under construction labour. */
  Building: 1,
  /** Finished and working. */
  Active: 2,
} as const;
export type BuildingStateValue = (typeof BuildingState)[keyof typeof BuildingState];

/**
 * Task kinds. **Append only, never insert** — a kind is a number written into
 * every save, so slotting a new one into the middle would renumber every live
 * task in every old save into a different meaning, with no migration able to
 * tell the difference.
 *
 * The numeric order therefore says nothing about priority: that lives in
 * `TASK_PRIORITY` (tuning.ts), which is the one fixed global order a pool
 * worker works down. It used to be this enum's order, which was a step-2
 * convenience the wall tier removed rather than patched
 * (docs/specs/2026-09-02-palisade-walls.md).
 */
export const TaskKind = {
  Build: 0,
  HaulToSite: 1,
  HaulToInput: 2,
  Chop: 3,
  HaulToStore: 4,
  BuildWall: 5,
  Raze: 6,
} as const;
export type TaskKindValue = (typeof TaskKind)[keyof typeof TaskKind];

/** What a colonist is doing with its current task. */
export const Phase = {
  /** Walking to the thing to pick up. */
  ToSource: 0,
  /** Walking to where the work happens. */
  ToTarget: 1,
  /** Standing on the spot, accumulating work ticks. */
  Working: 2,
} as const;

export interface Colonist {
  id: number;
  /** Continuous tile coordinates; the centre of tile (t, u) is (t+.5, u+.5). */
  x: number;
  y: number;
  /** Position at the end of the previous tick — the renderer lerps px→x. */
  px: number;
  py: number;
  /** Facing, radians, atan2(dx, dy) so a model built facing +y turns right. */
  heading: number;
  /** Building this colonist is a slot worker of; -1 means they're in the pool. */
  slot: number;
  /**
   * 1 once a slot worker has reached its building and stepped inside it, 0
   * otherwise. Inside, the colonist's position is pinned to the footprint's
   * centre and the renderer skips drawing them — until there are real work
   * animations, a figure standing motionless at a door reads as loitering
   * rather than working. Production gates on this rather than on proximity,
   * so "at work" is one field instead of a distance test.
   */
  inside: number;
  /** Claimed task, or -1. */
  task: number;
  /** One of Phase.*, meaningful while `task >= 0`. */
  phase: number;
  /** Work ticks accumulated in Phase.Working. */
  work: number;
  /** Item in hand, or -1. */
  carrying: number;
  /** Remaining route as tile indices; `step` is the index of the next one. */
  path: number[];
  step: number;
}

export interface Item {
  id: number;
  type: number;
  loc: number;
  /** Tile coordinates while `loc === Loc.Ground`. */
  x: number;
  y: number;
  /** Colonist id while Carried, building id while Stored, else -1. */
  holder: number;
  /**
   * Task that owns this item, or -1. A task reserves its item for its whole
   * life, so no second hauler can ever target it — two-haulers-one-log is the
   * classic colony-sim bug and this is where it is designed out.
   */
  reservedBy: number;
}

export interface Building {
  id: number;
  kind: number;
  /** Footprint origin (minimum corner) and size in tiles. */
  x: number;
  y: number;
  w: number;
  h: number;
  state: number;
  /** Construction ticks accumulated. */
  progress: number;
  /**
   * Units of incoming capacity claimed by live tasks — reserved when the task
   * is created, released when it finishes or is cancelled. Task generation
   * reads `stored + reservedIncoming` so it never over-orders.
   */
  reservedIncoming: number;
  /** Stockpile filters, 0/1. Toggling them is later sugar; the fields exist
   *  now so persistence freezes the final shape. */
  acceptLog: number;
  acceptPlank: number;
  /** Slot worker, or -1. */
  worker: number;
  /**
   * Milling ticks accumulated, or -1 when not milling. The log is consumed at
   * the *start* of a mill, so progress living on the building is what makes
   * unstaffing mid-mill lose nothing: it waits here and resumes on restaff.
   */
  millProgress: number;
}

export interface Task {
  id: number;
  kind: number;
  /** Item to move (haul kinds), else -1. */
  item: number;
  /** Destination or subject building, else -1. */
  building: number;
  /** Chop target tile, else -1. */
  x: number;
  y: number;
  /** Colonist working it, or -1. */
  claimedBy: number;
  /** Ticks until anyone may claim it again. */
  cooldown: number;
}

export interface Sim {
  world: World;
  tick: number;
  /** The seeded PRNG's whole state — a number, so a save captures it. */
  rngState: number;
  nextId: number;
  colonists: Colonist[];
  items: Item[];
  buildings: Building[];
  tasks: Task[];
  /** 1 where the player has marked a tree for chopping. Player intent, so it
   *  lives beside the world rather than in it. */
  chopMap: Uint8Array;
  /**
   * One `WallState` per tile — the wall graph, as a grid rather than as
   * hundreds of 1×1 entities. It lives in `Sim` rather than `World` because it
   * is player-made, and it is read only through `sim/walls`' predicates so the
   * stone tier can append states without touching a consumer.
   */
  wallMap: Uint8Array;
  /** 1 where the player has marked a wall segment for dismantling — `chopMap`'s
   *  player-intent pattern, applied to walls. */
  razeMap: Uint8Array;
  /**
   * 1 where the wall graph encloses the tile: derived from `wallMap` by
   * `sim/walls/enclosure`, and serialized with the store like any other field
   * (it is deterministic, so what a save holds and what a load recomputes
   * agree). The renderer, the HUD and — from step 4 — threats all read it.
   */
  insideMap: Uint8Array;
  /**
   * 1 when a wall event this tick has invalidated `insideMap`. The recompute
   * batches to the end of the tick, so this is always 0 at a tick boundary and
   * a save can never carry a pending one.
   */
  enclosureDirty: number;
}

/** Mint the next entity id. The only id source; ids are never reused. */
export function mintId(sim: Sim): number {
  return sim.nextId++;
}

export function findColonist(sim: Sim, id: number): Colonist | null {
  for (const c of sim.colonists) if (c.id === id) return c;
  return null;
}

export function findItem(sim: Sim, id: number): Item | null {
  for (const it of sim.items) if (it.id === id) return it;
  return null;
}

export function findBuilding(sim: Sim, id: number): Building | null {
  for (const b of sim.buildings) if (b.id === id) return b;
  return null;
}

export function findTask(sim: Sim, id: number): Task | null {
  for (const t of sim.tasks) if (t.id === id) return t;
  return null;
}

/**
 * Build the opening colony: a generated world plus STARTING_COLONISTS folk
 * standing in the clearing at its centre.
 *
 * Spawn tiles come from a deterministic outward ring walk, not the PRNG, so
 * the opening is identical for a seed no matter what else changes.
 */
export function createSim(seed: number): Sim {
  const world = generate(seed);
  const sim: Sim = {
    world,
    tick: 0,
    rngState: seed >>> 0,
    nextId: 1,
    colonists: [],
    items: [],
    buildings: [],
    tasks: [],
    chopMap: new Uint8Array(world.size * world.size),
    wallMap: new Uint8Array(world.size * world.size),
    razeMap: new Uint8Array(world.size * world.size),
    insideMap: new Uint8Array(world.size * world.size),
    // A wall-less world encloses nothing, so the zeroed layer above is already
    // correct — but the flag makes the first tick settle it anyway rather than
    // trusting that. `store.ts` deliberately does not import `walls/enclosure`
    // to do it here: that folder reaches `buildings.ts`, whose module body
    // needs `BuildingKind` from this file, and the resulting cycle would fail
    // or not depending purely on which module a bundler happened to load first.
    enclosureDirty: 1,
  };

  const centre = Math.floor(world.size / 2);
  for (const [x, y] of spawnTiles(world, centre, STARTING_COLONISTS)) {
    sim.colonists.push({
      id: mintId(sim),
      x: x + 0.5,
      y: y + 0.5,
      px: x + 0.5,
      py: y + 0.5,
      heading: 0,
      slot: -1,
      inside: 0,
      task: -1,
      phase: 0,
      work: 0,
      carrying: -1,
      path: [],
      step: 0,
    });
  }
  return sim;
}

/** Walk squares of growing radius around (cx, cy), yielding spawnable tiles. */
function spawnTiles(world: World, centre: number, count: number): [number, number][] {
  const out: [number, number][] = [];
  const ok = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= world.size || y >= world.size) return false;
    const i = tileIndex(x, y, world.size);
    return world.tmap[i] !== Terrain.Water && world.treeMap[i] === 0;
  };
  for (let r = 0; out.length < count && r < world.size; r++) {
    for (let dy = -r; dy <= r && out.length < count; dy++) {
      for (let dx = -r; dx <= r && out.length < count; dx++) {
        // Ring only: interior tiles were covered by a smaller r.
        if (r > 0 && Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        if (ok(centre + dx, centre + dy)) out.push([centre + dx, centre + dy]);
      }
    }
  }
  return out;
}
