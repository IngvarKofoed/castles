import { OrthographicCamera, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { WallState } from "../sim/know";
import { createSim } from "../sim/store";
import { Terrain } from "../sim/world/world";
import { tileIndex } from "../sim/world/world";
import {
  levelTilesInRect,
  rectFrom,
  rectSpan,
  rockTilesInRect,
  treeTilesInRect,
  wallRun,
  wallTilesInRect,
} from "./pick";

/** A canvas stub: `treeTilesInRect` only ever asks for the bounding rect. */
function canvasStub(width = 800, height = 600): HTMLCanvasElement {
  return {
    getBoundingClientRect: () => ({ left: 0, top: 0, width, height, right: width, bottom: height }),
  } as unknown as HTMLCanvasElement;
}

/** A camera looking straight down, so screen x/y map monotonically to world x/z. */
function topDownCamera(centre: number, span: number): OrthographicCamera {
  const cam = new OrthographicCamera(-span, span, span, -span, 0.1, 1000);
  cam.position.set(centre, 200, centre);
  cam.up.set(0, 0, -1);
  cam.lookAt(new Vector3(centre, 0, centre));
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return cam;
}

describe("rect helpers", () => {
  it("normalises a drag in any direction", () => {
    expect(rectFrom({ x: 30, y: 40 }, { x: 10, y: 20 })).toEqual({ left: 10, top: 20, right: 30, bottom: 40 });
    expect(rectFrom({ x: 10, y: 20 }, { x: 30, y: 40 })).toEqual({ left: 10, top: 20, right: 30, bottom: 40 });
  });

  it("measures the drag's diagonal, so the click slop is direction-free", () => {
    expect(rectSpan({ left: 0, top: 0, right: 3, bottom: 4 })).toBe(5);
  });
});

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
    const camera = topDownCamera(centre, 40);
    const canvas = canvasStub();
    const all = { left: 0, top: 0, right: 800, bottom: 600 };

    expect(wallTilesInRect(sim, camera, canvas, all)).toEqual([]);

    // A blueprint counts: tearing up a line you just drew is the commonest
    // raze there is.
    sim.wallMap[tileIndex(centre, centre, size)] = WallState.PalisadeBp;
    sim.wallMap[tileIndex(centre + 1, centre, size)] = WallState.Palisade;
    const found = wallTilesInRect(sim, camera, canvas, all);
    expect(found).toHaveLength(2);

    for (const i of found) sim.razeMap[i] = 1;
    expect(wallTilesInRect(sim, camera, canvas, all)).toEqual([]);
  });
});

describe("treeTilesInRect", () => {
  const sim = createSim(20260901);
  const size = sim.world.size;
  const centre = Math.floor(size / 2);
  const camera = topDownCamera(centre, 40);
  const canvas = canvasStub();

  it("returns only wooded tiles, and every tile it returns is wooded", () => {
    const tiles = treeTilesInRect(sim, camera, canvas, { left: 0, top: 0, right: 800, bottom: 600 });
    expect(tiles.length).toBeGreaterThan(0);
    for (const i of tiles) expect(sim.world.treeMap[i]).toBe(1);
  });

  it("skips tiles already marked, so a redrag adds nothing", () => {
    const all = { left: 0, top: 0, right: 800, bottom: 600 };
    const first = treeTilesInRect(sim, camera, canvas, all);
    for (const i of first) sim.chopMap[i] = 1;
    expect(treeTilesInRect(sim, camera, canvas, all)).toEqual([]);
    for (const i of first) sim.chopMap[i] = 0;
  });

  it("selects strictly fewer tiles as the box shrinks, and none for an empty box", () => {
    const wide = treeTilesInRect(sim, camera, canvas, { left: 0, top: 0, right: 800, bottom: 600 });
    const narrow = treeTilesInRect(sim, camera, canvas, { left: 300, top: 200, right: 500, bottom: 400 });
    expect(narrow.length).toBeLessThan(wide.length);
    // Everything in the small box is also in the big one.
    const inWide = new Set(wide);
    for (const i of narrow) expect(inWide.has(i)).toBe(true);
    expect(treeTilesInRect(sim, camera, canvas, { left: 400, top: 300, right: 400, bottom: 300 })).toEqual([]);
  });

  it("returns tile indices that decode back to the tile they name", () => {
    const tiles = treeTilesInRect(sim, camera, canvas, { left: 300, top: 200, right: 500, bottom: 400 });
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
    const camera = topDownCamera(centre, 40);
    const canvas = canvasStub();
    const all = { left: 0, top: 0, right: 800, bottom: 600 };

    // The spawn clearing is grass, so there is nothing to quarry until an
    // outcrop is put there.
    expect(rockTilesInRect(sim, camera, canvas, all)).toEqual([]);

    for (const [dx, dy] of [
      [0, 0],
      [1, 0],
    ]) {
      const i = tileIndex(centre + dx, centre + dy, size);
      sim.world.tmap[i] = Terrain.Rock;
      sim.world.hmap[i] = 7;
    }
    const found = rockTilesInRect(sim, camera, canvas, all);
    expect(found).toHaveLength(2);

    for (const i of found) sim.mineMap[i] = 1;
    expect(rockTilesInRect(sim, camera, canvas, all)).toEqual([]);
  });
});

describe("levelTilesInRect", () => {
  it("returns eligible ground that is not already at the target", () => {
    const sim = createSim(20260901);
    const size = sim.world.size;
    const centre = Math.floor(size / 2);
    const camera = topDownCamera(centre, 8);
    const canvas = canvasStub();
    const all = { left: 0, top: 0, right: 800, bottom: 600 };

    // The clearing is flat at 4, so levelling it *to* 4 is a no-op selection
    // and levelling it to 5 catches every tile in the box.
    expect(levelTilesInRect(sim, camera, canvas, all, 4)).toEqual([]);
    const raise = levelTilesInRect(sim, camera, canvas, all, 5);
    expect(raise.length).toBeGreaterThan(0);
    for (const i of raise) expect(sim.world.hmap[i]).toBe(4);

    // Rock is never eligible: quarrying is the only way an outcrop comes down.
    const rock = tileIndex(centre, centre, size);
    sim.world.tmap[rock] = Terrain.Rock;
    sim.world.hmap[rock] = 7;
    expect(levelTilesInRect(sim, camera, canvas, all, 5)).not.toContain(rock);
  });
});
