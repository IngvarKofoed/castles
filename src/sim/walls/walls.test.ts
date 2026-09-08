import { describe, expect, it } from "vitest";
import { applyCommands } from "../commands";
import { dropTile, spawnItem } from "../items";
import { generateTasks } from "../labour/tasks";
import { occupancy } from "../path";
import { ItemType, Loc, TaskKind, createSim, type Sim } from "../store";
import { flatSim, testBuilding } from "../test-sim";
import { advanceTick } from "../tick";
import { Terrain, tileIndex } from "../world/world";
import { WallState, canPlaceWall } from "./index";

const SEED = 20260901;
const at = (sim: Sim, x: number, y: number): number => tileIndex(x, y, sim.world.size);

/** A flat world with folk in it, so the labour loop actually runs. */
function peopledSim(size = 20): Sim {
  const sim = flatSim(size);
  for (let i = 0; i < 3; i++) {
    sim.colonists.push({
      id: sim.nextId++,
      x: 2 + i + 0.5,
      y: 2.5,
      px: 2 + i + 0.5,
      py: 2.5,
      heading: 0,
      slot: -1,
      inside: 0,
      task: -1,
      phase: 0,
      work: 0,
      carrying: -1,
      dest: -1,
      patience: 0,
      hunger: 0,
      eating: 0,
      path: [],
      step: 0,
    });
  }
  return sim;
}

describe("wall placement", () => {
  it("refuses water, rock, trees, buildings, ground items and an occupied tile", () => {
    const sim = flatSim(16);
    expect(canPlaceWall(sim, 5, 5)).toBe(true);

    sim.world.tmap[at(sim, 6, 5)] = Terrain.Water;
    sim.world.tmap[at(sim, 7, 5)] = Terrain.Rock;
    sim.world.treeMap[at(sim, 8, 5)] = 1;
    sim.wallMap[at(sim, 9, 5)] = WallState.PalisadeBp;
    spawnItem(sim, ItemType.Log, 10, 5);
    sim.buildings.push(testBuilding({ x: 11, y: 5 }));

    for (const x of [6, 7, 8, 9, 10, 11]) expect(canPlaceWall(sim, x, 5)).toBe(false);
    expect(canPlaceWall(sim, -1, 5)).toBe(false);
    expect(canPlaceWall(sim, 16, 5)).toBe(false);
  });

  it("does not need flat ground — a segment follows the hillside", () => {
    const sim = flatSim(16);
    sim.world.hmap[at(sim, 5, 5)] = 6;
    expect(canPlaceWall(sim, 5, 5)).toBe(true);
  });

  it("takes only the valid tiles of a run, and leaves the ground walkable", () => {
    const sim = flatSim(16);
    sim.world.treeMap[at(sim, 7, 5)] = 1;
    const tiles = [4, 5, 6, 7, 8].map((x) => at(sim, x, 5));
    applyCommands(sim, [{ kind: "placeWall", tiles, material: "timber" }]);

    for (const x of [4, 5, 6, 8]) expect(sim.wallMap[at(sim, x, 5)]).toBe(WallState.PalisadeBp);
    expect(sim.wallMap[at(sim, 7, 5)]).toBe(WallState.None);
    // A drawn line must not wall its own builders off, so blueprints stay
    // passable until they are actually raised.
    expect(sim.enclosureDirty).toBe(1);
  });

  it("places a gate as a single tile, and ignores junk indices", () => {
    const sim = flatSim(16);
    applyCommands(sim, [{ kind: "placeGate", tiles: [at(sim, 5, 5), -1, 99999], material: "timber" }]);
    expect(sim.wallMap[at(sim, 5, 5)]).toBe(WallState.GateBp);
  });
});

describe("raising a wall", () => {
  it("hires nobody until a log is free, then exactly one builder per segment", () => {
    const sim = peopledSim();
    applyCommands(sim, [{ kind: "placeWall", tiles: [at(sim, 8, 8), at(sim, 9, 8)], material: "timber" }]);
    generateTasks(sim);
    expect(sim.tasks.filter((t) => t.kind === TaskKind.BuildWall)).toHaveLength(0);

    spawnItem(sim, ItemType.Log, 6, 8);
    generateTasks(sim);
    expect(sim.tasks.filter((t) => t.kind === TaskKind.BuildWall)).toHaveLength(1);

    spawnItem(sim, ItemType.Log, 6, 9);
    for (let i = 0; i < 10; i++) generateTasks(sim);
    const tasks = sim.tasks.filter((t) => t.kind === TaskKind.BuildWall);
    expect(tasks).toHaveLength(2);
    // One log each, reserved at creation — two builders for one log is
    // impossible by construction, not by care.
    expect(new Set(tasks.map((t) => t.item)).size).toBe(2);
    expect(sim.items.every((it) => it.reservedBy >= 0)).toBe(true);
  });

  it("carries the log to the segment, consumes it at completion, and blocks the tile", () => {
    const sim = peopledSim();
    spawnItem(sim, ItemType.Log, 6, 8);
    applyCommands(sim, [{ kind: "placeWall", tiles: [at(sim, 8, 8)], material: "timber" }]);

    let carried = false;
    for (let t = 0; t < 200 && sim.wallMap[at(sim, 8, 8)] !== WallState.Palisade; t++) {
      advanceTick(sim);
      // The log stays in the builder's hands right up to the completion
      // instant — no delivery ledger, which is what makes every cancellation
      // path refund for free.
      if (sim.colonists.some((c) => c.carrying >= 0)) carried = true;
    }
    expect(carried).toBe(true);
    expect(sim.wallMap[at(sim, 8, 8)]).toBe(WallState.Palisade);
    expect(sim.items).toHaveLength(0);
    expect(sim.tasks.filter((t) => t.kind === TaskKind.BuildWall)).toHaveLength(0);
    expect(sim.insideMap.length).toBe(sim.world.size * sim.world.size);
  });

  it("builds a gate too, and it stays walkable once standing", () => {
    const sim = peopledSim();
    spawnItem(sim, ItemType.Log, 6, 8);
    applyCommands(sim, [{ kind: "placeGate", tiles: [at(sim, 8, 8)], material: "timber" }]);
    for (let t = 0; t < 300 && sim.wallMap[at(sim, 8, 8)] !== WallState.Gate; t++) advanceTick(sim);
    expect(sim.wallMap[at(sim, 8, 8)]).toBe(WallState.Gate);
  });

  it("steps a colonist and a stray log off the segment as it completes", () => {
    const sim = peopledSim();
    // A log lying on the tile *before* the blueprint went down — the case
    // `canPlaceWall` cannot refuse, because the blueprint came second.
    applyCommands(sim, [{ kind: "placeWall", tiles: [at(sim, 8, 8)], material: "timber" }]);
    const stray = spawnItem(sim, ItemType.Log, 8, 8)!;
    stray.x = 8;
    stray.y = 8;
    spawnItem(sim, ItemType.Log, 6, 8);
    // And somebody standing on it, parked there by hand.
    const bystander = sim.colonists[2];
    bystander.x = 8.5;
    bystander.y = 8.5;
    bystander.px = 8.5;
    bystander.py = 8.5;

    for (let t = 0; t < 300 && sim.wallMap[at(sim, 8, 8)] !== WallState.Palisade; t++) advanceTick(sim);
    expect(sim.wallMap[at(sim, 8, 8)]).toBe(WallState.Palisade);

    const onTile = sim.items.filter((it) => it.loc === Loc.Ground && it.x === 8 && it.y === 8);
    expect(onTile).toHaveLength(0);
    for (let t = 0; t < 30; t++) advanceTick(sim);
    expect([Math.floor(bystander.x), Math.floor(bystander.y)]).not.toEqual([8, 8]);
  });
});

describe("dismantling", () => {
  it("tears a blueprint up on the spot and drops the log the builder was carrying", () => {
    const sim = peopledSim();
    spawnItem(sim, ItemType.Log, 6, 8);
    applyCommands(sim, [{ kind: "placeWall", tiles: [at(sim, 8, 8)], material: "timber" }]);
    // Run until somebody is actually carrying the log toward the segment.
    let holder = -1;
    for (let t = 0; t < 100 && holder < 0; t++) {
      advanceTick(sim);
      holder = sim.colonists.find((c) => c.carrying >= 0)?.id ?? -1;
    }
    expect(holder).toBeGreaterThanOrEqual(0);

    applyCommands(sim, [{ kind: "designateRaze", tiles: [at(sim, 8, 8)] }]);
    generateTasks(sim);
    expect(sim.wallMap[at(sim, 8, 8)]).toBe(WallState.None);
    expect(sim.razeMap[at(sim, 8, 8)]).toBe(0);
    expect(sim.tasks.filter((t) => t.kind === TaskKind.BuildWall)).toHaveLength(0);
    // The refund *is* the carried log falling where the builder stood; nothing
    // else tracks it.
    expect(sim.items).toHaveLength(1);
    expect(sim.items[0].loc).toBe(Loc.Ground);
    expect(sim.items[0].reservedBy).toBe(-1);
  });

  it("works a built segment down and gives the log back", () => {
    const sim = peopledSim();
    spawnItem(sim, ItemType.Log, 6, 8);
    applyCommands(sim, [{ kind: "placeWall", tiles: [at(sim, 8, 8)], material: "timber" }]);
    for (let t = 0; t < 300 && sim.wallMap[at(sim, 8, 8)] !== WallState.Palisade; t++) advanceTick(sim);
    expect(sim.items).toHaveLength(0);

    applyCommands(sim, [{ kind: "designateRaze", tiles: [at(sim, 8, 8)] }]);
    for (let t = 0; t < 300 && sim.wallMap[at(sim, 8, 8)] !== WallState.None; t++) advanceTick(sim);
    expect(sim.wallMap[at(sim, 8, 8)]).toBe(WallState.None);
    expect(sim.razeMap[at(sim, 8, 8)]).toBe(0);
    expect(sim.items).toHaveLength(1);
    // The tile has just become free, so the log lands on it — the chop
    // precedent, where the log lands where the tree stood.
    expect([sim.items[0].x, sim.items[0].y]).toEqual([8, 8]);
  });

  it("only marks tiles that hold a wall, and a second click takes the mark back", () => {
    const sim = peopledSim();
    applyCommands(sim, [{ kind: "placeWall", tiles: [at(sim, 8, 8)], material: "timber" }]);
    applyCommands(sim, [{ kind: "designateRaze", tiles: [at(sim, 8, 8), at(sim, 9, 9)] }]);
    expect(sim.razeMap[at(sim, 8, 8)]).toBe(1);
    expect(sim.razeMap[at(sim, 9, 9)]).toBe(0);

    applyCommands(sim, [{ kind: "cancelRaze", x: 8, y: 8 }]);
    expect(sim.razeMap[at(sim, 8, 8)]).toBe(0);
    expect(sim.wallMap[at(sim, 8, 8)]).toBe(WallState.PalisadeBp);
  });

  it("cancelling a mark stops a raze already under way", () => {
    const sim = peopledSim();
    sim.wallMap[at(sim, 8, 8)] = WallState.Palisade;
    applyCommands(sim, [{ kind: "designateRaze", tiles: [at(sim, 8, 8)] }]);
    generateTasks(sim);
    expect(sim.tasks.filter((t) => t.kind === TaskKind.Raze)).toHaveLength(1);

    applyCommands(sim, [{ kind: "cancelRaze", x: 8, y: 8 }]);
    expect(sim.tasks.filter((t) => t.kind === TaskKind.Raze)).toHaveLength(0);
    expect(sim.wallMap[at(sim, 8, 8)]).toBe(WallState.Palisade);
  });

  it("clears a mark left behind on a tile whose wall went away", () => {
    const sim = peopledSim();
    sim.wallMap[at(sim, 8, 8)] = WallState.Palisade;
    applyCommands(sim, [{ kind: "designateRaze", tiles: [at(sim, 8, 8)] }]);
    sim.wallMap[at(sim, 8, 8)] = WallState.None;
    generateTasks(sim);
    expect(sim.razeMap[at(sim, 8, 8)]).toBe(0);
    expect(sim.tasks.filter((t) => t.kind === TaskKind.Raze)).toHaveLength(0);
  });

  it("bumps the chunk version when a segment is marked, because the timber is baked", () => {
    const sim = createSim(SEED);
    const size = sim.world.size;
    const c = Math.floor(size / 2);
    sim.wallMap[c * size + c] = WallState.Palisade;
    const chunk = Math.floor(c / 16) * (size / 16) + Math.floor(c / 16);

    const before = sim.world.chunkVersion[chunk];
    applyCommands(sim, [{ kind: "designateRaze", tiles: [c * size + c] }]);
    expect(sim.world.chunkVersion[chunk]).toBeGreaterThan(before);
    const marked = sim.world.chunkVersion[chunk];
    applyCommands(sim, [{ kind: "cancelRaze", x: c, y: c }]);
    expect(sim.world.chunkVersion[chunk]).toBeGreaterThan(marked);
  });
});

describe("dropping things near walls", () => {
  it("never puts an item on a wall tile, blueprint or gate included", () => {
    // A log lying where a wall is or will be would block the very segment it
    // was fetched for, since `canPlaceWall` refuses a tile with an item on it.
    const sim = flatSim(12);
    sim.wallMap[at(sim, 5, 5)] = WallState.PalisadeBp;
    sim.wallMap[at(sim, 6, 5)] = WallState.Gate;
    sim.wallMap[at(sim, 5, 6)] = WallState.Palisade;
    const occ = occupancy(sim);
    expect(dropTile(sim, occ, 5, 5)).not.toEqual([5, 5]);
    expect(dropTile(sim, occ, 6, 5)).not.toEqual([6, 5]);
    expect(dropTile(sim, occ, 5, 6)).not.toEqual([5, 6]);
    // And what it does pick is genuinely free.
    for (const [x, y] of [[5, 5], [6, 5], [5, 6]]) {
      const where = dropTile(sim, occ, x, y)!;
      expect(sim.wallMap[at(sim, where[0], where[1])]).toBe(WallState.None);
    }
  });
});

describe("walking a route the wall closed", () => {
  /** A colonist mid-route, heading east along row 5 towards (10, 5). */
  function walker(sim: Sim): Sim["colonists"][number] {
    const c = peopledSim(12).colonists[0];
    c.x = 2.5;
    c.y = 5.5;
    c.px = c.x;
    c.py = c.y;
    c.path = [];
    for (let x = 3; x <= 10; x++) c.path.push(at(sim, x, 5));
    sim.colonists.push(c);
    return c;
  }

  it("re-plans round a segment that finished across the route, keeping the errand", () => {
    // Blueprints are walkable, so every route is free to cross a drawn run and
    // this is the ordinary case, not a corner one. Before the check in `walk`
    // the colonist strolled straight through standing palisade.
    const sim = flatSim(12);
    const c = walker(sim);
    // The wall closes row 5 at x = 6, but leaves a way round at y = 4.
    for (let y = 5; y < 12; y++) sim.wallMap[at(sim, 6, y)] = WallState.Palisade;

    let trespassed = false;
    for (let t = 0; t < 60; t++) {
      advanceTick(sim);
      if (sim.wallMap[at(sim, Math.floor(c.x), Math.floor(c.y))] === WallState.Palisade) trespassed = true;
      if (Math.floor(c.x) === 10 && Math.floor(c.y) === 5) break;
    }
    // Arrived — and never once stood on the wall on the way, which is the half
    // of this that fails without the re-check.
    expect(trespassed).toBe(false);
    expect([Math.floor(c.x), Math.floor(c.y)]).toEqual([10, 5]);
  });

  it("stops dead rather than walking through when there is no way round", () => {
    const sim = flatSim(12);
    const c = walker(sim);
    // A full-height wall at x = 6: nothing gets past it.
    for (let y = 0; y < 12; y++) sim.wallMap[at(sim, 6, y)] = WallState.Palisade;

    for (let t = 0; t < 60; t++) advanceTick(sim);
    expect(Math.floor(c.x)).toBeLessThan(6);
    expect(c.path).toEqual([]);
  });
});

describe("a closed ring, end to end", () => {
  it("builds a walled colony with a gate and counts the ground it claimed", () => {
    const sim = peopledSim(24);
    const tiles: number[] = [];
    for (let d = 0; d <= 6; d++) {
      tiles.push(at(sim, 8 + d, 8), at(sim, 8 + d, 14), at(sim, 8, 8 + d), at(sim, 14, 8 + d));
    }
    // Plenty of logs, out of the way of the run itself.
    for (let i = 0; i < 30; i++) spawnItem(sim, ItemType.Log, 3 + (i % 4), 3 + Math.floor(i / 4));
    applyCommands(sim, [{ kind: "placeWall", tiles, material: "timber" }]);
    // One tile of the run becomes the gate instead: raze-then-place, which is
    // how a palisade is ever converted.
    applyCommands(sim, [{ kind: "designateRaze", tiles: [at(sim, 11, 14)] }]);
    generateTasks(sim);
    applyCommands(sim, [{ kind: "placeGate", tiles: [at(sim, 11, 14)], material: "timber" }]);

    for (let t = 0; t < 4000; t++) {
      advanceTick(sim);
      if (!sim.wallMap.some((v) => v === WallState.PalisadeBp || v === WallState.GateBp)) break;
    }
    expect(sim.wallMap[at(sim, 11, 14)]).toBe(WallState.Gate);
    expect(sim.insideMap[at(sim, 11, 11)]).toBe(1);
    // The 5×5 interior of a 7×7 ring.
    expect([...sim.insideMap].reduce((n, v) => n + v, 0)).toBe(25);
    expect(sim.enclosureDirty).toBe(0);
  });
});
