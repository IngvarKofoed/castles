import { describe, expect, it } from "vitest";
import { Terrain, type TerrainValue, type World } from "../sim/world/world";
import { BH, WATER_SURFACE_OFFSET, meshChunk, meshWaterChunk, type ChunkGeometry } from "./mesher";

function makeWorld(size: number, heights: number[], terrain?: TerrainValue[]): World {
  if (heights.length !== size * size) throw new Error("bad fixture");
  return {
    size,
    seed: 7,
    hmap: Uint8Array.from(heights),
    tmap: terrain ? Uint8Array.from(terrain) : new Uint8Array(size * size).fill(Terrain.Grass),
    chunkVersion: new Uint32Array(1).fill(1),
  };
}

const quadCount = (g: { indices: Uint32Array }): number => g.indices.length / 6;

/** Vertex indices whose position/normal satisfy the predicates. */
function verticesWhere(
  g: ChunkGeometry,
  pred: (px: number, py: number, pz: number, nx: number, ny: number, nz: number) => boolean,
): number[] {
  const out: number[] = [];
  for (let v = 0; v < g.positions.length / 3; v++) {
    if (
      pred(
        g.positions[v * 3],
        g.positions[v * 3 + 1],
        g.positions[v * 3 + 2],
        g.normals[v * 3],
        g.normals[v * 3 + 1],
        g.normals[v * 3 + 2],
      )
    ) {
      out.push(v);
    }
  }
  return out;
}

describe("meshChunk", () => {
  // Row-major 2×2: (0,0)=2 blocks tall, the rest 1.
  const world = makeWorld(2, [2, 1, 1, 1]);
  const g = meshChunk(world, 0, 0);

  it("emits the exact expected face count for a hand-built 2×2 world", () => {
    // 4 tops; tile(0,0) has 4 exposed sides (2 map edges + 2 taller-than-
    // neighbour), each remaining tile has its 2 map-edge sides.
    expect(quadCount(g)).toBe(4 + 4 + 2 + 2 + 2);
    expect(g.positions.length / 3).toBe(14 * 4);
    expect(g.blockY.length).toBe(14 * 4);
  });

  it("puts the tall tile's top quad at h·BH with blockY 1", () => {
    const tops = verticesWhere(g, (px, py, pz, _nx, ny) => ny === 1 && py === 2 * BH && px <= 1 && pz <= 1);
    expect(tops.length).toBe(4);
    for (const v of tops) expect(g.blockY[v]).toBe(1);
  });

  it("drops the internal side quad only to the neighbour's height", () => {
    // Between (0,0) h=2 and (1,0) h=1: plane X=1, +X normal, spanning 0.5..1.0.
    const side = verticesWhere(g, (px, _py, pz, nx) => nx === 1 && px === 1 && pz <= 1);
    expect(side.length).toBe(4);
    const ys = side.map((v) => g.positions[v * 3 + 1]).sort();
    expect(ys).toEqual([1 * BH, 1 * BH, 2 * BH, 2 * BH]);
    // blockY: neighbour-height fraction at the bottom, 1 at the top.
    for (const v of side) {
      expect(g.blockY[v]).toBe(g.positions[v * 3 + 1] === 2 * BH ? 1 : 0.5);
    }
  });

  it("closes the map edge down to height 0 with blockY 0 at the base", () => {
    // pz === 0 isolates tile (0,0)'s -X face corner pair; tile (0,1)'s edge
    // face shares the pz=1 line and would otherwise match too.
    const edge = verticesWhere(g, (px, _py, pz, nx) => nx === -1 && px === 0 && pz === 0);
    expect(edge.length).toBe(2);
    const ys = edge.map((v) => g.positions[v * 3 + 1]).sort();
    expect(ys).toEqual([0, 2 * BH]);
    for (const v of edge) {
      expect(g.blockY[v]).toBe(g.positions[v * 3 + 1] === 0 ? 0 : 1);
    }
  });

  it("matches faces across a chunk border: the taller tile's chunk owns the step", () => {
    // 32×32 (2×2 chunks): flat height 1 except tile (16, 5) raised to 3.
    const heights = new Array(32 * 32).fill(1);
    heights[5 * 32 + 16] = 3;
    const w = makeWorld(32, heights);

    const west = meshChunk(w, 0, 0); // owns x 0..15
    const east = meshChunk(w, 1, 0); // owns x 16..31

    // The east chunk carries the -X step face at the border plane x=16,
    // spanning the neighbour's height up to its own.
    const step = verticesWhere(east, (px, _py, pz, nx) => nx === -1 && px === 16 && pz >= 5 && pz <= 6);
    expect(step.length).toBe(4);
    expect(step.map((v) => east.positions[v * 3 + 1]).sort()).toEqual([1 * BH, 1 * BH, 3 * BH, 3 * BH]);

    // The west chunk emits nothing at that plane — tile (15,5) is the lower
    // side of the step, so it has no +X face there.
    const none = verticesWhere(west, (px, _py, pz, nx) => nx === 1 && px === 16 && pz >= 5 && pz <= 6);
    expect(none.length).toBe(0);
  });
});

describe("meshWaterChunk", () => {
  it("emits one surface quad per wet tile at the water line, none when dry", () => {
    const w = makeWorld(2, [1, 1, 2, 3], [Terrain.Water, Terrain.Water, Terrain.Sand, Terrain.Grass]);
    const water = meshWaterChunk(w, 0, 0);
    expect(water).not.toBeNull();
    expect(quadCount(water!)).toBe(2);
    for (let v = 0; v < water!.positions.length / 3; v++) {
      expect(water!.positions[v * 3 + 1]).toBeCloseTo(1 * BH + WATER_SURFACE_OFFSET);
    }

    const dry = meshWaterChunk(makeWorld(2, [3, 3, 3, 3]), 0, 0);
    expect(dry).toBeNull();
  });
});
