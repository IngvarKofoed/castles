import { OrthographicCamera, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { createSim } from "../sim/store";
import { tileIndex } from "../sim/world/world";
import { rectFrom, rectSpan, treeTilesInRect } from "./pick";

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
