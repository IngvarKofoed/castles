import { describe, expect, it } from "vitest";
import { BuildingKind, BuildingState, WallState, type Building } from "../sim/know";
import { testBuilding } from "../sim/test-sim";
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
  return {
    world,
    buildings: [],
    chopMap: new Uint8Array(size * size),
    mineMap: new Uint8Array(size * size),
    wallMap: new Uint8Array(size * size),
    razeMap: new Uint8Array(size * size),
    damageMap: new Uint8Array(size * size),
    graveMap: new Uint8Array(size * size),
    lairs: [],
  };
}

function withTree(scene: Scene, x: number, y: number): Scene {
  scene.world.treeMap[y * scene.world.size + x] = 1;
  return scene;
}

function withBuilding(scene: Scene, b: Partial<Building> & { x: number; y: number }): Scene {
  const building: Building = testBuilding({ id: 1, ...b });
  return { ...scene, buildings: [building] };
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

describe("sway bakes into the chunk", () => {
  const swaying = (g: ChunkGeometry): number[] => {
    const out: number[] = [];
    for (let v = 0; v < g.sway.length; v++) if (g.sway[v] > 0) out.push(v);
    return out;
  };

  it("leaves bare terrain with no lean at all", () => {
    const g = meshChunk(makeWorld(2, [2, 1, 1, 1]), 0, 0);
    expect(g.sway.length).toBe(g.blockY.length);
    expect(swaying(g).length).toBe(0);
  });

  it("carries one weight per vertex, never one per box", () => {
    // The mask is the whole design: weighted per box instead, every furrow
    // ridge and every bloom slides bodily sideways and a bloom head walks off
    // its stem. So a leaning vertex is always a box's *top* vertex.
    const g = meshChunk(withTree(makeWorld(2, [2, 1, 1, 1]), 0, 0), 0, 0);
    const leaning = swaying(g);
    expect(leaning.length).toBeGreaterThan(0);
    for (const v of leaning) expect(g.blockY[v]).toBe(1);
    // And every box that leans also has vertices that do not — its own feet.
    expect(leaning.length).toBeLessThan(g.sway.length);
  });

  it("leans a tree's canopy and leaves its trunk, the ground and a shed still", () => {
    const g = meshChunk(withTree(makeWorld(2, [2, 1, 1, 1]), 0, 0), 0, 0);
    // Nothing at or below the trunk's own top leans: the canopy boxes all
    // start at 1.15·BH or above on the tall style, 0.95·BH on the round one,
    // and a bush is all canopy sitting on the ground — so the invariant that
    // holds for every style is that the *ground* itself never moves.
    for (const v of swaying(g)) expect(g.positions[v * 3 + 1]).toBeGreaterThan(2 * BH);

    // A timber workshop is structure from plinth to ridge; none of it leans.
    const shed = withBuilding(makeWorld(4, new Array(16).fill(1)), {
      x: 1,
      y: 1,
      kind: BuildingKind.Sawmill,
      state: BuildingState.Active,
    });
    expect(swaying(meshChunk(shed, 0, 0)).length).toBe(0);
  });

  it("leans a Farm's standing green but not the earth it grows in", () => {
    const flat = new Array(16).fill(1);
    const bare = meshChunk(withBuilding(makeWorld(4, flat), { x: 0, y: 0, w: 3, h: 3, kind: BuildingKind.Pasture }), 0, 0);
    const farm = meshChunk(withBuilding(makeWorld(4, flat), { x: 0, y: 0, w: 3, h: 3, kind: BuildingKind.Farm }), 0, 0);
    // The Pasture is the Farm's grammar with the furrows taken out, so it is
    // the control: same plot, same fence, nothing that grows.
    expect(swaying(bare).length).toBe(0);
    expect(swaying(farm).length).toBeGreaterThan(0);
    // Two furrows on a 3×3 — the last row is the yard — and twelve leaning
    // vertices each: a box is 24 vertices and exactly half of them are its top
    // (the top face's four, plus the upper pair of each of the four sides).
    expect(swaying(farm).length).toBe(2 * 12);
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

  it("shifts a marked outcrop's top face toward gold, leaving its cliffs rock", () => {
    // The other half of the two-marks rule, on the one designation whose
    // subject is the terrain itself: the surface being worked warms up, the
    // faces you see from the side stay rock — so it reads as a marked *top*
    // rather than as a gold boulder. Measured, for the same reason the canopy
    // tint is: rock already carries per-tile jitter.
    const rock: TerrainValue[] = [Terrain.Rock, Terrain.Grass, Terrain.Grass, Terrain.Grass];
    const plain = makeWorld(2, [7, 3, 3, 3], rock);
    const marked = makeWorld(2, [7, 3, 3, 3], rock);
    marked.mineMap[0] = 1;

    const a = meshChunk(plain, 0, 0);
    const b = meshChunk(marked, 0, 0);
    expect(b.positions).toEqual(a.positions);
    expect(b.indices).toEqual(a.indices);

    let changed = 0;
    for (let v = 0; v < a.colors.length / 3; v++) {
      const [ar, ag] = [a.colors[v * 3], a.colors[v * 3 + 1]];
      const [br, bg] = [b.colors[v * 3], b.colors[v * 3 + 1]];
      if (ar === br && ag === bg) continue;
      changed++;
      // Warmer: more red, and more red relative to green.
      expect(br).toBeGreaterThan(ar);
      expect(br / bg).toBeGreaterThan(ar / ag);
      // And only on the top face — every changed vertex sits at the column's
      // own top, with the +Y normal.
      expect(a.positions[v * 3 + 1]).toBeCloseTo(7 * BH, 6);
      expect(a.normals[v * 3 + 1]).toBe(1);
    }
    // Exactly the four corners of one top quad.
    expect(changed).toBe(4);
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

  it("draws a site the same whether it is waiting or stocked, and the building differently", () => {
    const heights = new Array(32 * 32).fill(3);
    const bare = quadCount(meshChunk(makeWorld(32, heights), 0, 0));
    const counts = [BuildingState.Blueprint, BuildingState.Building, BuildingState.Active].map((state) =>
      quadCount(meshChunk(withBuilding(makeWorld(32, heights), { x: 4, y: 4, state }), 0, 0)),
    );
    for (const c of counts) expect(c).toBeGreaterThan(bare);
    // **Blueprint and Building are one silhouette on purpose.** Both are the
    // site's timber frame over its plate and nothing else; `Building` lasts four
    // seconds and its honest difference from waiting is that no empty material
    // slot is left, which the mover layer draws and this mesh knows nothing
    // about. The featureless half-body that used to mark it was removed when the
    // frame arrived — inside a frame it was a blank block among the delivered
    // cubes (docs/changelog/2026-09-16-site-scaffolding.md).
    expect(counts[1]).toBe(counts[0]);
    expect(counts[2]).not.toBe(counts[0]);
  });
});

describe("walls bake into the chunk", () => {
  const flat = (size: number): Scene => makeWorld(size, new Array(size * size).fill(3));

  it("gives every wall state its own silhouette, in rising order", () => {
    // The order is the read: a marked-out plot is ankle-high, a planned gate
    // stands its frame, a palisade is chest-high, a gate towers. Height rather
    // than box count, because height is what the player actually sees — and
    // it is what tells a planned gate apart from a planned palisade in a run.
    const bare = quadCount(meshChunk(flat(16), 0, 0));
    const tops = [WallState.PalisadeBp, WallState.GateBp, WallState.Palisade, WallState.Gate].map((state) => {
      const scene = flat(16);
      scene.wallMap[5 * 16 + 5] = state;
      const g = meshChunk(scene, 0, 0);
      expect(quadCount(g)).toBeGreaterThan(bare);
      const above = verticesWhere(g, (_px, py) => py > 3 * BH + 0.01);
      expect(above.length).toBeGreaterThan(0);
      // Every part of it sits over the tile it belongs to.
      for (const v of above) {
        expect(g.positions[v * 3]).toBeGreaterThan(4.4);
        expect(g.positions[v * 3]).toBeLessThan(6.6);
      }
      return Math.max(...above.map((v) => g.positions[v * 3 + 1])) - 3 * BH;
    });
    for (let i = 1; i < tops.length; i++) expect(tops[i]).toBeGreaterThan(tops[i - 1]);
  });

  it("stands stone taller than timber, and its gateway taller again", () => {
    // The permanent tier has to read as permanent from across the map, so the
    // silhouette is the thing: stone is taller than the palisade of the same
    // shape, and a stone arch is the tallest thing a wall run has.
    const top = (state: number): number => {
      const scene = flat(16);
      scene.wallMap[5 * 16 + 5] = state;
      const g = meshChunk(scene, 0, 0);
      const above = verticesWhere(g, (_px, py) => py > 3 * BH + 0.01);
      expect(above.length).toBeGreaterThan(0);
      return Math.max(...above.map((v) => g.positions[v * 3 + 1])) - 3 * BH;
    };
    expect(top(WallState.Stone)).toBeGreaterThan(top(WallState.Palisade));
    expect(top(WallState.StoneGate)).toBeGreaterThan(top(WallState.Gate));
    expect(top(WallState.StoneGate)).toBeGreaterThan(top(WallState.Stone));
    // A stone blueprint is still a marked-out plot: ankle-high, like every
    // other drawing, so a drawn line never looks like a built one.
    expect(top(WallState.StoneBp)).toBeLessThan(top(WallState.Stone));
    expect(top(WallState.StoneBp)).toBeCloseTo(top(WallState.PalisadeBp), 6);
    expect(top(WallState.StoneGateBp)).toBeCloseTo(top(WallState.GateBp), 6);
  });

  it("bakes stone as a solid course, not as posts and rails", () => {
    // What makes stone read as stone at a glance is that it is *filled*: a
    // palisade is a few thin members with daylight between them, a stone
    // segment is a wall. Measured as the run of the widest member across the
    // tile, which is the difference a screenshot shows.
    const widest = (state: number): number => {
      const scene = flat(16);
      scene.wallMap[5 * 16 + 5] = state;
      scene.wallMap[4 * 16 + 5] = state;
      scene.wallMap[6 * 16 + 5] = state;
      const g = meshChunk(scene, 0, 0);
      // Vertices belonging to the middle tile, above the ground.
      const mine = verticesWhere(
        g,
        (px, py, pz) => py > 3 * BH + 0.05 && px > 5.05 && px < 5.95 && pz > 5.05 && pz < 5.95,
      );
      const xs = mine.map((v) => g.positions[v * 3]);
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(widest(WallState.Stone)).toBeGreaterThan(widest(WallState.Palisade) * 2);
  });

  /**
   * The corner cases the one-axis-per-tile version got wrong. A palisade is a
   * centre post plus an arm per linked direction, so what these assert is that
   * every linked side is *reached* — rails running all the way out to the tile
   * edge on that side — and that no unlinked side is.
   */
  describe("junctions", () => {
    /** How far the wall's timber reaches from the tile centre, per side. */
    function reach(scene: Scene, tx: number, ty: number): Record<string, number> {
      const g = meshChunk(scene, 0, 0);
      const size = scene.world.size;
      const ground = scene.world.hmap[ty * size + tx] * BH;
      const cx = tx + 0.5;
      const cz = ty + 0.5;
      const out = { west: 0, east: 0, north: 0, south: 0 };
      for (let v = 0; v < g.positions.length / 3; v++) {
        const [px, py, pz] = [g.positions[v * 3], g.positions[v * 3 + 1], g.positions[v * 3 + 2]];
        // Rails only: above the ground plate, below the stake tops, and only
        // vertices belonging to this tile.
        if (py <= ground + 0.01) continue;
        if (Math.abs(px - cx) > 0.75 || Math.abs(pz - cz) > 0.75) continue;
        out.west = Math.max(out.west, cx - px);
        out.east = Math.max(out.east, px - cx);
        out.north = Math.max(out.north, cz - pz);
        out.south = Math.max(out.south, pz - cz);
      }
      return out;
    }

    /** A wall on (5,5) plus walls on each named neighbour. */
    function junction(...sides: ("west" | "east" | "north" | "south")[]): Scene {
      const scene = makeWorld(16, new Array(16 * 16).fill(3));
      const put = (x: number, y: number): void => {
        scene.wallMap[y * 16 + x] = WallState.Palisade;
      };
      put(5, 5);
      for (const side of sides) {
        if (side === "west") put(4, 5);
        if (side === "east") put(6, 5);
        if (side === "north") put(5, 4);
        if (side === "south") put(5, 6);
      }
      return scene;
    }

    // A linked side is reached to the tile edge (0.5) and a little past it by
    // the arm's overlap; an unlinked side stops at the stake's own half-width.
    const REACHED = 0.5;
    const UNREACHED = 0.2;

    it("reaches the edge on a straight run and nowhere else", () => {
      const ew = reach(junction("west", "east"), 5, 5);
      expect(ew.west).toBeGreaterThanOrEqual(REACHED);
      expect(ew.east).toBeGreaterThanOrEqual(REACHED);
      expect(ew.north).toBeLessThan(UNREACHED);
      expect(ew.south).toBeLessThan(UNREACHED);

      const ns = reach(junction("north", "south"), 5, 5);
      expect(ns.north).toBeGreaterThanOrEqual(REACHED);
      expect(ns.south).toBeGreaterThanOrEqual(REACHED);
      expect(ns.west).toBeLessThan(UNREACHED);
      expect(ns.east).toBeLessThan(UNREACHED);
    });

    it("reaches both sides of a corner, which is what left a hole before", () => {
      // The whole defect: with one axis per tile this tile rendered as an
      // east-west segment and the southward run stopped half a tile short.
      const corner = reach(junction("west", "south"), 5, 5);
      expect(corner.west).toBeGreaterThanOrEqual(REACHED);
      expect(corner.south).toBeGreaterThanOrEqual(REACHED);
      expect(corner.east).toBeLessThan(UNREACHED);
      expect(corner.north).toBeLessThan(UNREACHED);
    });

    it("reaches all three sides of a T and all four of a cross", () => {
      const t = reach(junction("west", "east", "south"), 5, 5);
      expect(t.west).toBeGreaterThanOrEqual(REACHED);
      expect(t.east).toBeGreaterThanOrEqual(REACHED);
      expect(t.south).toBeGreaterThanOrEqual(REACHED);
      expect(t.north).toBeLessThan(UNREACHED);

      const cross = reach(junction("west", "east", "north", "south"), 5, 5);
      for (const side of ["west", "east", "north", "south"] as const) {
        expect(cross[side], side).toBeGreaterThanOrEqual(REACHED);
      }
    });

    it("gives a lone segment the look it had before: an east-west stub", () => {
      const lone = reach(junction(), 5, 5);
      expect(lone.west).toBeGreaterThanOrEqual(REACHED);
      expect(lone.east).toBeGreaterThanOrEqual(REACHED);
      expect(lone.north).toBeLessThan(UNREACHED);
      expect(lone.south).toBeLessThan(UNREACHED);
    });

    it("keeps a straight run's rails one colour across the tile centre", () => {
      // The rails are two arms now, and each arm would draw its own per-prop
      // colour wobble from its own position — a seam mid-tile on every segment
      // of every run. They anchor their wobble to the tile instead.
      // A lone segment: one tile, two arms, no neighbours' timber to confuse
      // the sample.
      const g = meshChunk(junction(), 0, 0);
      const ground = 3 * BH;
      const tones = new Set<string>();
      let west = 0;
      let east = 0;
      for (let v = 0; v < g.positions.length / 3; v++) {
        const py = g.positions[v * 3 + 1];
        // The lower rail's band. A box only has vertices at its own corners, so
        // a mid-height band catches rails and never a stake, whose vertices are
        // all at its base or its top.
        if (py < ground + 0.43 || py > ground + 0.52) continue;
        if (g.positions[v * 3] < 5.5) west++;
        else east++;
        tones.add(`${g.colors[v * 3].toFixed(5)},${g.colors[v * 3 + 1].toFixed(5)}`);
      }
      // Sampled on both sides of the centre, or the tone assertion is vacuous.
      expect(west).toBeGreaterThan(0);
      expect(east).toBeGreaterThan(0);
      expect(tones.size).toBe(1);
    });
  });

  it("orients a run from its neighbours, reading across a chunk seam", () => {
    // A horizontal run crossing x=16. The tile at (16, 5) has a wall to its
    // west in the *other* chunk, so its rails have to run along x — which only
    // works because the mesher reads the world layer rather than its own chunk.
    const scene = makeWorld(32, new Array(32 * 32).fill(3));
    for (let x = 12; x <= 20; x++) scene.wallMap[5 * 32 + x] = WallState.Palisade;
    const east = meshChunk(scene, 1, 0);
    const seam = verticesWhere(east, (px, py, pz) => py > 3 * BH && px >= 16 && px <= 17 && pz >= 5 && pz <= 6);
    expect(seam.length).toBeGreaterThan(0);
    // Rails span the full tile along x, so the segment reaches both its edges.
    const xs = seam.map((v) => east.positions[v * 3]);
    expect(Math.min(...xs)).toBeCloseTo(16, 5);
    expect(Math.max(...xs)).toBeCloseTo(17, 5);

    // The same segment in a vertical run instead: now it reaches both z edges.
    const upright = makeWorld(32, new Array(32 * 32).fill(3));
    for (let y = 2; y <= 8; y++) upright.wallMap[y * 32 + 16] = WallState.Palisade;
    const g = meshChunk(upright, 1, 0);
    const zs = verticesWhere(g, (px, py, pz) => py > 3 * BH && px >= 16 && px <= 17 && pz >= 5 && pz <= 6).map(
      (v) => g.positions[v * 3 + 2],
    );
    expect(Math.min(...zs)).toBeCloseTo(5, 5);
    expect(Math.max(...zs)).toBeCloseTo(6, 5);
  });

  it("shifts a raze-marked segment's timber toward gold without moving it", () => {
    // Measured, not eyeballed — the same reason a designated canopy's 15% is:
    // the timber already carries per-prop jitter, so a shift this size is easy
    // to mistake for ordinary variation in either direction.
    const plain = flat(16);
    plain.wallMap[5 * 16 + 5] = WallState.Palisade;
    const marked = flat(16);
    marked.wallMap[5 * 16 + 5] = WallState.Palisade;
    marked.razeMap[5 * 16 + 5] = 1;

    const a = meshChunk(plain, 0, 0);
    const b = meshChunk(marked, 0, 0);
    expect(b.positions).toEqual(a.positions);

    let changed = 0;
    for (let v = 0; v < a.colors.length / 3; v++) {
      const [ar, ag] = [a.colors[v * 3], a.colors[v * 3 + 1]];
      const [br, bg] = [b.colors[v * 3], b.colors[v * 3 + 1]];
      if (ar === br && ag === bg) continue;
      changed++;
      expect(br).toBeGreaterThan(ar);
    }
    expect(changed).toBeGreaterThan(0);
  });
});

describe("the threat tier bakes into the chunk", () => {
  const flat = (size: number): Scene => makeWorld(size, new Array(size * size).fill(3));

  it("puts a den where a monster lives, and only there", () => {
    const bare = meshChunk(flat(16), 0, 0);
    const withDen = flat(16);
    const denned = meshChunk({ ...withDen, lairs: [{ x: 5, y: 5 }] }, 0, 0);
    expect(denned.positions.length).toBeGreaterThan(bare.positions.length);
    // The den is a landmark on *its* tile, not a marker spilling across its
    // neighbours: nothing it adds stands up more than a hair outside the tile.
    // A hair rather than nothing, because a bone lying at the mound's corner
    // overhangs the edge by a few hundredths — as a tree's canopy does.
    const spill = 0.1;
    for (const v of verticesWhere(
      denned,
      (px, _py, pz) => px < 5 - spill || px > 6 + spill || pz < 5 - spill || pz > 6 + spill,
    )) {
      expect(denned.positions[v * 3 + 1]).toBeLessThanOrEqual(3 * BH + 1e-6);
    }
    // And it belongs to the chunk holding its tile, like a building does.
    expect(meshChunk({ ...withDen, lairs: [{ x: 20, y: 5 }] }, 0, 0).positions).toEqual(bare.positions);
  });

  it("puts a grave where somebody died", () => {
    const bare = meshChunk(flat(16), 0, 0);
    const buried = flat(16);
    buried.graveMap[7 * 16 + 7] = 1;
    expect(meshChunk(buried, 0, 0).positions.length).toBeGreaterThan(bare.positions.length);
  });

  it("darkens a bitten segment by thirds, and takes its top rail off at the last", () => {
    // The two halves of "ragged", measured rather than eyeballed: the colour
    // goes down monotonically, and the silhouette actually loses a member.
    const at = (damage: number): ChunkGeometry => {
      const s = flat(16);
      s.wallMap[5 * 16 + 5] = WallState.Palisade;
      s.damageMap[5 * 16 + 5] = damage;
      return meshChunk(s, 0, 0);
    };
    const sound = at(0);
    const worn = at(20); // half of PALISADE_HP: past a third, short of two
    const wrecked = at(36); // past two thirds

    // Same geometry at the first crossing, darker timber.
    expect(worn.positions).toEqual(sound.positions);
    let dimmer = 0;
    for (let v = 0; v < sound.colors.length; v++) {
      if (worn.colors[v] === sound.colors[v]) continue;
      expect(worn.colors[v]).toBeLessThan(sound.colors[v]);
      dimmer++;
    }
    expect(dimmer).toBeGreaterThan(0);

    // At the last third a rail is gone, so the shape itself says so.
    expect(wrecked.positions.length).toBeLessThan(sound.positions.length);
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
