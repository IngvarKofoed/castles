import { Raycaster, Vector2, Vector3, type Camera, type Object3D } from "three";
import { chopLayer, treeLayer, type Sim } from "../sim/know";
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
  const bounds = canvas.getBoundingClientRect();
  const world = sim.world;
  const trees = treeLayer(sim);
  const marked = chopLayer(sim);
  const size = world.size;
  const out: number[] = [];

  for (let i = 0; i < trees.length; i++) {
    if (!trees[i] || marked[i]) continue;
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
