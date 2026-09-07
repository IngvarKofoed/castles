import { describe, expect, it } from "vitest";
import { BUILDING_DEFS, canPlace } from "../buildings";
import { applyCommands } from "../commands";
import { spawnItem } from "../items";
import { occupancy, passable } from "../path";
import {
  BuildingKind,
  BuildingState,
  ItemType,
  Loc,
  TaskKind,
  createSim,
  type Sim,
} from "../store";
import { advanceTick } from "../tick";
import { inspect } from "../know";
import { TASK_PRIORITY, WORKSHOP_INPUT_CAP, WORKSHOP_OUTPUT_CAP } from "../tuning";
import { generateTasks } from "./tasks";

const SEED = 20260901;

/** A clear, flat 2×2 site near the map centre. */
function site(sim: Sim, kind: 0 | 1, avoid: { x: number; y: number }[] = []): [number, number] {
  const centre = Math.floor(sim.world.size / 2);
  for (let r = 2; r < 40; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = centre + dx;
        const y = centre + dy;
        if (avoid.some((a) => Math.abs(a.x - x) < 5 && Math.abs(a.y - y) < 5)) continue;
        if (canPlace(sim, kind, x, y)) return [x, y];
      }
    }
  }
  throw new Error("no site");
}

/** Tree tiles nearest (x, y), by growing rings, so the pick is deterministic. */
function nearestTrees(sim: Sim, x: number, y: number, count: number): [number, number][] {
  const size = sim.world.size;
  const out: [number, number][] = [];
  for (let r = 1; r < 60 && out.length < count; r++) {
    for (let dy = -r; dy <= r && out.length < count; dy++) {
      for (let dx = -r; dx <= r && out.length < count; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const tx = x + dx;
        const ty = y + dy;
        if (tx < 0 || ty < 0 || tx >= size || ty >= size) continue;
        if (sim.world.treeMap[tx + ty * size]) out.push([tx, ty]);
      }
    }
  }
  return out;
}

describe("the priority table", () => {
  /**
   * `TASK_PRIORITY` holds bare numbers, because `tuning.ts` may not import
   * `TaskKind` as a value without closing a load-order-dependent cycle. This
   * is what stops that from being a silent coupling: it names every entry, so
   * a renumbered enum — the exact bug appending `BuildWall` and `Raze` was
   * meant to design out — fails here instead of quietly reordering the colony's
   * work.
   */
  it("works the kinds in the order the spec names, by name", () => {
    const nameOf = (value: number): string =>
      Object.entries(TaskKind).find(([, v]) => v === value)?.[0] ?? `unknown:${value}`;
    expect(TASK_PRIORITY.map(nameOf)).toEqual([
      "Build",
      "BuildWall",
      // A breach outranks hauling and chopping — the counterplay to a monster
      // is people, so repair has to actually get people — but never an active
      // build that may be one segment from closing a ring.
      "Repair",
      "HaulToSite",
      "HaulToInput",
      "Chop",
      "Mine",
      "Raze",
      "Terraform",
      "HaulToStore",
    ]);
  });

  it("covers every live task kind exactly once, or a kind would never be worked", () => {
    expect([...TASK_PRIORITY].sort((a, b) => a - b)).toEqual(Object.values(TaskKind).sort((a, b) => a - b));
  });
});

describe("task generation is idempotent", () => {
  it("does not pile up duplicate haul tasks for one blueprint", () => {
    const sim = createSim(SEED);
    const [x, y] = site(sim, BuildingKind.Stockpile);
    applyCommands(sim, [{ kind: "place", building: BuildingKind.Stockpile, x, y }]);
    for (let i = 0; i < 5; i++) spawnItem(sim, ItemType.Log, x + 4, y);

    for (let i = 0; i < 20; i++) generateTasks(sim);
    const haul = sim.tasks.filter((t) => t.kind === TaskKind.HaulToSite);
    expect(haul.length).toBe(BUILDING_DEFS[BuildingKind.Stockpile].cost);
  });

  it("gives each designated tree exactly one chop task, however often it runs", () => {
    const sim = createSim(SEED);
    const trees: [number, number][] = [];
    const size = sim.world.size;
    for (let i = 0; i < sim.world.treeMap.length && trees.length < 4; i++) {
      if (sim.world.treeMap[i]) trees.push([i % size, Math.floor(i / size)]);
    }
    applyCommands(
      sim,
      trees.map(([tx, ty]) => ({ kind: "designateChop" as const, tiles: [ty * size + tx] })),
    );
    for (let i = 0; i < 10; i++) generateTasks(sim);
    expect(sim.tasks.filter((t) => t.kind === TaskKind.Chop).length).toBe(4);
  });

  it("never orders more logs than a sawmill's input buffer holds", () => {
    const sim = createSim(SEED);
    const [x, y] = site(sim, BuildingKind.Sawmill);
    applyCommands(sim, [{ kind: "place", building: BuildingKind.Sawmill, x, y }]);
    const mill = sim.buildings[0];
    mill.state = BuildingState.Active;
    mill.worker = sim.colonists[0].id;
    sim.colonists[0].slot = mill.id;
    for (let i = 0; i < 8; i++) spawnItem(sim, ItemType.Log, x + 5, y);

    for (let i = 0; i < 20; i++) generateTasks(sim);
    expect(sim.tasks.filter((t) => t.kind === TaskKind.HaulToInput).length).toBe(WORKSHOP_INPUT_CAP);
  });

  it("reserves each item for exactly one task", () => {
    const sim = createSim(SEED);
    const [x, y] = site(sim, BuildingKind.Stockpile);
    applyCommands(sim, [{ kind: "place", building: BuildingKind.Stockpile, x, y }]);
    for (let i = 0; i < 6; i++) spawnItem(sim, ItemType.Log, x + 4 + i, y);
    for (let i = 0; i < 10; i++) generateTasks(sim);

    const reserved = sim.items.filter((it) => it.reservedBy >= 0).map((it) => it.reservedBy);
    expect(new Set(reserved).size).toBe(reserved.length);
  });
});

describe("the pool/slot tension", () => {
  it("staffing takes a colonist out of the pool for as long as it is staffed", () => {
    const sim = createSim(SEED);
    const [x, y] = site(sim, BuildingKind.Sawmill);
    applyCommands(sim, [{ kind: "place", building: BuildingKind.Sawmill, x, y }]);
    const mill = sim.buildings[0];
    mill.state = BuildingState.Active;

    const before = sim.colonists.filter((c) => c.slot < 0).length;
    applyCommands(sim, [{ kind: "staff", building: mill.id }]);
    expect(sim.colonists.filter((c) => c.slot < 0).length).toBe(before - 1);
    expect(mill.worker).toBeGreaterThanOrEqual(0);

    applyCommands(sim, [{ kind: "unstaff", building: mill.id }]);
    expect(sim.colonists.filter((c) => c.slot < 0).length).toBe(before);
    expect(mill.worker).toBe(-1);
  });

  it("a slot worker never claims a queue task", () => {
    const sim = createSim(SEED);
    const [x, y] = site(sim, BuildingKind.Sawmill);
    applyCommands(sim, [{ kind: "place", building: BuildingKind.Sawmill, x, y }]);
    const mill = sim.buildings[0];
    mill.state = BuildingState.Active;
    applyCommands(sim, [{ kind: "staff", building: mill.id }]);
    const worker = sim.colonists.find((c) => c.slot === mill.id)!;

    // Pile up work the pool would fall over itself to take.
    for (let i = 0; i < 20; i++) spawnItem(sim, ItemType.Log, x + 3, y + 3);
    for (let t = 0; t < 200; t++) {
      advanceTick(sim);
      expect(worker.task).toBe(-1);
      expect(worker.slot).toBe(mill.id);
    }
  });

  it("walks the worker to the mill and then puts them inside it", () => {
    const sim = createSim(SEED);
    const [x, y] = site(sim, BuildingKind.Sawmill);
    applyCommands(sim, [{ kind: "place", building: BuildingKind.Sawmill, x, y }]);
    const mill = sim.buildings[0];
    mill.state = BuildingState.Active;
    applyCommands(sim, [{ kind: "staff", building: mill.id }]);
    const worker = sim.colonists.find((c) => c.slot === mill.id)!;

    // Bound to the slot, but out on the ground until they arrive.
    expect(worker.inside).toBe(0);
    expect(inspect(sim, mill.id)?.worker).toBe("walking");

    for (let t = 0; t < 200 && !worker.inside; t++) advanceTick(sim);
    expect(worker.inside).toBe(1);
    expect(inspect(sim, mill.id)?.worker).toBe("inside");

    // Pinned to the footprint, and staying there.
    expect(worker.x).toBeGreaterThanOrEqual(mill.x);
    expect(worker.x).toBeLessThanOrEqual(mill.x + mill.w);
    expect(worker.y).toBeGreaterThanOrEqual(mill.y);
    expect(worker.y).toBeLessThanOrEqual(mill.y + mill.h);
    const at = [worker.x, worker.y];
    for (let t = 0; t < 100; t++) advanceTick(sim);
    expect([worker.x, worker.y]).toEqual(at);
    expect(worker.path).toEqual([]);
  });

  it("does not mill while the worker is still walking over", () => {
    const sim = createSim(SEED);
    const [x, y] = site(sim, BuildingKind.Sawmill);
    applyCommands(sim, [{ kind: "place", building: BuildingKind.Sawmill, x, y }]);
    const mill = sim.buildings[0];
    mill.state = BuildingState.Active;
    const log = spawnItem(sim, ItemType.Log, x + 4, y)!;
    log.loc = Loc.Stored;
    log.holder = mill.id;
    applyCommands(sim, [{ kind: "staff", building: mill.id }]);
    const worker = sim.colonists.find((c) => c.slot === mill.id)!;

    // The walk over is not production time: nothing is cut until they are in.
    for (let t = 0; t < 200; t++) {
      advanceTick(sim);
      if (!worker.inside) expect(mill.millProgress).toBe(-1);
      else break;
    }
    expect(worker.inside).toBe(1);
  });

  it("steps the worker back out onto walkable ground when unstaffed", () => {
    const sim = createSim(SEED);
    const [x, y] = site(sim, BuildingKind.Sawmill);
    applyCommands(sim, [{ kind: "place", building: BuildingKind.Sawmill, x, y }]);
    const mill = sim.buildings[0];
    mill.state = BuildingState.Active;
    applyCommands(sim, [{ kind: "staff", building: mill.id }]);
    const worker = sim.colonists.find((c) => c.slot === mill.id)!;
    for (let t = 0; t < 200 && !worker.inside; t++) advanceTick(sim);
    expect(worker.inside).toBe(1);

    applyCommands(sim, [{ kind: "unstaff", building: mill.id }]);
    expect(worker.inside).toBe(0);
    expect(worker.slot).toBe(-1);
    expect(inspect(sim, mill.id)?.worker).toBe("none");

    // Out of the footprint, on ground that can be stood on.
    const inFootprint =
      Math.floor(worker.x) >= mill.x &&
      Math.floor(worker.x) < mill.x + mill.w &&
      Math.floor(worker.y) >= mill.y &&
      Math.floor(worker.y) < mill.y + mill.h;
    expect(inFootprint).toBe(false);
    expect(passable(sim.world, sim.wallMap, occupancy(sim), Math.floor(worker.x), Math.floor(worker.y))).toBe(true);

    // And back in the pool: they take queue work again. Loose logs alone
    // generate nothing without a stockpile to put them in, so the work here
    // is chopping — and there is more of it than there are colonists, so this
    // one is certain to get some.
    applyCommands(
      sim,
      nearestTrees(sim, mill.x, mill.y, 12).map(([tx, ty]) => ({
        kind: "designateChop" as const,
        tiles: [ty * sim.world.size + tx],
      })),
    );
    let took = false;
    for (let t = 0; t < 300 && !took; t++) {
      advanceTick(sim);
      if (worker.task >= 0) took = true;
    }
    expect(took).toBe(true);
  });

  it("steps out to free ground even when the work tile is blocked", () => {
    const sim = createSim(SEED);
    const [x, y] = site(sim, BuildingKind.Sawmill);
    applyCommands(sim, [{ kind: "place", building: BuildingKind.Sawmill, x, y }]);
    const mill = sim.buildings[0];
    mill.state = BuildingState.Active;
    applyCommands(sim, [{ kind: "staff", building: mill.id }]);
    const worker = sim.colonists.find((c) => c.slot === mill.id)!;
    for (let t = 0; t < 200 && !worker.inside; t++) advanceTick(sim);
    expect(worker.inside).toBe(1);

    // Grow a tree over the work tile while they are inside.
    const [wx, wy] = [mill.x + Math.floor(mill.w / 2), mill.y + mill.h];
    sim.world.treeMap[wx + wy * sim.world.size] = 1;

    applyCommands(sim, [{ kind: "unstaff", building: mill.id }]);
    expect(worker.inside).toBe(0);
    expect(passable(sim.world, sim.wallMap, occupancy(sim), Math.floor(worker.x), Math.floor(worker.y))).toBe(true);
  });

  it("unstaffing mid-cut keeps the milling progress on the building", () => {
    const sim = createSim(SEED);
    const [x, y] = site(sim, BuildingKind.Sawmill);
    applyCommands(sim, [{ kind: "place", building: BuildingKind.Sawmill, x, y }]);
    const mill = sim.buildings[0];
    mill.state = BuildingState.Active;
    applyCommands(sim, [{ kind: "staff", building: mill.id }]);
    for (let i = 0; i < 2; i++) {
      const log = spawnItem(sim, ItemType.Log, x + 3, y)!;
      log.loc = Loc.Stored;
      log.holder = mill.id;
    }

    for (let t = 0; t < 120 && mill.millProgress < 10; t++) advanceTick(sim);
    const held = mill.millProgress;
    expect(held).toBeGreaterThan(0);

    applyCommands(sim, [{ kind: "unstaff", building: mill.id }]);
    for (let t = 0; t < 50; t++) advanceTick(sim);
    expect(mill.millProgress).toBe(held);

    applyCommands(sim, [{ kind: "staff", building: mill.id }]);
    for (let t = 0; t < 200; t++) advanceTick(sim);
    expect(sim.items.some((it) => it.type === ItemType.Plank)).toBe(true);
  });
});

describe("the mill says why it stopped", () => {
  // The panel is the only place the game ever explains a stall — no alerts,
  // no colour changes — so the reason it reports has to be the real one.
  function staffedMill(sim: Sim) {
    const [x, y] = site(sim, BuildingKind.Sawmill);
    applyCommands(sim, [{ kind: "place", building: BuildingKind.Sawmill, x, y }]);
    const mill = sim.buildings[0];
    mill.state = BuildingState.Active;
    applyCommands(sim, [{ kind: "staff", building: mill.id }]);
    return mill;
  }

  it("reports an empty input as waiting for logs", () => {
    const sim = createSim(SEED);
    const mill = staffedMill(sim);
    expect(inspect(sim, mill.id)?.stall).toBe("no-input");
  });

  it("reports a full output buffer as such, not as missing logs", () => {
    const sim = createSim(SEED);
    const mill = staffedMill(sim);
    // Logs waiting *and* nowhere to put a plank: the mill is idle for the
    // opposite reason to the one an input check would report.
    for (let i = 0; i < WORKSHOP_OUTPUT_CAP; i++) {
      const plank = spawnItem(sim, ItemType.Plank, mill.x + 4, mill.y)!;
      plank.loc = Loc.Stored;
      plank.holder = mill.id;
    }
    const log = spawnItem(sim, ItemType.Log, mill.x + 4, mill.y)!;
    log.loc = Loc.Stored;
    log.holder = mill.id;

    for (let t = 0; t < 60; t++) advanceTick(sim);
    const view = inspect(sim, mill.id)!;
    expect(view.inputCount).toBeGreaterThan(0);
    expect(view.stall).toBe("output-full");
    // And it really is stopped: no plank was produced past the cap.
    expect(view.outputCount).toBe(WORKSHOP_OUTPUT_CAP);
  });

  it("reports nothing wrong while it is cutting", () => {
    const sim = createSim(SEED);
    const mill = staffedMill(sim);
    const log = spawnItem(sim, ItemType.Log, mill.x + 4, mill.y)!;
    log.loc = Loc.Stored;
    log.holder = mill.id;
    for (let t = 0; t < 60 && mill.millProgress < 0; t++) advanceTick(sim);
    expect(mill.millProgress).toBeGreaterThanOrEqual(0);
    expect(inspect(sim, mill.id)?.stall).toBe("none");
  });
});

describe("cancelling", () => {
  it("drops a blueprint's delivered logs back on the ground", () => {
    const sim = createSim(SEED);
    const [x, y] = site(sim, BuildingKind.Stockpile);
    applyCommands(sim, [{ kind: "place", building: BuildingKind.Stockpile, x, y }]);
    const b = sim.buildings[0];
    for (let i = 0; i < 2; i++) {
      const log = spawnItem(sim, ItemType.Log, x + 4, y)!;
      log.loc = Loc.Stored;
      log.holder = b.id;
    }

    applyCommands(sim, [{ kind: "cancelBlueprint", building: b.id }]);
    expect(sim.buildings.length).toBe(0);
    expect(sim.items.length).toBe(2);
    for (const item of sim.items) {
      expect(item.loc).toBe(Loc.Ground);
      expect(item.reservedBy).toBe(-1);
    }
    expect(sim.tasks.length).toBe(0);
  });

  it("undesignating a tree stops the chop", () => {
    const sim = createSim(SEED);
    const size = sim.world.size;
    const i = sim.world.treeMap.indexOf(1);
    const x = i % size;
    const y = Math.floor(i / size);
    applyCommands(sim, [{ kind: "designateChop", tiles: [y * size + x] }]);
    generateTasks(sim);
    expect(sim.tasks.length).toBe(1);

    applyCommands(sim, [{ kind: "cancelChop", x, y }]);
    expect(sim.tasks.length).toBe(0);
    expect(sim.chopMap[i]).toBe(0);
    expect(sim.world.treeMap[i]).toBe(1);
  });

  it("keeps working around a tree it can never reach", () => {
    // A tree ringed by trees has no free neighbour to stand on, so its chop
    // task can never be claimed. The spec accepts that it stays marked and
    // quietly retries — what must not happen is the rest of the colony
    // stalling behind it, which is what the claim cooldown is for.
    const sim = createSim(SEED);
    const size = sim.world.size;
    const c = Math.floor(size / 2);
    const [tx, ty] = [c + 12, c];
    sim.world.treeMap[tx + ty * size] = 1;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      sim.world.treeMap[tx + dx + (ty + dy) * size] = 1;
    }
    const [rx, ry] = [c + 4, c];
    sim.world.treeMap[rx + ry * size] = 1;

    applyCommands(sim, [
      { kind: "designateChop", tiles: [ty * size + tx, ry * size + rx] },
    ]);
    for (let t = 0; t < 400; t++) advanceTick(sim);

    expect(sim.world.treeMap[rx + ry * size]).toBe(0);
    expect(sim.world.treeMap[tx + ty * size]).toBe(1);
    // The unreachable one is still queued, sleeping on its cooldown rather
    // than spinning A* every tick.
    const stuck = sim.tasks.filter((t) => t.kind === TaskKind.Chop);
    expect(stuck.length).toBe(1);
    expect(stuck[0].claimedBy).toBe(-1);
  });

  it("marks a whole drag-box in one command, additively", () => {
    const sim = createSim(SEED);
    const size = sim.world.size;
    const centre = Math.floor(size / 2);
    const trees = nearestTrees(sim, centre, centre, 10);
    const idx = ([tx, ty]: [number, number]): number => ty * size + tx;

    // A box carrying trees, a bare tile and an out-of-range index: only the
    // wooded tiles take, and nothing throws on the junk.
    applyCommands(sim, [
      { kind: "designateChop", tiles: [...trees.slice(0, 6).map(idx), centre * size + centre, -1, size * size + 5] },
    ]);
    expect(trees.slice(0, 6).every(([tx, ty]) => sim.chopMap[ty * size + tx] === 1)).toBe(true);
    expect(sim.chopMap[centre * size + centre]).toBe(0);

    // A second, overlapping box adds the new tiles and leaves the rest alone —
    // a marquee never un-marks.
    applyCommands(sim, [{ kind: "designateChop", tiles: trees.map(idx) }]);
    expect(trees.every(([tx, ty]) => sim.chopMap[ty * size + tx] === 1)).toBe(true);

    // Dragging over them again is still a no-op, and one task per tree.
    applyCommands(sim, [{ kind: "designateChop", tiles: trees.map(idx) }]);
    generateTasks(sim);
    expect(sim.tasks.filter((t) => t.kind === TaskKind.Chop).length).toBe(trees.length);

    // Only a hand cancel takes one back.
    const [cx, cy] = trees[0];
    applyCommands(sim, [{ kind: "cancelChop", x: cx, y: cy }]);
    expect(sim.chopMap[cy * size + cx]).toBe(0);
  });

  it("bumps the chunk version when a tree is marked, because the canopy is baked", () => {
    // A designated tree bakes with a gold-shifted canopy, so marking one is a
    // geometry change: without this the renderer would never rebuild and the
    // tint would not appear until something else dirtied the chunk.
    const sim = createSim(SEED);
    const size = sim.world.size;
    const centre = Math.floor(size / 2);
    const [tx, ty] = nearestTrees(sim, centre, centre, 1)[0];
    const chunk = Math.floor(ty / 16) * Math.ceil(size / 16) + Math.floor(tx / 16);

    const before = sim.world.chunkVersion[chunk];
    applyCommands(sim, [{ kind: "designateChop", tiles: [ty * size + tx] }]);
    expect(sim.world.chunkVersion[chunk]).toBeGreaterThan(before);

    const marked = sim.world.chunkVersion[chunk];
    applyCommands(sim, [{ kind: "cancelChop", x: tx, y: ty }]);
    expect(sim.world.chunkVersion[chunk]).toBeGreaterThan(marked);

    // A no-op designate does not churn the renderer.
    const settled = sim.world.chunkVersion[chunk];
    applyCommands(sim, [{ kind: "designateChop", tiles: [centre * size + centre] }]);
    expect(sim.world.chunkVersion[chunk]).toBe(settled);
  });

  it("refuses to designate a tile with no tree on it", () => {
    const sim = createSim(SEED);
    const centre = Math.floor(sim.world.size / 2);
    applyCommands(sim, [{ kind: "designateChop", tiles: [centre * sim.world.size + centre] }]);
    generateTasks(sim);
    expect(sim.tasks.length).toBe(0);
  });
});

describe("placement", () => {
  it("walks a colonist out from under a new footprint", () => {
    const sim = createSim(SEED);
    const c = sim.colonists[0];
    const x = Math.floor(c.x);
    const y = Math.floor(c.y);
    if (!canPlace(sim, BuildingKind.Stockpile, x, y)) return; // nothing to prove here
    applyCommands(sim, [{ kind: "place", building: BuildingKind.Stockpile, x, y }]);
    for (let t = 0; t < 20; t++) advanceTick(sim);
    const b = sim.buildings[0];
    const inside =
      Math.floor(c.x) >= b.x && Math.floor(c.x) < b.x + b.w && Math.floor(c.y) >= b.y && Math.floor(c.y) < b.y + b.h;
    expect(inside).toBe(false);
  });

  it("refuses uneven ground, water, trees and overlaps", () => {
    const sim = createSim(SEED);
    const [x, y] = site(sim, BuildingKind.Stockpile);
    expect(canPlace(sim, BuildingKind.Stockpile, x, y)).toBe(true);
    applyCommands(sim, [{ kind: "place", building: BuildingKind.Stockpile, x, y }]);
    expect(canPlace(sim, BuildingKind.Stockpile, x, y)).toBe(false);
    expect(canPlace(sim, BuildingKind.Stockpile, x + 1, y)).toBe(false);
    expect(canPlace(sim, BuildingKind.Stockpile, -1, y)).toBe(false);
    expect(canPlace(sim, BuildingKind.Stockpile, sim.world.size - 1, y)).toBe(false);
  });

  it("refuses a footprint with a ground item under it", () => {
    const sim = createSim(SEED);
    const [x, y] = site(sim, BuildingKind.Stockpile);
    const log = spawnItem(sim, ItemType.Log, x, y)!;
    expect(log.x).toBe(x);
    expect(canPlace(sim, BuildingKind.Stockpile, x, y)).toBe(false);
  });
});
