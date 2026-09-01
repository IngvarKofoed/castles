import { describe, expect, it } from "vitest";
import { BuildingState, type Building } from "../sim/know";
import { Terrain, type TerrainValue, type World } from "../sim/world/world";
import { BH, WATER_SURFACE_OFFSET, meshChunk, meshWaterChunk, type ChunkGeometry, type Scene } from "./mesher";

/** A bare scene: hand-built terrain, no trees, no buildings. */
function makeWorld(size: number, heights: number[], terrain?: TerrainValue[]): Scene {
  if (heights.length !== size * size) throw new Error("bad fixture");
  const world: World = {
    size,
    seed: 7,
    hmap: Uint8Array.from(heights),
    tmap: terrain ? Uint8Array.from(terrain) : new Uint8Array(size * size).fill(Terrain.Grass),
    treeMap: new Uint8Array(size * size),
    chunkVersion: new Uint32Array(1).fill(1),
  };
  return { world, buildings: [], chopMap: new Uint8Array(size * size) };
}

function withTree(scene: Scene, x: number, y: number): Scene {
  scene.world.treeMap[y * scene.world.size + x] = 1;
  return scene;
}

function withBuilding(scene: Scene, b: Partial<Building> & { x: number; y: number }): Scene {
  const building: Building = {
    id: 1,
    kind: 0,
    w: 2,
    h: 2,
    state: BuildingState.Active,
    progress: 0,
    reservedIncoming: 0,
    acceptLog: 1,
    acceptPlank: 1,
    worker: -1,
    millProgress: -1,
    ...b,
  };
  return { world: scene.world, buildings: [building], chopMap: scene.chopMap };
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

describe("props bake into the chunk", () => {
  it("adds tree geometry above the tile it stands on", () => {
    const bare = meshChunk(makeWorld(2, [2, 1, 1, 1]), 0, 0);
    const wooded = meshChunk(withTree(makeWorld(2, [2, 1, 1, 1]), 0, 0), 0, 0);
    expect(quadCount(wooded)).toBeGreaterThan(quadCount(bare));

    // Every added vertex sits above the tile's ground and over its footprint.
    const above = verticesWhere(wooded, (_px, py) => py > 2 * BH);
    expect(above.length).toBeGreaterThan(0);
    for (const v of above) {
      expect(wooded.positions[v * 3]).toBeGreaterThan(-0.5);
      expect(wooded.positions[v * 3]).toBeLessThan(1.5);
    }
  });

  it("gives every prop box aBlockY 0 at its base and 1 at its top", () => {
    const g = meshChunk(withTree(makeWorld(2, [2, 1, 1, 1]), 0, 0), 0, 0);
    for (let v = 0; v < g.blockY.length; v++) {
      expect(g.blockY[v] === 0 || g.blockY[v] === 1 || (g.blockY[v] > 0 && g.blockY[v] < 1)).toBe(true);
    }
  });

  it("shifts a designated tree's canopy toward gold, leaving its trunk alone", () => {
    // The base diamond is the precise mark; this tint is what carries it at
    // distance. Measured rather than eyeballed: a 15% shift is easy to mistake
    // for the three-green canopy variation the trees already have.
    const plain = makeWorld(2, [2, 1, 1, 1]);
    withTree(plain, 0, 0);
    const marked = makeWorld(2, [2, 1, 1, 1]);
    withTree(marked, 0, 0);
    marked.chopMap[0] = 1;

    const a = meshChunk(plain, 0, 0);
    const b = meshChunk(marked, 0, 0);
    // Same geometry either way — only colour moves.
    expect(b.positions).toEqual(a.positions);
    expect(b.indices).toEqual(a.indices);

    // Every changed vertex gets warmer: more red, and a higher red-to-green
    // ratio. Not "less blue" — the leaf greens are *darker* in blue than gold
    // is (`leafA` #3c7d28 has b=40 against gold's b=60), so a shift toward
    // gold raises blue too. Warmth is the invariant; per-channel direction
    // is not.
    let changed = 0;
    for (let v = 0; v < a.colors.length / 3; v++) {
      const [ar, ag, ab] = [a.colors[v * 3], a.colors[v * 3 + 1], a.colors[v * 3 + 2]];
      const [br, bg, bb] = [b.colors[v * 3], b.colors[v * 3 + 1], b.colors[v * 3 + 2]];
      if (ar === br && ag === bg && ab === bb) continue;
      changed++;
      expect(br).toBeGreaterThan(ar);
      expect(br / bg).toBeGreaterThan(ar / ag);
    }
    expect(changed).toBeGreaterThan(0);

    // The trunk keeps its wood colour: some of the tree's vertices are
    // untouched, so the shift reads as leaves rather than a painted post.
    expect(changed).toBeLessThan(a.colors.length / 3);
  });

  it("emits a building once, from the chunk owning its origin tile", () => {
    const heights = new Array(32 * 32).fill(3);
    // Origin in the west chunk, footprint straddling the x=16 seam.
    const scene = withBuilding(makeWorld(32, heights), { x: 15, y: 4 });
    const west = meshChunk(scene, 0, 0);
    const east = meshChunk(scene, 1, 0);

    const overBuilding = (g: ChunkGeometry): number =>
      verticesWhere(g, (px, py, pz) => py > 3 * BH + 0.01 && px >= 14 && px <= 18 && pz >= 3 && pz <= 7).length;
    expect(overBuilding(west)).toBeGreaterThan(0);
    expect(overBuilding(east)).toBe(0);
  });

  it("redraws a building at each step of blueprint → building → active", () => {
    const heights = new Array(32 * 32).fill(3);
    const bare = quadCount(meshChunk(makeWorld(32, heights), 0, 0));
    const counts = [BuildingState.Blueprint, BuildingState.Building, BuildingState.Active].map((state) =>
      quadCount(meshChunk(withBuilding(makeWorld(32, heights), { x: 4, y: 4, state }), 0, 0)),
    );
    // Every state is a distinct silhouette, and every one is more than bare
    // ground. Under construction is not the largest: it carries the marker
    // stakes *and* the half-built shape, and the stakes come down when it's
    // finished.
    expect(new Set(counts).size).toBe(3);
    for (const c of counts) expect(c).toBeGreaterThan(bare);
    expect(counts[1]).toBeGreaterThan(counts[0]);
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
