import { Terrain, type World } from "./world/world";
import type { Sim } from "./store";

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
    wallMap: new Uint8Array(n),
    razeMap: new Uint8Array(n),
    insideMap: new Uint8Array(n),
    enclosureDirty: 0,
  };
}
