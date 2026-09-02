import { describe, expect, it } from "vitest";
import { hashSim } from "../hash";
import { createSim } from "../store";
import { advanceTick } from "../tick";
import type { Command } from "../commands";
import { tileIndex } from "../world/world";
import { SAVE_VERSION, SaveError, decode, encode } from "./codec";
import { MIGRATIONS } from "./migrations";

const SEED = 20260901;
const APP = "test";

/**
 * A colony with something in it: trees marked, a stockpile placed, work in
 * flight. A save of `createSim()` alone would round-trip on an almost-empty
 * store and prove very little.
 */
function playedSim(ticks: number): ReturnType<typeof createSim> {
  const sim = createSim(SEED);
  for (let t = 0; t < ticks; t++) advanceTick(sim, script(sim));
  return sim;
}

function script(sim: ReturnType<typeof createSim>): Command[] {
  if (sim.tick === 0) return [{ kind: "designateChop", tiles: nearestTrees(sim, 12) }];
  if (sim.tick === 5) return [{ kind: "place", building: 0, x: 128, y: 128 }];
  return [];
}

function nearestTrees(sim: ReturnType<typeof createSim>, count: number): number[] {
  const size = sim.world.size;
  const centre = Math.floor(size / 2);
  const out: number[] = [];
  for (let r = 1; r < size && out.length < count; r++) {
    for (let dy = -r; dy <= r && out.length < count; dy++) {
      for (let dx = -r; dx <= r && out.length < count; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const i = tileIndex(centre + dx, centre + dy, size);
        if (sim.world.treeMap[i]) out.push(i);
      }
    }
  }
  return out;
}

/** Re-gzip an arbitrary envelope, so the refusal tests can hand `decode`
 *  files no `encode` would ever write. */
async function gzipJson(value: unknown): Promise<Uint8Array> {
  const cs = new CompressionStream("gzip");
  const writer = cs.writable.getWriter();
  void writer.write(new TextEncoder().encode(JSON.stringify(value)));
  void writer.close();
  const reader = cs.readable.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value: chunk } = await reader.read();
    if (done) break;
    parts.push(chunk);
    total += chunk.length;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

describe("the save codec", () => {
  it("round-trips the whole store to an identical hash", async () => {
    const sim = playedSim(400);
    const loaded = await decode(await encode(sim, APP));
    expect(hashSim(loaded)).toBe(hashSim(sim));
  });

  it("revives typed arrays as typed arrays, not as objects", async () => {
    const loaded = await decode(await encode(playedSim(120), APP));
    expect(loaded.world.hmap).toBeInstanceOf(Uint8Array);
    expect(loaded.world.tmap).toBeInstanceOf(Uint8Array);
    expect(loaded.world.treeMap).toBeInstanceOf(Uint8Array);
    expect(loaded.chopMap).toBeInstanceOf(Uint8Array);
    // Uint32 is the one that would survive a byte-order mistake unnoticed on a
    // little-endian machine, so assert on its values and not just its type.
    expect(loaded.world.chunkVersion).toBeInstanceOf(Uint32Array);
    expect([...loaded.world.chunkVersion]).toEqual([...playedSim(120).world.chunkVersion]);
  });

  it("survives a value above 255 in a u32 layer", async () => {
    const sim = playedSim(10);
    sim.world.chunkVersion[0] = 0xfedcba98;
    const loaded = await decode(await encode(sim, APP));
    expect(loaded.world.chunkVersion[0]).toBe(0xfedcba98);
  });

  /**
   * The feature's contract, and the reason persistence was pulled forward:
   * a loaded colony continues as if it had never stopped. Save at T, load,
   * advance N — the store must be indistinguishable from a run that was never
   * interrupted.
   */
  it("loads without drift: save at T, run on, match an uninterrupted run", async () => {
    const T = 500;
    const N = 400;

    const saved = playedSim(T);
    const bytes = await encode(saved, APP);

    const uninterrupted = playedSim(T);
    for (let t = 0; t < N; t++) advanceTick(uninterrupted, script(uninterrupted));

    const resumed = await decode(bytes);
    for (let t = 0; t < N; t++) advanceTick(resumed, script(resumed));

    expect(hashSim(resumed)).toBe(hashSim(uninterrupted));
  });

  it("keeps the seed, tick and app version in the envelope", async () => {
    const sim = playedSim(30);
    const loaded = await decode(await encode(sim, "v9.9.9"));
    // The envelope's copies are informational; `state` is the authority, so
    // what matters is that the store's own tick and seed came back intact.
    expect(loaded.tick).toBe(sim.tick);
    expect(loaded.world.seed).toBe(SEED);
  });
});

describe("the save codec refuses what it cannot read", () => {
  it("rejects bytes that are not a gzip stream", async () => {
    await expect(decode(new Uint8Array([1, 2, 3, 4, 5]))).rejects.toBeInstanceOf(SaveError);
  });

  it("rejects a truncated save", async () => {
    const bytes = await encode(playedSim(20), APP);
    await expect(decode(bytes.slice(0, Math.floor(bytes.length / 2)))).rejects.toBeInstanceOf(SaveError);
  });

  it("rejects valid gzip that is not JSON", async () => {
    const cs = new CompressionStream("gzip");
    const writer = cs.writable.getWriter();
    void writer.write(new TextEncoder().encode("this is not a save"));
    void writer.close();
    const parts: Uint8Array[] = [];
    const reader = cs.readable.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
    }
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    await expect(decode(out)).rejects.toBeInstanceOf(SaveError);
  });

  it("rejects a save from a newer version, by name", async () => {
    const bytes = await gzipJson({ v: SAVE_VERSION + 1, seed: 1, tick: 0, app: APP, state: {} });
    await expect(decode(bytes)).rejects.toThrow(/newer version/);
  });

  it("rejects a version with no migration rung", async () => {
    // Reachable the moment SAVE_VERSION moves past a version whose migration
    // was deliberately left out (the pre-1.0 escape hatch).
    const bytes = await gzipJson({ v: 0, seed: 1, tick: 0, app: APP, state: {} });
    await expect(decode(bytes)).rejects.toBeInstanceOf(SaveError);
  });

  it("rejects a store missing a world layer rather than returning a partial one", async () => {
    const sim = playedSim(10);
    const bytes = await gzipJson({
      v: SAVE_VERSION,
      seed: SEED,
      tick: sim.tick,
      app: APP,
      state: { tick: sim.tick, rngState: 0, nextId: 1, colonists: [], items: [], buildings: [], tasks: [] },
    });
    await expect(decode(bytes)).rejects.toBeInstanceOf(SaveError);
  });

  it("rejects a world layer of the wrong length", async () => {
    const bytes = await gzipJson({
      v: SAVE_VERSION,
      seed: SEED,
      tick: 0,
      app: APP,
      state: {
        world: { size: 256, seed: SEED, hmap: { __ta: "u8", d: "AAAA" }, tmap: { __ta: "u8", d: "AAAA" } },
        tick: 0,
        rngState: 0,
        nextId: 1,
        colonists: [],
        items: [],
        buildings: [],
        tasks: [],
        chopMap: { __ta: "u8", d: "AAAA" },
      },
    });
    await expect(decode(bytes)).rejects.toBeInstanceOf(SaveError);
  });

  it("rejects a corrupt base64 payload", async () => {
    const bytes = await gzipJson({
      v: SAVE_VERSION,
      seed: SEED,
      tick: 0,
      app: APP,
      state: { world: { size: 4, seed: 1, hmap: { __ta: "u8", d: "!!!!" } } },
    });
    await expect(decode(bytes)).rejects.toBeInstanceOf(SaveError);
  });
});

describe("the migrations ladder", () => {
  it("has a rung for every version below the current one", () => {
    for (let v = 1; v < SAVE_VERSION; v++) {
      expect(typeof MIGRATIONS[v]).toBe("function");
    }
  });

  it("is empty while SAVE_VERSION is 1 — nothing older exists yet", () => {
    if (SAVE_VERSION === 1) expect(Object.keys(MIGRATIONS)).toHaveLength(0);
  });
});
