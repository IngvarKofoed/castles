import { hash } from "../sim/world/noise";
import { BuildingKind, BuildingState, type Building } from "../sim/know";
import { OVERLAY, PROP, PROP_JITTER, lerpHex } from "./palette";

/**
 * The voxel props baked into chunk geometry: trees and buildings.
 *
 * Both are *static world content* — a tree stands until it is chopped, a
 * building changes shape three times in its life — so they belong in the
 * chunk mesh next to terrain rather than in a second per-frame instanced
 * path. A change bumps `chunkVersion` and one chunk rebuilds
 * (docs/changelog/2026-09-01-dirty-chunk-neighbours.md).
 *
 * Models are ported from `mockups/mockup3d.html`: a prop is a box at
 * (x, groundY + height/2, z) sized (sx, height, sz), optionally spun about y.
 * Decorative props take a rotation; buildings never do, so the grid still
 * reads — the mockup's own rule.
 */

export interface Box {
  /** Centre in world units. */
  x: number;
  y: number;
  z: number;
  /** Full extents. */
  sx: number;
  sy: number;
  sz: number;
  /** Rotation about +y, radians. */
  rot: number;
  color: number;
  /** Multiplies the colour — cheap shading between a prop's own parts. */
  shade: number;
}

const TREE_SALT = 0x1b873593;

function box(x: number, base: number, z: number, sx: number, sy: number, sz: number, color: number, rot = 0, shade = 1): Box {
  return { x, y: base + sy / 2, z, sx, sy, sz, rot, color, shade };
}

/** Block height in world units — one voxel step. Shared with the mesher. */
export const BH = 0.5;

/**
 * How far a designated tree's canopy shifts toward the gold accent. Enough to
 * pick a marked wood out at a distance, small enough that the tree still reads
 * as a tree rather than as an overlay — the base diamond is the precise mark,
 * this is the one you can see from across the map.
 */
const DESIGNATED_TINT = 0.15;

/**
 * One tree on tile (tx, ty), standing on ground of height `h` blocks.
 *
 * Three builds from the mockup — tall pine, round tree, bush — chosen by a
 * per-tile hash, with the same per-tile rotation jitter, so a wood reads as
 * varied without any of it being stored.
 *
 * `designated` tints the canopy — not the trunk, which stays wood-coloured so
 * the shift reads as leaves catching the light rather than as a painted post.
 * Because the tree is baked into chunk geometry, marking one has to bump its
 * chunk version; `designate()` in the sim does that.
 */
export function treeBoxes(
  tx: number,
  ty: number,
  h: number,
  seed: number,
  out: Box[],
  designated = false,
): void {
  const v = treeStyle(tx, ty, seed);
  const rot = (v - 0.5) * 0.55;
  const x = tx + 0.5;
  const z = ty + 0.5;
  const g = h * BH;
  const leaf = (colour: number): number =>
    designated ? lerpHex(colour, OVERLAY.gold, DESIGNATED_TINT) : colour;

  if (v > 0.7) {
    out.push(box(x, g, z, 0.24, 1.15 * BH, 0.24, PROP.trunk, rot));
    out.push(box(x, g + 1.15 * BH, z, 0.9, 1.05 * BH, 0.9, leaf(PROP.leafA), rot));
    out.push(box(x, g + 2.2 * BH, z, 0.62, 0.85 * BH, 0.62, leaf(PROP.leafB), rot));
    out.push(box(x, g + 3.05 * BH, z, 0.32, 0.55 * BH, 0.32, leaf(PROP.leafA), rot));
    return;
  }
  if (v > 0.3) {
    out.push(box(x, g, z, 0.28, 0.95 * BH, 0.28, v > 0.52 ? PROP.trunk : PROP.birch, rot));
    out.push(box(x, g + 0.95 * BH, z, 1.0, 1.35 * BH, 1.0, leaf(v > 0.46 ? PROP.leafB : PROP.leafC), rot));
    out.push(box(x + 0.1, g + 2.3 * BH, z - 0.08, 0.58, 0.62 * BH, 0.58, leaf(PROP.leafA), -rot));
    return;
  }
  // A bush is all canopy — there is no trunk to leave alone.
  out.push(box(x, g, z, 0.68, 0.5 * BH, 0.68, leaf(PROP.leafB), rot));
  out.push(box(x + 0.2, g, z - 0.16, 0.46, 0.38 * BH, 0.46, leaf(PROP.leafC), -rot));
}

/**
 * One building, in whatever state it is in. Blueprint is four stakes and a
 * marked-out plot; under construction is the stakes plus half a body; active
 * is the finished thing. Nothing about it flashes or pulses — a starved site
 * says so in its panel, never on the ground (docs/STYLEGUIDE.md, Tone).
 */
export function buildingBoxes(b: Building, h: number, out: Box[]): void {
  const g = h * BH;
  const cx = b.x + b.w / 2;
  const cz = b.y + b.h / 2;

  if (b.state === BuildingState.Blueprint || b.state === BuildingState.Building) {
    // Marked-out plot: a scraped plate and a stake at each corner.
    out.push(box(cx, g, cz, b.w - 0.1, 0.06, b.h - 0.1, PROP.stake, 0, 0.85));
    for (const [ox, oz] of corners(b)) {
      out.push(box(ox, g, oz, 0.14, 0.5 * BH, 0.14, PROP.stake));
    }
    if (b.state === BuildingState.Building) {
      // Materials are in: the shape starts coming up out of the ground.
      if (b.kind === BuildingKind.Stockpile) deck(cx, g, cz, b, out, 0.5);
      else out.push(box(cx, g + 0.06, cz, b.w - 0.35, 0.7 * BH, b.h - 0.35, PROP.timber, 0, 0.9));
    }
    return;
  }

  if (b.kind === BuildingKind.Stockpile) {
    deck(cx, g, cz, b, out, 1);
    return;
  }
  sawmill(cx, g, cz, b, out);
}

function corners(b: Building): [number, number][] {
  return [
    [b.x + 0.18, b.y + 0.18],
    [b.x + b.w - 0.18, b.y + 0.18],
    [b.x + 0.18, b.y + b.h - 0.18],
    [b.x + b.w - 0.18, b.y + b.h - 0.18],
  ];
}

/** Stockpile: a timber deck with corner posts. Its goods are drawn on top,
 *  by the dynamic layer, because they change every few seconds. */
function deck(cx: number, g: number, cz: number, b: Building, out: Box[], scale: number): void {
  out.push(box(cx, g, cz, b.w - 0.12, 0.16 * BH, b.h - 0.12, PROP.timber));
  for (const [ox, oz] of corners(b)) {
    out.push(box(ox, g, oz, 0.16, 0.55 * BH * scale, 0.16, PROP.stake));
  }
  // Two rails along the long sides, so a full pile still reads as contained.
  out.push(box(cx, g + 0.45 * BH * scale, b.y + 0.18, b.w - 0.36, 0.1 * BH, 0.1, PROP.timber, 0, 0.92));
  out.push(box(cx, g + 0.45 * BH * scale, b.y + b.h - 0.18, b.w - 0.36, 0.1 * BH, 0.1, PROP.timber, 0, 0.92));
}

/**
 * Sawmill: stone plinth, timber walls, one stepped roof slab. One roof, not
 * per-cell overhangs — per-cell roofs overlap and their shaded undersides read
 * as a dark waffle grid (docs/ARCHITECTURE.md, Gotchas).
 */
function sawmill(cx: number, g: number, cz: number, b: Building, out: Box[]): void {
  out.push(box(cx, g, cz, b.w - 0.06, 0.3 * BH, b.h - 0.06, PROP.stone));
  out.push(box(cx, g + 0.3 * BH, cz, b.w - 0.24, 1.5 * BH, b.h - 0.24, PROP.timber));
  // Stepped roof: two slabs, the lower one overhanging the walls.
  out.push(box(cx, g + 1.8 * BH, cz, b.w + 0.16, 0.3 * BH, b.h + 0.16, PROP.clay));
  out.push(box(cx, g + 2.1 * BH, cz, b.w - 0.5, 0.28 * BH, b.h - 0.5, PROP.clay, 0, 0.94));
  // Door on the south face, where the slot worker's station is.
  out.push(box(cx, g + 0.3 * BH, b.y + b.h - 0.13, 0.44, 0.95 * BH, 0.1, PROP.door));
  // A stack of cut timber against the west wall says what happens here.
  out.push(box(b.x + 0.26, g + 0.3 * BH, cz, 0.32, 0.3 * BH, b.h - 0.7, PROP.plank, 0, 0.96));
}

function treeStyle(tx: number, ty: number, seed: number): number {
  return hash(tx, ty, seed ^ TREE_SALT);
}

/** Per-prop colour wobble, keyed to position so it never shimmers. */
export function propJitter(x: number, z: number, seed: number): number {
  const j = hash(Math.round(x * 4), Math.round(z * 4), seed ^ TREE_SALT);
  return 1 - PROP_JITTER * 0.5 + j * PROP_JITTER;
}
