import { Raycaster, Vector2, Vector3, type Camera, type Object3D } from "three";
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
import { BH } from "./props";

/** A screen-space rectangle in client coordinates. */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function rectFrom(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return {
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    right: Math.max(a.x, b.x),
    bottom: Math.max(a.y, b.y),
  };
}

export function rectSpan(r: Rect): number {
  return Math.hypot(r.right - r.left, r.bottom - r.top);
}

const PROJECT = new Vector3();

/**
 * Every tree tile whose base projects inside a screen rectangle, as tile
 * indices, already-marked tiles excluded.
 *
 * The tree's *base* is the test point, not its crown: the base is where the
 * tile actually is and where its designation diamond gets drawn, so what the
 * box selects matches what then lights up. A tall pine leaning into the box
 * from just outside it is therefore not caught — the right call, since the
 * player is selecting ground.
 *
 * Projects every wooded tile rather than unprojecting the box onto the ground
 * plane: it is one pass on pointer-release over an array the renderer already
 * has, and it stays correct over uneven terrain, which a flat-plane
 * unprojection would not.
 */
export function treeTilesInRect(sim: Sim, camera: Camera, canvas: HTMLCanvasElement, rect: Rect): number[] {
  const trees = treeLayer(sim);
  const marked = chopLayer(sim);
  return tilesInRect(sim, camera, canvas, rect, (i) => trees[i] === 1 && !marked[i]);
}

/**
 * Every wall segment whose tile projects inside a screen rectangle, already
 * raze-marked tiles excluded — the chop marquee's selection rule, applied to
 * the dismantle tool. Blueprints are included: tearing up a line you have just
 * drawn is the commonest raze there is.
 */
export function wallTilesInRect(sim: Sim, camera: Camera, canvas: HTMLCanvasElement, rect: Rect): number[] {
  const walls = wallLayer(sim);
  const marked = razeLayer(sim);
  return tilesInRect(sim, camera, canvas, rect, (i) => walls[i] !== WallState.None && !marked[i]);
}

/**
 * Every quarriable outcrop inside a screen rectangle, already-marked tiles
 * excluded — the chop marquee's rule again. `canMine` is what refuses a sea
 * stack here, so the box simply does not select what could never be worked.
 */
export function rockTilesInRect(sim: Sim, camera: Camera, canvas: HTMLCanvasElement, rect: Rect): number[] {
  const marked = mineLayer(sim);
  const size = sim.world.size;
  return tilesInRect(sim, camera, canvas, rect, (i) => {
    if (marked[i]) return false;
    const x = i % size;
    return canMine(sim, x, (i - x) / size);
  });
}

/**
 * Every tile inside a screen rectangle that could be levelled to `target` —
 * eligible ground (`canTerraform`) that is not already at that height. Tiles
 * carrying a *different* stored target are included on purpose: re-dragging is
 * how a mis-pressed area is fixed, so the second drag has to be able to reach
 * tiles the first one marked.
 */
export function levelTilesInRect(
  sim: Sim,
  camera: Camera,
  canvas: HTMLCanvasElement,
  rect: Rect,
  target: number,
): number[] {
  const size = sim.world.size;
  return tilesInRect(sim, camera, canvas, rect, (i) => {
    const x = i % size;
    const y = (i - x) / size;
    return groundHeight(sim, x, y) !== target && canTerraform(sim, x, y);
  });
}

function tilesInRect(
  sim: Sim,
  camera: Camera,
  canvas: HTMLCanvasElement,
  rect: Rect,
  include: (i: number) => boolean,
): number[] {
  const bounds = canvas.getBoundingClientRect();
  const world = sim.world;
  const size = world.size;
  const out: number[] = [];

  for (let i = 0; i < size * size; i++) {
    if (!include(i)) continue;
    const x = i % size;
    const y = (i - x) / size;
    PROJECT.set(x + 0.5, world.hmap[i] * BH, y + 0.5).project(camera);
    // Behind the camera: project() wraps such points to the far side of the
    // frustum, where they would read as inside any box near that edge.
    if (PROJECT.z > 1) continue;
    const sx = bounds.left + ((PROJECT.x + 1) / 2) * bounds.width;
    const sy = bounds.top + ((1 - PROJECT.y) / 2) * bounds.height;
    if (sx < rect.left || sx > rect.right || sy < rect.top || sy > rect.bottom) continue;
    out.push(tileIndex(x, y, size));
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
