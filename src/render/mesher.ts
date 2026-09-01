import { CHUNK } from "../sim/world/chunks";
import { Terrain, tileIndex, type World } from "../sim/world/world";
import { tileColor } from "./palette";

/** Block height in world units, ported from the mockup. */
export const BH = 0.5;

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
export function meshChunk(world: World, cx: number, cy: number): ChunkGeometry {
  const size = world.size;
  const x0 = cx * CHUNK;
  const y0 = cy * CHUNK;
  const x1 = Math.min(x0 + CHUNK, size);
  const y1 = Math.min(y0 + CHUNK, size);

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const blockY: number[] = [];
  const indices: number[] = [];

  // Neighbour lookups read the world, not the chunk, so chunk-border faces
  // are correct; the map edge counts as height 0, closing the island silhouette.
  const heightAt = (x: number, y: number): number =>
    x < 0 || x >= size || y < 0 || y >= size ? 0 : world.hmap[tileIndex(x, y, size)];

  let r = 0;
  let g = 0;
  let b = 0;

  const vertex = (px: number, py: number, pz: number, nx: number, ny: number, nz: number, by: number): void => {
    positions.push(px, py, pz);
    normals.push(nx, ny, nz);
    colors.push(r, g, b);
    blockY.push(by);
  };

  const quadIndices = (): void => {
    const v = positions.length / 3 - 4;
    indices.push(v, v + 1, v + 2, v, v + 2, v + 3);
  };

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const h = world.hmap[tileIndex(x, y, size)];
      const top = h * BH;
      const col = tileColor(world, x, y);
      r = col.r;
      g = col.g;
      b = col.b;

      // Top quad, CCW seen from above (+Y normal).
      vertex(x, top, y, 0, 1, 0, 1);
      vertex(x, top, y + 1, 0, 1, 0, 1);
      vertex(x + 1, top, y + 1, 0, 1, 0, 1);
      vertex(x + 1, top, y, 0, 1, 0, 1);
      quadIndices();

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

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    colors: new Float32Array(colors),
    blockY: new Float32Array(blockY),
    indices: new Uint32Array(indices),
  };
}

/**
 * Water surface for a chunk: one thin top quad per wet tile at the water
 * line, world-coordinate baked so the wave shader's non-instancing branch
 * displaces correctly unchanged. Returns null when the chunk is dry.
 */
export function meshWaterChunk(world: World, cx: number, cy: number): WaterGeometry | null {
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
