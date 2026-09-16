import { Color } from "three";
import { CHUNK } from "../sim/world/chunks";
import { Terrain, tileIndex, type World } from "../sim/world/world";
import type { Building } from "../sim/know";
import { WallState, damageTier } from "../sim/know";
import { DESIGNATED_TINT, tileColor } from "./palette";
import {
  BH,
  WallLink,
  buildingBoxes,
  graveBoxes,
  lairBoxes,
  propJitter,
  treeBoxes,
  wallBoxes,
  type Box,
} from "./props";

export { BH };

/**
 * What a chunk needs to mesh itself: the terrain grids (which carry the tree
 * layer) plus the colony's buildings.
 *
 * Buildings arrive as the entity array, not as a per-tile index. Deriving a
 * 65k-entry index would cost more to rebuild on every dirty event than a
 * filter over a list that never gets long — the mesher only wants the handful
 * whose origin tile falls in this chunk.
 */
export interface Scene {
  readonly world: World;
  readonly buildings: readonly Building[];
  /**
   * The chop-designation layer, one byte per tile. A designated tree bakes
   * with a gold-shifted canopy, so the mark survives being looked at from
   * across the map — which means designating is a geometry change and has to
   * bump the tile's chunk version.
   */
  readonly chopMap: Uint8Array;
  /**
   * Quarry designations. A marked outcrop's **top face** bakes gold-shifted —
   * the object half of the styleguide's two-marks rule, and the reason
   * designating one bumps its chunk version like designating a tree does. Only
   * the top: the cliff faces stay rock, so the mark reads as a marked surface
   * rather than as a gold boulder.
   */
  readonly mineMap: Uint8Array;
  /**
   * The wall layer and its dismantle designations, same deal: a segment's
   * posts and rails bake, and a raze mark bakes into their colour, so both
   * placing and marking bump chunk versions. Wall orientation is read from the
   * *world*, not from the chunk, so a run reads continuously across a seam.
   */
  readonly wallMap: Uint8Array;
  readonly razeMap: Uint8Array;
  /**
   * Bite damage per tile. Read through `damageTier`, so what the mesh carries
   * is thirds rather than points — which is what lets the sim dirty a chunk
   * only when a third is actually crossed.
   */
  readonly damageMap: Uint8Array;
  /** 1 where a colonist was caught. A marker, baked like a tree because it
   *  never moves and never does anything. */
  readonly graveMap: Uint8Array;
  /** Where the monsters live. A den is a landmark you can see, so it bakes
   *  with the world rather than hiding behind knowledge. */
  readonly lairs: readonly { x: number; y: number }[];
}

/**
 * Top of the water surface: the mockup's thin water box spanned
 * h·BH + 0.07 .. h·BH + 0.13; the merged surface is a quad at its top.
 */
export const WATER_SURFACE_OFFSET = 0.13;

export interface ChunkGeometry {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  /** 0 at a column's base, 1 at its top; 1.0 on top faces. Feeds vBlockY. */
  blockY: Float32Array;
  /**
   * How hard this vertex leans in the wind. A literal copy of `blockY`'s
   * shape — one float per vertex, baked with the chunk — because the motion is
   * entirely in the vertex shader: a swaying chunk costs exactly what a still
   * one costs, and a rebuild is unaffected.
   *
   * Zero on every terrain vertex and on every structural prop; non-zero only on
   * the canopy, crop and bloom boxes `props.ts` marks, and there only on the
   * box's **top** vertices (see `emitBox`).
   */
  sway: Float32Array;
  indices: Uint32Array;
}

export interface WaterGeometry {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

/**
 * Mesh one 16×16 chunk of terrain into merged voxel geometry: per tile, one
 * top quad plus a side quad down to each lower neighbour. Vertices are baked
 * in world coordinates — chunk meshes sit at the origin — so the shaders'
 * non-instancing branches read correct world positions unchanged.
 *
 * Pure: reads the world, returns typed arrays, touches no GL state.
 */
export function meshChunk(scene: Scene, cx: number, cy: number): ChunkGeometry {
  const world = scene.world;
  const size = world.size;
  const x0 = cx * CHUNK;
  const y0 = cy * CHUNK;
  const x1 = Math.min(x0 + CHUNK, size);
  const y1 = Math.min(y0 + CHUNK, size);

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const blockY: number[] = [];
  const sway: number[] = [];
  const indices: number[] = [];

  // Neighbour lookups read the world, not the chunk, so chunk-border faces
  // are correct; the map edge counts as height 0, closing the island silhouette.
  const heightAt = (x: number, y: number): number =>
    x < 0 || x >= size || y < 0 || y >= size ? 0 : world.hmap[tileIndex(x, y, size)];

  let r = 0;
  let g = 0;
  let b = 0;

  // `sy` is the vertex's sway weight. Terrain never passes one — the ground
  // does not lean — so it defaults to 0 and only `emitBox` ever sets it.
  const vertex = (
    px: number,
    py: number,
    pz: number,
    nx: number,
    ny: number,
    nz: number,
    by: number,
    sy = 0,
  ): void => {
    positions.push(px, py, pz);
    normals.push(nx, ny, nz);
    colors.push(r, g, b);
    blockY.push(by);
    sway.push(sy);
  };

  const quadIndices = (): void => {
    const v = positions.length / 3 - 4;
    indices.push(v, v + 1, v + 2, v, v + 2, v + 3);
  };

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = tileIndex(x, y, size);
      const h = world.hmap[i];
      const top = h * BH;
      const marked = scene.mineMap[i] === 1;
      const paint = (tint: number): void => {
        const col = tileColor(world, x, y, tint);
        r = col.r;
        g = col.g;
        b = col.b;
      };

      // Top quad, CCW seen from above (+Y normal). A quarry-marked outcrop
      // takes the designation tint here and nowhere else, so the mark sits on
      // the surface being worked and the rock face stays rock.
      paint(marked ? DESIGNATED_TINT : 0);
      vertex(x, top, y, 0, 1, 0, 1);
      vertex(x, top, y + 1, 0, 1, 0, 1);
      vertex(x + 1, top, y + 1, 0, 1, 0, 1);
      vertex(x + 1, top, y, 0, 1, 0, 1);
      quadIndices();
      if (marked) paint(0);

      // Side quads down to each lower neighbour. blockY is the vertex's
      // fraction of this column's height, matching the mockup's per-column
      // vBlockY (its unit box spanned the full column).
      const side = (nh: number, face: (bot: number, byBot: number) => void): void => {
        if (nh >= h) return;
        face(nh * BH, nh / h);
      };

      side(heightAt(x - 1, y), (bot, byBot) => {
        vertex(x, bot, y + 1, -1, 0, 0, byBot);
        vertex(x, top, y + 1, -1, 0, 0, 1);
        vertex(x, top, y, -1, 0, 0, 1);
        vertex(x, bot, y, -1, 0, 0, byBot);
        quadIndices();
      });
      side(heightAt(x + 1, y), (bot, byBot) => {
        vertex(x + 1, bot, y, 1, 0, 0, byBot);
        vertex(x + 1, top, y, 1, 0, 0, 1);
        vertex(x + 1, top, y + 1, 1, 0, 0, 1);
        vertex(x + 1, bot, y + 1, 1, 0, 0, byBot);
        quadIndices();
      });
      side(heightAt(x, y - 1), (bot, byBot) => {
        vertex(x, bot, y, 0, 0, -1, byBot);
        vertex(x, top, y, 0, 0, -1, 1);
        vertex(x + 1, top, y, 0, 0, -1, 1);
        vertex(x + 1, bot, y, 0, 0, -1, byBot);
        quadIndices();
      });
      side(heightAt(x, y + 1), (bot, byBot) => {
        vertex(x + 1, bot, y + 1, 0, 0, 1, byBot);
        vertex(x + 1, top, y + 1, 0, 0, 1, 1);
        vertex(x, top, y + 1, 0, 0, 1, 1);
        vertex(x, bot, y + 1, 0, 0, 1, byBot);
        quadIndices();
      });
    }
  }

  // Props ride on the same geometry as terrain, so they cost no extra draw
  // call and take the same contact shading. A prop's own vertical fraction
  // feeds aBlockY, matching the mockup's per-box vBlockY.
  const boxes: Box[] = [];
  const walled = (x: number, y: number): boolean =>
    x >= 0 && x < size && y >= 0 && y < size && scene.wallMap[tileIndex(x, y, size)] !== WallState.None;

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = tileIndex(x, y, size);
      if (world.treeMap[i]) treeBoxes(x, y, world.hmap[i], world.seed, boxes, scene.chopMap[i] === 1);
      if (scene.graveMap[i]) graveBoxes(x, y, world.hmap[i], world.seed, boxes);
      const wall = scene.wallMap[i];
      if (wall === WallState.None) continue;
      const links =
        (walled(x - 1, y) ? WallLink.West : 0) |
        (walled(x + 1, y) ? WallLink.East : 0) |
        (walled(x, y - 1) ? WallLink.North : 0) |
        (walled(x, y + 1) ? WallLink.South : 0);
      wallBoxes(
        x,
        y,
        world.hmap[i],
        world.seed,
        boxes,
        wall,
        links,
        scene.razeMap[i] === 1,
        damageTier(wall, scene.damageMap[i]),
      );
    }
  }
  // Dens, emitted by the chunk their tile falls in — the buildings rule, for
  // the same reason: a lair is one prop on one tile and there are two dozen of
  // them on a whole map, so filtering the list beats indexing 65k tiles.
  for (const lair of scene.lairs) {
    if (lair.x < x0 || lair.x >= x1 || lair.y < y0 || lair.y >= y1) continue;
    lairBoxes(lair.x, lair.y, world.hmap[tileIndex(lair.x, lair.y, size)], world.seed, boxes);
  }
  // A building is emitted whole by the chunk owning its origin tile, so a
  // footprint straddling a seam is never drawn twice or half-drawn. Every
  // footprint tile is marked dirty on a state change, so that chunk rebuilds.
  for (const building of scene.buildings) {
    if (building.x < x0 || building.x >= x1 || building.y < y0 || building.y >= y1) continue;
    buildingBoxes(building, world.hmap[tileIndex(building.x, building.y, size)], boxes);
  }

  const boxColor = new Color();
  for (const p of boxes) {
    // Keyed to the box's jitter anchor, not its centre: a member built in
    // pieces (a palisade rail split into arms) must not wobble per piece.
    boxColor.setHex(p.color).multiplyScalar(p.shade * propJitter(p.jx, p.jz, world.seed));
    r = boxColor.r;
    g = boxColor.g;
    b = boxColor.b;
    emitBox(p, vertex, quadIndices);
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    colors: new Float32Array(colors),
    blockY: new Float32Array(blockY),
    sway: new Float32Array(sway),
    indices: new Uint32Array(indices),
  };
}

type Vertex = (
  px: number,
  py: number,
  pz: number,
  nx: number,
  ny: number,
  nz: number,
  by: number,
  sy?: number,
) => void;

// Unit cube corners, then the six faces as corner quads with their normals.
// Written out rather than generated so the winding is inspectable: every quad
// is counter-clockwise seen from outside.
const FACES: readonly { n: readonly [number, number, number]; q: readonly [number, number, number][] }[] = [
  { n: [0, 1, 0], q: [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]] },
  { n: [0, -1, 0], q: [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]] },
  { n: [0, 0, 1], q: [[1, -1, 1], [1, 1, 1], [-1, 1, 1], [-1, -1, 1]] },
  { n: [0, 0, -1], q: [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]] },
  { n: [1, 0, 0], q: [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]] },
  { n: [-1, 0, 0], q: [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]] },
];

/**
 * Emit one prop box, optionally spun about +y. `aBlockY` runs 0 at the box's
 * own bottom to 1 at its own top — the same convention the mockup's unit cube
 * gave every prop, so contact shading dims each box toward its base.
 *
 * `aSway` rides the **same top-vertex mask**: the box's weight at its top, zero
 * at its bottom. Per vertex rather than per box is load-bearing — weighted per
 * box, every furrow ridge and every bloom slides bodily sideways and a bloom
 * head walks off its stem; masked, a canopy bends its head and keeps its feet
 * within a box as well as between boxes.
 */
function emitBox(p: Box, vertex: Vertex, quad: () => void): void {
  const cos = Math.cos(p.rot);
  const sin = Math.sin(p.rot);
  const hx = p.sx / 2;
  const hy = p.sy / 2;
  const hz = p.sz / 2;
  for (const face of FACES) {
    // Normals rotate with the box, or lighting on a spun tree comes out flat.
    const nx = face.n[0] * cos + face.n[2] * sin;
    const nz = -face.n[0] * sin + face.n[2] * cos;
    for (const [sxi, syi, szi] of face.q) {
      const lx = sxi * hx;
      const lz = szi * hz;
      vertex(
        p.x + lx * cos + lz * sin,
        p.y + syi * hy,
        p.z - lx * sin + lz * cos,
        nx,
        face.n[1],
        nz,
        syi > 0 ? 1 : 0,
        syi > 0 ? p.sway : 0,
      );
    }
    quad();
  }
}

/**
 * Water surface for a chunk: one thin top quad per wet tile at the water
 * line, world-coordinate baked so the wave shader's non-instancing branch
 * displaces correctly unchanged. Returns null when the chunk is dry.
 */
export function meshWaterChunk(scene: Scene, cx: number, cy: number): WaterGeometry | null {
  const world = scene.world;
  const size = world.size;
  const x0 = cx * CHUNK;
  const y0 = cy * CHUNK;
  const x1 = Math.min(x0 + CHUNK, size);
  const y1 = Math.min(y0 + CHUNK, size);

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = tileIndex(x, y, size);
      if (world.tmap[i] !== Terrain.Water) continue;
      const top = world.hmap[i] * BH + WATER_SURFACE_OFFSET;
      const v = positions.length / 3;
      positions.push(x, top, y, x, top, y + 1, x + 1, top, y + 1, x + 1, top, y);
      normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
      indices.push(v, v + 1, v + 2, v, v + 2, v + 3);
    }
  }

  if (!positions.length) return null;
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
  };
}
