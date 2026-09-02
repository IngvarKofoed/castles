import type { Command } from "../../commands";
import { canPlaceWall } from "../../walls";
import { tileIndex } from "../../world/world";
import { createSim, type Sim } from "../../store";
import { advanceTick } from "../../tick";

/**
 * How each committed `.castles` fixture was made.
 *
 * The recipes live here rather than inside `fixture.test.ts` because two
 * things need them and must not drift apart: the one-off generator that wrote
 * each file, and the shape test that re-runs the same recipe against the
 * *current* build to see whether the store has grown a field since. A fixture
 * whose recipe nobody kept is a fixture nobody can re-derive.
 *
 * The recipes themselves are frozen for the same reason the files are: editing
 * one silently changes what the shape test compares against.
 */

export const FIXTURE_SEED = 20260901;

/** v1: twelve trees marked, a stockpile placed. 400 ticks. */
export const V1_TICKS = 400;

export function v1Script(sim: Sim): Command[] {
  if (sim.tick === 0) return [{ kind: "designateChop", tiles: nearestTrees(sim, 12) }];
  if (sim.tick === 5) return [{ kind: "place", building: 0, x: 128, y: 128 }];
  return [];
}

/**
 * v2: the same opening, then a closed 3×3 ring — seven palisade segments and
 * one gate — so the file carries a genuinely enclosed tile rather than an
 * all-zero `insideMap`; then, right at the end, a fresh run and a dismantle
 * mark, so it also carries blueprints, live build-wall tasks with their logs
 * reserved, and a raze designation nobody has got to yet.
 *
 * The late commands are timed to *not* resolve: the run is drawn ten ticks
 * from the end and the raze mark five, which is what leaves work in flight in
 * the file. And the raze mark lands on a ring segment, which is safe precisely
 * because nobody finishes tearing it down — the ring is still closed at the
 * tick the save was taken.
 *
 * Every site is derived from the store, never hard-coded — but derived from
 * the **wall layer** once walls exist, not by re-searching for placeable
 * ground: `canPlaceWall` refuses a tile that already holds a wall, so a second
 * search would silently wander off to somewhere else on the map.
 */
export const V2_TICKS = 1000;

export function v2Script(sim: Sim): Command[] {
  if (sim.tick === 0) return [{ kind: "designateChop", tiles: nearestTrees(sim, 40) }];
  if (sim.tick === 5) return [{ kind: "place", building: 0, x: 128, y: 128 }];
  if (sim.tick === 200) {
    const ring = ringSite(sim);
    if (!ring.length) return [];
    // One tile of the ring is the gate. A ring with a gate still encloses —
    // pathing walks through it, the flood-fill does not.
    return [
      { kind: "placeWall", tiles: ring.slice(1) },
      { kind: "placeGate", tiles: [ring[0]] },
    ];
  }
  if (sim.tick === 990) {
    const run = wallSite(sim, 5);
    return run.length ? [{ kind: "placeWall", tiles: run }] : [];
  }
  if (sim.tick === 995) {
    const built = sim.wallMap.indexOf(2 /* WallState.Palisade */);
    return built >= 0 ? [{ kind: "designateRaze", tiles: [built] }] : [];
  }
  return [];
}

/** Rebuild a fixture's colony with whatever the store looks like today. */
export function replay(script: (sim: Sim) => Command[], ticks: number): Sim {
  const sim = createSim(FIXTURE_SEED);
  for (let t = 0; t < ticks; t++) advanceTick(sim, script(sim));
  return sim;
}

/** Tree tiles nearest the map centre, by growing rings, as tile indices. */
export function nearestTrees(sim: Sim, count: number): number[] {
  const size = sim.world.size;
  const centre = Math.floor(size / 2);
  const out: number[] = [];
  for (let r = 1; r < size && out.length < count; r++) {
    for (let dy = -r; dy <= r && out.length < count; dy++) {
      for (let dx = -r; dx <= r && out.length < count; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const i = tileIndex(centre + dx, centre + dy, size);
        if (sim.world.treeMap[i]) out.push(i);
      }
    }
  }
  return out;
}

/**
 * The eight perimeter tiles of the first 3×3 block whose whole outline takes a
 * wall — the cheapest closed ring there is, enclosing exactly one tile, which
 * is all a fixture needs to carry a non-empty `insideMap`.
 */
export function ringSite(sim: Sim): number[] {
  const size = sim.world.size;
  const centre = Math.floor(size / 2);
  const outline: [number, number][] = [
    [0, 0],
    [1, 0],
    [2, 0],
    [2, 1],
    [2, 2],
    [1, 2],
    [0, 2],
    [0, 1],
  ];
  for (let r = 3; r < 40; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x0 = centre + dx;
        const y0 = centre + dy;
        if (outline.every(([ox, oy]) => canPlaceWall(sim, x0 + ox, y0 + oy))) {
          return outline.map(([ox, oy]) => tileIndex(x0 + ox, y0 + oy, size));
        }
      }
    }
  }
  return [];
}

/**
 * The first horizontal run of `length` tiles that all take a wall, searched
 * outward from the centre in growing rings so the answer is a pure function of
 * the store — which is what makes the recipe replayable.
 */
export function wallSite(sim: Sim, length: number): number[] {
  const size = sim.world.size;
  const centre = Math.floor(size / 2);
  for (let r = 2; r < 40; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const y = centre + dy;
        const x0 = centre + dx;
        let ok = true;
        for (let k = 0; k < length && ok; k++) ok = canPlaceWall(sim, x0 + k, y);
        if (ok) {
          const out: number[] = [];
          for (let k = 0; k < length; k++) out.push(tileIndex(x0 + k, y, size));
          return out;
        }
      }
    }
  }
  return [];
}
