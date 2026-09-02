import { describe, expect, it } from "vitest";
import { WallState } from "../sim/know";
import { hash } from "../sim/world/noise";
import { BH, WallLink, wallBoxes, type Box } from "./props";

/**
 * A straight palisade run must come out of the corner-aware rewrite looking
 * exactly as it did before it, because a straight run is most of every wall
 * and "essentially unchanged" is not something a screenshot can settle at four
 * pixels per stake.
 *
 * So the geometry below is the **pre-rewrite formula written out** — stakes at
 * ±0.32 along the run and one at the centre, 0.19 square, height
 * `WALL_TOP·(0.88 + j·0.24)` keyed on `(3tx+s+1, 3ty+s+1)`; two rails spanning
 * the whole tile at 0.4 and 0.76 of the height, 0.11 across and 0.14·BH deep.
 * If a future change to `wallBoxes` moves any of it, this fails and the change
 * has to say why a straight run should look different.
 *
 * One thing genuinely did change and is asserted as such: a rail is now two
 * overlapping arm halves rather than one full-tile box. Their union is the same
 * member, so the silhouette is identical; the surplus faces are enclosed inside
 * the solid and never drawn.
 */

const SEED = 7;
const WALL_TOP = 2.2 * BH;
const WALL_SALT = 0xc2b2ae35;

const stakeHeight = (tx: number, ty: number, s: number): number =>
  WALL_TOP * (0.88 + hash(tx * 3 + s + 1, ty * 3 + s + 1, SEED ^ WALL_SALT) * 0.24);

function run(tx: number, ty: number, links: number): Box[] {
  const out: Box[] = [];
  wallBoxes(tx, ty, 3, SEED, out, WallState.Palisade, links);
  return out;
}

/** Boxes that are stakes (tall and square) versus rails (thin and long). */
const stakes = (boxes: Box[]): Box[] => boxes.filter((b) => b.sx === 0.19 && b.sz === 0.19);
const rails = (boxes: Box[]): Box[] => boxes.filter((b) => b.sy === 0.14 * BH);

describe("a straight palisade run is unchanged by corner awareness", () => {
  const cases = [
    { name: "east-west", links: WallLink.West | WallLink.East, dx: 1, dz: 0 },
    { name: "north-south", links: WallLink.North | WallLink.South, dx: 0, dz: 1 },
    // A lone segment borrows the east-west pair, exactly as it used to.
    { name: "lone", links: 0, dx: 1, dz: 0 },
  ] as const;

  for (const { name, links, dx, dz } of cases) {
    describe(name, () => {
      const tx = 5;
      const ty = 9;
      const boxes = run(tx, ty, links);
      const ground = 3 * BH;
      const cx = tx + 0.5;
      const cz = ty + 0.5;

      it("stands three stakes, at the same places and the same heights", () => {
        const got = stakes(boxes)
          .map((b) => ({
            x: +(b.x - cx).toFixed(6),
            z: +(b.z - cz).toFixed(6),
            h: +b.sy.toFixed(6),
            base: +(b.y - b.sy / 2).toFixed(6),
          }))
          .sort((a, b) => a.x - b.x || a.z - b.z);

        // s = −1 is the west/north stake, 0 the centre, +1 the east/south one:
        // the pairing that keeps both straight orientations identical.
        const want = [-1, 0, 1]
          .map((s) => ({
            x: +(dx * s * 0.32).toFixed(6),
            z: +(dz * s * 0.32).toFixed(6),
            h: +stakeHeight(tx, ty, s).toFixed(6),
            base: +ground.toFixed(6),
          }))
          .sort((a, b) => a.x - b.x || a.z - b.z);

        expect(got).toEqual(want);
      });

      it("ties them with two rails spanning the whole tile at the old heights", () => {
        const band = rails(boxes);
        expect(band).toHaveLength(4); // two heights × two arm halves

        for (const fy of [0.4, 0.76]) {
          const atHeight = band.filter((b) => Math.abs(b.y - b.sy / 2 - (ground + fy * WALL_TOP)) < 1e-9);
          expect(atHeight, `rails at ${fy}`).toHaveLength(2);

          // The union of the halves is the same full-tile member as before.
          const along = (b: Box): [number, number] =>
            dx !== 0 ? [b.x - b.sx / 2, b.x + b.sx / 2] : [b.z - b.sz / 2, b.z + b.sz / 2];
          const lo = Math.min(...atHeight.map((b) => along(b)[0]));
          const hi = Math.max(...atHeight.map((b) => along(b)[1]));
          expect(lo).toBeCloseTo(dx !== 0 ? tx : ty, 9);
          expect(hi).toBeCloseTo((dx !== 0 ? tx : ty) + 1, 9);

          // And they really do overlap, rather than meeting on the centre line
          // where a hairline of daylight would show at a corner.
          const inner = atHeight.map((b) => along(b)).sort((a, b) => a[0] - b[0]);
          expect(inner[0][1]).toBeGreaterThan(inner[1][0]);

          for (const b of atHeight) {
            expect(dx !== 0 ? b.sz : b.sx).toBeCloseTo(0.11, 9);
            expect(b.shade).toBe(0.9);
            // Both halves wobble as one member, anchored to the tile centre.
            expect(b.jx).toBeCloseTo(cx, 9);
            expect(b.jz).toBeCloseTo(cz, 9);
          }
        }
      });

      it("emits nothing else", () => {
        expect(boxes).toHaveLength(stakes(boxes).length + rails(boxes).length);
      });
    });
  }
});

describe("junction arms", () => {
  it("gives a corner one arm per linked side, and no more", () => {
    const corner = run(5, 9, WallLink.West | WallLink.South);
    // Centre stake plus one per arm; two rails per arm.
    expect(stakes(corner)).toHaveLength(3);
    expect(rails(corner)).toHaveLength(4);
  });

  it("scales to a T and a cross", () => {
    const t = run(5, 9, WallLink.West | WallLink.East | WallLink.South);
    expect(stakes(t)).toHaveLength(4);
    expect(rails(t)).toHaveLength(6);

    const cross = run(5, 9, WallLink.West | WallLink.East | WallLink.North | WallLink.South);
    expect(stakes(cross)).toHaveLength(5);
    expect(rails(cross)).toHaveLength(8);
  });

  it("puts a corner's stakes along its own arms, not across the turn", () => {
    // The defect in one assertion: the old code chose east-west for this tile,
    // so its stakes marched across the southward run instead of down it.
    const corner = run(5, 9, WallLink.West | WallLink.South);
    const offsets = stakes(corner)
      .map((b) => [+(b.x - 5.5).toFixed(2), +(b.z - 9.5).toFixed(2)])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    expect(offsets).toEqual([
      [-0.32, 0],
      [0, 0],
      [0, 0.32],
    ]);
  });
});
