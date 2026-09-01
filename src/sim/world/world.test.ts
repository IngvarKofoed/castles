import { describe, expect, it } from "vitest";
import { chunkCount, chunkOf } from "./chunks";
import { Terrain, WORLD_SIZE, generate, markChunkDirty, tileIndex } from "./world";

const DEFAULT_SEED = 1;

function fnv1a(buf: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < buf.length; i++) {
    h ^= buf[i];
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

describe("generate", () => {
  const world = generate(DEFAULT_SEED);

  it("is deterministic: same seed, byte-identical maps", () => {
    const again = generate(DEFAULT_SEED);
    expect(fnv1a(again.hmap)).toBe(fnv1a(world.hmap));
    expect(fnv1a(again.tmap)).toBe(fnv1a(world.tmap));
    expect(again.hmap).toEqual(world.hmap);
    expect(again.tmap).toEqual(world.tmap);
  });

  it("gives a different world for a different seed", () => {
    const other = generate(DEFAULT_SEED + 1);
    expect(other.hmap).not.toEqual(world.hmap);
  });

  it("keeps every height within 1..8", () => {
    for (let i = 0; i < world.hmap.length; i++) {
      expect(world.hmap[i]).toBeGreaterThanOrEqual(1);
      expect(world.hmap[i]).toBeLessThanOrEqual(8);
    }
  });

  it("makes every edge tile water", () => {
    const s = world.size;
    for (let k = 0; k < s; k++) {
      expect(world.tmap[tileIndex(k, 0, s)]).toBe(Terrain.Water);
      expect(world.tmap[tileIndex(k, s - 1, s)]).toBe(Terrain.Water);
      expect(world.tmap[tileIndex(0, k, s)]).toBe(Terrain.Water);
      expect(world.tmap[tileIndex(s - 1, k, s)]).toBe(Terrain.Water);
    }
  });

  it("produces all four terrain kinds at the default seed", () => {
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < world.tmap.length; i++) counts[world.tmap[i]]++;
    expect(counts[Terrain.Water]).toBeGreaterThan(0);
    expect(counts[Terrain.Sand]).toBeGreaterThan(0);
    expect(counts[Terrain.Grass]).toBeGreaterThan(0);
    expect(counts[Terrain.Rock]).toBeGreaterThan(0);
  });

  it("keeps rock a feature, not topography: a few percent of land at most", () => {
    let land = 0;
    let rock = 0;
    for (let i = 0; i < world.tmap.length; i++) {
      if (world.tmap[i] !== Terrain.Water) land++;
      if (world.tmap[i] === Terrain.Rock) rock++;
    }
    expect(rock / land).toBeLessThan(0.08);
  });

  it("keeps most land in the flat 3..5 band", () => {
    let land = 0;
    let flat = 0;
    for (let i = 0; i < world.hmap.length; i++) {
      if (world.tmap[i] === Terrain.Water) continue;
      land++;
      if (world.hmap[i] >= 3 && world.hmap[i] <= 5) flat++;
    }
    expect(flat / land).toBeGreaterThan(0.8);
  });

  it("starts every chunk version at 1", () => {
    expect(world.chunkVersion.length).toBe(chunkCount(WORLD_SIZE));
    for (const v of world.chunkVersion) expect(v).toBe(1);
  });

  it("dirties only the owning chunk for an interior tile", () => {
    const w = generate(DEFAULT_SEED);
    markChunkDirty(w, 24, 24);
    const bumped = [...w.chunkVersion].flatMap((v, c) => (v > 1 ? [c] : []));
    expect(bumped).toEqual([chunkOf(24, 24, w.size)]);
  });

  it("dirties the neighbours a border tile's geometry reaches into", () => {
    const s = WORLD_SIZE;

    // Border tile: the mesher's side faces and the renderer's AO both read
    // across the chunk seam, so the chunk to the west must rebuild too.
    const edge = generate(DEFAULT_SEED);
    markChunkDirty(edge, 16, 24);
    const edgeBumped = [...edge.chunkVersion].flatMap((v, c) => (v > 1 ? [c] : []));
    expect(edgeBumped.sort((a, b) => a - b)).toEqual(
      [chunkOf(15, 24, s), chunkOf(16, 24, s)].sort((a, b) => a - b),
    );

    // Corner tile: AO's diagonal kernel reaches three neighbouring chunks.
    const corner = generate(DEFAULT_SEED);
    markChunkDirty(corner, 16, 16);
    const cornerBumped = [...corner.chunkVersion].flatMap((v, c) => (v > 1 ? [c] : []));
    expect(cornerBumped.sort((a, b) => a - b)).toEqual(
      [chunkOf(15, 15, s), chunkOf(16, 15, s), chunkOf(15, 16, s), chunkOf(16, 16, s)].sort(
        (a, b) => a - b,
      ),
    );
  });

  it("clamps to the map at a world-corner tile", () => {
    const w = generate(DEFAULT_SEED);
    markChunkDirty(w, 0, 0);
    const bumped = [...w.chunkVersion].flatMap((v, c) => (v > 1 ? [c] : []));
    expect(bumped).toEqual([chunkOf(0, 0, w.size)]);
  });

  it("types tiles by height: ≤1 water, 2 sand, ≥7 rock, else grass", () => {
    for (let i = 0; i < world.hmap.length; i++) {
      const h = world.hmap[i];
      const t = world.tmap[i];
      if (h <= 1) expect(t).toBe(Terrain.Water);
      else if (h === 2) expect(t).toBe(Terrain.Sand);
      else if (h >= 7) expect(t).toBe(Terrain.Rock);
      else expect(t).toBe(Terrain.Grass);
    }
  });
});
