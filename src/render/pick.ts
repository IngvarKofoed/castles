import { Raycaster, Vector2, type Camera, type Object3D } from "three";
import {
  WallState,
  canMine,
  canTerraform,
  chopLayer,
  groundHeight,
  mineLayer,
  razeLayer,
  treeLayer,
  wallLayer,
  type Sim,
} from "../sim/know";
import { tileIndex } from "../sim/world/world";

/**
 * The two corners an area tool's drag box is held between — both picked off
 * the terrain, so the box is a patch of ground rather than a patch of screen.
 * Inclusive at both ends, and in either order: a drag up-left is the same box
 * as the drag down-right that covers it.
 */
export interface SelectionBox {
  readonly from: readonly [number, number];
  readonly to: readonly [number, number];
}

/**
 * A box's tile bounds, ordered and **clamped to the map**.
 *
 * The clamp is load-bearing, not defensive. `Picker.tileAt` can name a tile one
 * past the east or south edge: the mesher emits a side face at the plane
 * `x = size` (and `y = size`) for every border column, because `heightAt` reads
 * off-map as height 0, and a hit on that face floors to `size`. Left unclamped
 * that is not a harmlessly off-map tile — `tileIndex(size, y, size)` is tile
 * `(0, y + 1)`, so a box brushing the island's rim would designate a column on
 * the far side of the map from the one it drew. `wallRun` guards the same pick
 * the same way, and the projection pass this replaced was immune only because
 * it never used the corners as indices.
 *
 * Shared with the renderer so the box that draws and the box that selects
 * cannot disagree about where the map stops.
 */
export function boxBounds(
  from: readonly [number, number],
  to: readonly [number, number],
  size: number,
): { x0: number; x1: number; y0: number; y1: number } {
  const clamp = (v: number): number => Math.max(0, Math.min(size - 1, v));
  return {
    x0: clamp(Math.min(from[0], to[0])),
    x1: clamp(Math.max(from[0], to[0])),
    y0: clamp(Math.min(from[1], to[1])),
    y1: clamp(Math.max(from[1], to[1])),
  };
}

/**
 * Every unmarked tree tile inside the drag box, as tile indices.
 *
 * The box is a *tile* rectangle scanned between its two corners, not a screen
 * rectangle every candidate tile is projected into: the ground it covers is
 * the ground it takes, at any camera angle, and a tree standing behind a ridge
 * is caught by a box drawn over it rather than escaping because the crest hid
 * it. Reverses `docs/changelog/2026-09-01-drag-box-designation.md`, whose
 * objection — that unprojection cannot stay correct over uneven terrain — was
 * aimed at unprojecting onto a flat ground plane and does not apply to corners
 * raycast against the real mesh.
 */
export function treeTilesInRect(sim: Sim, from: readonly [number, number], to: readonly [number, number]): number[] {
  const trees = treeLayer(sim);
  const marked = chopLayer(sim);
  return tilesInRect(sim, from, to, (i) => trees[i] === 1 && !marked[i]);
}

/**
 * Every wall segment inside the drag box, already raze-marked tiles excluded —
 * the chop box's selection rule, applied to the dismantle tool. Blueprints are
 * included: tearing up a line you have just drawn is the commonest raze there
 * is.
 */
export function wallTilesInRect(sim: Sim, from: readonly [number, number], to: readonly [number, number]): number[] {
  const walls = wallLayer(sim);
  const marked = razeLayer(sim);
  return tilesInRect(sim, from, to, (i) => walls[i] !== WallState.None && !marked[i]);
}

/**
 * Every quarriable outcrop inside the drag box, already-marked tiles excluded
 * — the chop box's rule again. `canMine` is what refuses a sea stack here, so
 * the box simply does not select what could never be worked.
 */
export function rockTilesInRect(sim: Sim, from: readonly [number, number], to: readonly [number, number]): number[] {
  const marked = mineLayer(sim);
  return tilesInRect(sim, from, to, (i, x, y) => !marked[i] && canMine(sim, x, y));
}

/**
 * Every tile inside the drag box that could be levelled to `target` — eligible
 * ground (`canTerraform`) that is not already at that height. Tiles carrying a
 * *different* stored target are included on purpose: re-dragging is how a
 * mis-pressed area is fixed, so the second drag has to be able to reach tiles
 * the first one marked.
 */
export function levelTilesInRect(
  sim: Sim,
  from: readonly [number, number],
  to: readonly [number, number],
  target: number,
): number[] {
  return tilesInRect(
    sim,
    from,
    to,
    (_i, x, y) => groundHeight(sim, x, y) !== target && canTerraform(sim, x, y),
  );
}

/**
 * The scan itself: every tile between the two corners, in row order, kept by
 * the caller's predicate.
 *
 * Both corners are clamped to the map by `boxBounds` — a pick can land one
 * tile past the east or south edge, and an unclamped `tileIndex` there wraps
 * onto the next row rather than falling off the array.
 *
 * The cost runs the right way round compared with the projection pass this
 * replaces: that one tested every tile in the world however small the box, and
 * projected each accepted one. This is `w × h` predicate tests and no
 * projection at all, on pointer-release only — so a small box is cheap and a
 * map-wide one is the same order as the scan terraforming already runs.
 */
function tilesInRect(
  sim: Sim,
  from: readonly [number, number],
  to: readonly [number, number],
  include: (i: number, x: number, y: number) => boolean,
): number[] {
  const size = sim.world.size;
  const { x0, x1, y0, y1 } = boxBounds(from, to, size);
  const out: number[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = tileIndex(x, y, size);
      if (include(i, x, y)) out.push(i);
    }
  }
  return out;
}

/**
 * The tiles a wall drag covers: an **L** of two axis-aligned legs.
 *
 * Leg one runs along the dominant axis from the press tile to the cursor's
 * extent on that axis; leg two runs perpendicular from that corner tile to the
 * cursor tile. A cursor sitting on the dominant axis leaves the second leg
 * empty, which is why a plain straight run is simply the degenerate case and
 * nothing about it changed when this grew a corner.
 *
 * The corner tile belongs to leg one and is never repeated — leg two starts one
 * step past it — so the caller gets each tile once and can hand the whole thing
 * to a single place-wall command.
 *
 * The edge rules, pinned because they are all reachable in the hand: a press
 * that never left its tile is one segment, a perfect diagonal breaks to
 * horizontal **for the first leg** (the tie decides which leg leads, not
 * whether there is a second one), the far end clamps to the map, a drag that
 * starts off-map is empty, and the axis is re-evaluated on every move — so the
 * L may flip which way it turns while the drag is held.
 */
export function wallRun(
  from: readonly [number, number],
  to: readonly [number, number],
  size: number,
): [number, number][] {
  const [ax, ay] = from;
  if (ax < 0 || ay < 0 || ax >= size || ay >= size) return [];
  const bx = Math.max(0, Math.min(size - 1, to[0]));
  const by = Math.max(0, Math.min(size - 1, to[1]));
  const out: [number, number][] = [];
  const xStep = bx >= ax ? 1 : -1;
  const yStep = by >= ay ? 1 : -1;

  if (Math.abs(bx - ax) >= Math.abs(by - ay)) {
    for (let x = ax; ; x += xStep) {
      out.push([x, ay]);
      if (x === bx) break;
    }
    for (let y = ay; y !== by; ) {
      y += yStep;
      out.push([bx, y]);
    }
  } else {
    for (let y = ay; ; y += yStep) {
      out.push([ax, y]);
      if (y === by) break;
    }
    for (let x = ax; x !== bx; ) {
      x += xStep;
      out.push([x, by]);
    }
  }
  return out;
}

/**
 * Turn a pointer position into a tile.
 *
 * Chunk vertices are baked in *world* coordinates and chunk meshes sit at the
 * origin, so a hit point converts to a tile by flooring — no instance-id
 * bookkeeping, no parallel tile arrays. That is the whole reason the bootstrap
 * step merged chunk geometry instead of instancing it per tile.
 */
export class Picker {
  private readonly ray = new Raycaster();
  private readonly ndc = new Vector2();

  constructor(private readonly canvas: HTMLCanvasElement) {}

  /** The tile under a client-space pointer position, or null over the void. */
  tileAt(event: { clientX: number; clientY: number }, camera: Camera, targets: Object3D[]): [number, number] | null {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set(
      ((event.clientX - r.left) / r.width) * 2 - 1,
      -((event.clientY - r.top) / r.height) * 2 + 1,
    );
    this.ray.setFromCamera(this.ndc, camera);
    const hits = this.ray.intersectObjects(targets, false);
    if (!hits.length) return null;
    const p = hits[0].point;
    // Nudge inward along the ray so a hit exactly on a tile seam rounds to the
    // face that was actually clicked rather than its neighbour.
    return [Math.floor(p.x + 1e-4), Math.floor(p.z + 1e-4)];
  }
}
