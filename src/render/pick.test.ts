import { describe, expect, it } from "vitest";
import { WallState } from "../sim/know";
import { createSim } from "../sim/store";
import { Terrain } from "../sim/world/world";
import { tileIndex } from "../sim/world/world";
import {
  levelTilesInRect,
  rockTilesInRect,
  treeTilesInRect,
  wallRun,
  wallTilesInRect,
} from "./pick";

/**
 * The selection blocks below take no camera and no canvas, and that absence is
 * the point: the drag box is two picked tiles scanned between, so what it takes
 * cannot depend on where the player is standing or on what the terrain happens
 * to be hiding. That retires the limitation
 * `docs/changelog/2026-09-01-drag-box-designation.md` and
 * `docs/changelog/2026-09-02-wall-l-drags.md` both closed by noting — that
 * nothing tested selection against a rotated or tilted camera — rather than
 * leaving it untested: there is no longer a camera to test against.
 */

/** A box over the whole map, which is the widest thing a drag can ask for. */
const WHOLE = (size: number): [[number, number], [number, number]] => [
  [0, 0],
  [size - 1, size - 1],
];

describe("wallRun", () => {
  const SIZE = 256;

  it("turns a corner: leg one along the dominant axis, leg two perpendicular", () => {
    // The corner tile belongs to leg one and is not repeated.
    expect(wallRun([5, 5], [8, 7], SIZE)).toEqual([
      [5, 5], [6, 5], [7, 5], [8, 5],
      [8, 6], [8, 7],
    ]);
    expect(wallRun([5, 5], [6, 8], SIZE)).toEqual([
      [5, 5], [5, 6], [5, 7], [5, 8],
      [6, 8],
    ]);
  });

  it("stays a straight run when the cursor is on the dominant axis", () => {
    // The degenerate L — an empty second leg — which is why nothing about a
    // straight drag changed when the gesture grew a corner.
    expect(wallRun([5, 5], [8, 5], SIZE)).toEqual([[5, 5], [6, 5], [7, 5], [8, 5]]);
    expect(wallRun([5, 5], [5, 8], SIZE)).toEqual([[5, 5], [5, 6], [5, 7], [5, 8]]);
  });

  it("turns in every direction, forwards and backwards", () => {
    expect(wallRun([5, 5], [3, 5], SIZE)).toEqual([[5, 5], [4, 5], [3, 5]]);
    expect(wallRun([5, 5], [5, 3], SIZE)).toEqual([[5, 5], [5, 4], [5, 3]]);
    expect(wallRun([5, 5], [2, 3], SIZE)).toEqual([
      [5, 5], [4, 5], [3, 5], [2, 5],
      [2, 4], [2, 3],
    ]);
    expect(wallRun([5, 5], [3, 2], SIZE)).toEqual([
      [5, 5], [5, 4], [5, 3], [5, 2],
      [4, 2], [3, 2],
    ]);
  });

  it("breaks a perfect diagonal to horizontal — for the first leg", () => {
    // Pinned rather than left to chance: the axis is re-picked on every move,
    // so the tie has to resolve the same way each time or the preview flickers.
    // The tie decides which leg *leads*; it does not suppress the second one.
    expect(wallRun([5, 5], [7, 7], SIZE)).toEqual([
      [5, 5], [6, 5], [7, 5],
      [7, 6], [7, 7],
    ]);
  });

  it("visits every tile exactly once, however it turns", () => {
    for (const to of [[9, 12], [12, 9], [1, 1], [5, 20], [20, 5], [7, 7]] as const) {
      const tiles = wallRun([7, 9], to, SIZE);
      const keys = tiles.map(([x, y]) => `${x},${y}`);
      expect(new Set(keys).size, `${to}`).toBe(keys.length);
      // And it really is an L: every tile shares a row or a column with the
      // press tile or with the cursor tile.
      for (const [x, y] of tiles) {
        expect(x === 7 || y === 9 || x === to[0] || y === to[1], `${x},${y}`).toBe(true);
      }
    }
  });

  it("places a single segment when the drag never left its tile", () => {
    expect(wallRun([5, 5], [5, 5], SIZE)).toEqual([[5, 5]]);
  });

  it("clamps the far end to the map, and refuses a start off it", () => {
    expect(wallRun([254, 5], [999, 5], SIZE)).toEqual([[254, 5], [255, 5]]);
    expect(wallRun([2, 5], [-99, 5], SIZE)).toEqual([[2, 5], [1, 5], [0, 5]]);
    expect(wallRun([-1, 5], [5, 5], SIZE)).toEqual([]);
    expect(wallRun([5, 256], [5, 5], SIZE)).toEqual([]);
    // Clamping applies to the turn as well as the reach.
    expect(wallRun([254, 1], [999, -99], SIZE)).toEqual([[254, 1], [255, 1], [255, 0]]);
  });
});

describe("wallTilesInRect", () => {
  it("returns only wall tiles, skipping ones already marked", () => {
    const sim = createSim(20260901);
    const size = sim.world.size;
    const centre = Math.floor(size / 2);
    const [a, b] = WHOLE(size);

    expect(wallTilesInRect(sim, a, b)).toEqual([]);

    // A blueprint counts: tearing up a line you just drew is the commonest
    // raze there is.
    sim.wallMap[tileIndex(centre, centre, size)] = WallState.PalisadeBp;
    sim.wallMap[tileIndex(centre + 1, centre, size)] = WallState.Palisade;
    const found = wallTilesInRect(sim, a, b);
    expect(found).toHaveLength(2);

    for (const i of found) sim.razeMap[i] = 1;
    expect(wallTilesInRect(sim, a, b)).toEqual([]);
  });

  // `Picker.tileAt` can name a tile one past the east or south edge — the
  // mesher puts a side face on the plane `x = size` for every border column, so
  // a drag that brushes the island's rim picks `size`. Unclamped,
  // `tileIndex(size, y, size)` is not off the map at all: it is tile
  // `(0, y + 1)`, and the box would have designated a column on the far side.
  it("clamps a corner picked one tile past the map instead of wrapping onto the next row", () => {
    const sim = createSim(20260901);
    const size = sim.world.size;
    // The only wall on the map sits at the start of row 5.
    sim.wallMap[tileIndex(0, 5, size)] = WallState.Palisade;
    // A box over row 4 alone, whose east corner came back one past the edge.
    expect(wallTilesInRect(sim, [0, 4], [size, 4])).toEqual([]);
    // And the south edge, where the wrap would run off the array instead.
    expect(wallTilesInRect(sim, [0, size - 1], [size, size])).toEqual([]);
    // The clamp keeps the edge column itself reachable.
    sim.wallMap[tileIndex(size - 1, 4, size)] = WallState.Palisade;
    expect(wallTilesInRect(sim, [0, 4], [size, 4])).toEqual([tileIndex(size - 1, 4, size)]);
  });

  it("reaches a segment a box drawn only around it still covers", () => {
    const sim = createSim(20260901);
    const size = sim.world.size;
    const centre = Math.floor(size / 2);
    const i = tileIndex(centre, centre, size);
    sim.wallMap[i] = WallState.Palisade;
    expect(wallTilesInRect(sim, [centre, centre], [centre, centre])).toEqual([i]);
    expect(wallTilesInRect(sim, [centre + 1, centre], [centre + 3, centre])).toEqual([]);
  });
});

describe("treeTilesInRect", () => {
  const sim = createSim(20260901);
  const size = sim.world.size;
  const [all, allTo] = WHOLE(size);

  it("returns only wooded tiles, and every tile it returns is wooded", () => {
    const tiles = treeTilesInRect(sim, all, allTo);
    expect(tiles.length).toBeGreaterThan(0);
    for (const i of tiles) expect(sim.world.treeMap[i]).toBe(1);
  });

  it("skips tiles already marked, so a redrag adds nothing", () => {
    const first = treeTilesInRect(sim, all, allTo);
    for (const i of first) sim.chopMap[i] = 1;
    expect(treeTilesInRect(sim, all, allTo)).toEqual([]);
    for (const i of first) sim.chopMap[i] = 0;
  });

  it("takes the same ground whichever corner the drag started from", () => {
    const a: [number, number] = [40, 60];
    const b: [number, number] = [90, 20];
    const box = treeTilesInRect(sim, a, b);
    expect(box.length).toBeGreaterThan(0);
    expect(treeTilesInRect(sim, b, a)).toEqual(box);
    expect(treeTilesInRect(sim, [a[0], b[1]], [b[0], a[1]])).toEqual(box);
  });

  it("selects strictly fewer tiles as the box shrinks, and one tile at most for a drag that stayed put", () => {
    const wide = treeTilesInRect(sim, all, allTo);
    const narrow = treeTilesInRect(sim, [40, 40], [90, 90]);
    expect(narrow.length).toBeLessThan(wide.length);
    // Everything in the small box is also in the big one.
    const inWide = new Set(wide);
    for (const i of narrow) expect(inWide.has(i)).toBe(true);
    // `from === to` is a legal one-tile box, not an empty gesture.
    const one = narrow[0];
    const x = one % size;
    const y = (one - x) / size;
    expect(treeTilesInRect(sim, [x, y], [x, y])).toEqual([one]);
  });

  it("catches trees the terrain hides, because nothing here reads the ground", () => {
    // A ridge thrown up across the middle of the box changes what a camera
    // could see and must change nothing about what the box takes — which is
    // the whole reason the projection pass went.
    const before = treeTilesInRect(sim, [40, 40], [90, 90]);
    const hmap = sim.world.hmap;
    const saved = hmap.slice();
    for (let x = 40; x <= 90; x++) hmap[tileIndex(x, 65, size)] = 8;
    expect(treeTilesInRect(sim, [40, 40], [90, 90])).toEqual(before);
    hmap.set(saved);
  });

  it("returns tile indices that decode back to the tile they name", () => {
    const tiles = treeTilesInRect(sim, [40, 40], [90, 90]);
    expect(tiles.length).toBeGreaterThan(0);
    for (const i of tiles) {
      const x = i % size;
      const y = (i - x) / size;
      expect(tileIndex(x, y, size)).toBe(i);
    }
  });
});

describe("rockTilesInRect", () => {
  it("returns only quarriable outcrops, and skips ones already marked", () => {
    const sim = createSim(20260901);
    const size = sim.world.size;
    const centre = Math.floor(size / 2);
    // A box over the clearing, not over the map: the island has outcrops of its
    // own, and a whole-map box now genuinely reaches all of them.
    const a: [number, number] = [centre - 4, centre - 4];
    const b: [number, number] = [centre + 4, centre + 4];

    // The spawn clearing is grass, so there is nothing to quarry until an
    // outcrop is put there.
    expect(rockTilesInRect(sim, a, b)).toEqual([]);

    for (const [dx, dy] of [
      [0, 0],
      [1, 0],
    ]) {
      const i = tileIndex(centre + dx, centre + dy, size);
      sim.world.tmap[i] = Terrain.Rock;
      sim.world.hmap[i] = 7;
    }
    const found = rockTilesInRect(sim, a, b);
    expect(found).toHaveLength(2);
    // And a box drawn around only the first one takes only the first one.
    expect(rockTilesInRect(sim, [centre, centre], [centre, centre])).toEqual([
      tileIndex(centre, centre, size),
    ]);

    for (const i of found) sim.mineMap[i] = 1;
    expect(rockTilesInRect(sim, a, b)).toEqual([]);
  });
});

describe("levelTilesInRect", () => {
  it("returns eligible ground that is not already at the target", () => {
    const sim = createSim(20260901);
    const size = sim.world.size;
    const centre = Math.floor(size / 2);
    const a: [number, number] = [centre - 4, centre - 4];
    const b: [number, number] = [centre + 4, centre + 4];

    // The clearing is flat at 4, so levelling it *to* 4 is a no-op selection
    // and levelling it to 5 catches the box. Not *every* tile of it: a tile
    // with a ground item on it is not eligible, and the opening provisions are
    // lying in the clearing — which is why this counts what it got rather than
    // asserting the full 9 × 9.
    expect(levelTilesInRect(sim, a, b, 4)).toEqual([]);
    const raise = levelTilesInRect(sim, a, b, 5);
    expect(raise.length).toBeGreaterThan(0);
    expect(raise.length).toBeLessThanOrEqual(9 * 9);
    for (const i of raise) expect(sim.world.hmap[i]).toBe(4);
    // A drag that stayed inside one eligible tile is a legal one-tile box.
    const one = raise[0];
    const ox = one % size;
    expect(levelTilesInRect(sim, [ox, (one - ox) / size], [ox, (one - ox) / size], 5)).toEqual([one]);

    // Rock is never eligible: quarrying is the only way an outcrop comes down.
    const rock = tileIndex(centre, centre, size);
    sim.world.tmap[rock] = Terrain.Rock;
    sim.world.hmap[rock] = 7;
    expect(levelTilesInRect(sim, a, b, 5)).not.toContain(rock);
  });
});
