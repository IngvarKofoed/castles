import { Terrain, type World } from "./world/world";
import { BuildingKind, BuildingState, type Building, type Sim } from "./store";

/**
 * A tiny flat world with nothing on it, for tests that want to block exactly
 * what they mean to block rather than hunt for a clearing in a generated map.
 *
 * It lives in a source file rather than inside one `*.test.ts` so that adding
 * a field to `Sim` breaks in **one** place instead of quietly leaving a
 * hand-built fixture behind — which is precisely the drift the save-fixture
 * shape test exists to catch, and there is no reason to invite it here too.
 * Nothing in the app imports this, so it is never bundled.
 */
export function flatSim(size = 12, height = 4): Sim {
  const n = size * size;
  const world: World = {
    size,
    seed: 1,
    hmap: new Uint8Array(n).fill(height),
    tmap: new Uint8Array(n).fill(Terrain.Grass),
    treeMap: new Uint8Array(n),
    // One chunk is enough: nothing here asserts on chunk fan-out, and
    // `markChunkDirty` clamps to the grid it is given.
    chunkVersion: new Uint32Array(Math.max(1, Math.ceil(size / 16) ** 2)).fill(1),
  };
  return {
    world,
    tick: 0,
    rngState: 1,
    nextId: 1,
    colonists: [],
    items: [],
    buildings: [],
    tasks: [],
    chopMap: new Uint8Array(n),
    mineMap: new Uint8Array(n),
    terraformMap: new Uint8Array(n),
    wallMap: new Uint8Array(n),
    razeMap: new Uint8Array(n),
    insideMap: new Uint8Array(n),
    enclosureDirty: 0,
  };
}

/**
 * A finished 2×2 stockpile, for tests that need a building in the way rather
 * than a colony that built one. Here for the same reason `flatSim` is: a
 * hand-written `Building` literal in a test file goes quietly stale the moment
 * the entity grows a field, and the accept flags are exactly the kind of field
 * that keeps being added.
 */
export function testBuilding(patch: Partial<Building> = {}): Building {
  return {
    id: 99,
    kind: BuildingKind.Stockpile,
    x: 0,
    y: 0,
    w: 2,
    h: 2,
    state: BuildingState.Active,
    progress: 0,
    reservedIncoming: 0,
    acceptLog: 1,
    acceptPlank: 1,
    acceptRock: 1,
    acceptBlock: 1,
    worker: -1,
    millProgress: -1,
    ...patch,
  };
}
