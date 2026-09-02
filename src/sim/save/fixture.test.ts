import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Command } from "../commands";
import { hashSim } from "../hash";
import { createSim, type Sim } from "../store";
import { advanceTick } from "../tick";
import { tileIndex } from "../world/world";
import { decode } from "./codec";

/**
 * `fixtures/v1.castles` is a real save, written by the version-1 codec on
 * 2026-09-02 and **frozen**. ARCHITECTURE.md's versioning policy asks for
 * migrations tested against fixture saves; this is that test, started while v1
 * is cheap to freeze rather than after the first save format anyone cared
 * about had already shipped.
 *
 * **Never regenerate this file.** If the `Sim` shape changes, this test starts
 * failing, and the fix is a `SAVE_VERSION` bump plus a rung in `MIGRATIONS` —
 * that failure is the alarm working, not a stale fixture. The pinned hash
 * below moves only when a migration legitimately changes what a v1 save
 * decodes into, and the changelog entry for that migration says so.
 *
 * What it holds: `createSim(20260901)` advanced 400 ticks with twelve trees
 * designated at tick 0 and a stockpile placed at tick 5 — colonists mid-path,
 * items on the ground, a blueprint under construction, live tasks with
 * reservations. Not an empty world: an empty store would round-trip past
 * almost every mistake this test exists to catch.
 *
 * **The pinned hash alone cannot raise that alarm**, which is the trap this
 * file has to avoid: decoding a frozen file is a function of the bytes and the
 * codec only, so nothing in `store.ts` participates and a field added to
 * `Colonist` leaves every hash here untouched — the v1 save would load with
 * that field simply missing. So the shape test below re-runs the fixture's own
 * recipe with the *current* build and compares key sets. Key sets, not hashes:
 * retuning the labour numbers changes the colony a recipe produces and must
 * not read as a broken save format.
 */
const FIXTURE = new URL("./fixtures/v1.castles", import.meta.url);
const SEED = 20260901;
const TICKS = 400;

/** The fixture's recipe, re-run by whatever the store looks like today. */
function rebuilt(): Sim {
  const sim = createSim(SEED);
  for (let t = 0; t < TICKS; t++) advanceTick(sim, script(sim));
  return sim;
}

function script(sim: Sim): Command[] {
  if (sim.tick === 0) return [{ kind: "designateChop", tiles: nearestTrees(sim, 12) }];
  if (sim.tick === 5) return [{ kind: "place", building: 0, x: 128, y: 128 }];
  return [];
}

function nearestTrees(sim: Sim, count: number): number[] {
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

describe("the committed v1 save", () => {
  it("still loads", async () => {
    const sim = await decode(readFileSync(FIXTURE));
    expect(sim.tick).toBe(400);
    expect(sim.world.seed).toBe(20260901);
    expect(sim.world.size).toBe(256);
    expect(sim.colonists).toHaveLength(5);
    expect(sim.buildings.length).toBeGreaterThan(0);
    expect(sim.items.length).toBeGreaterThan(0);
  });

  it("decodes to the exact store it was written from", async () => {
    // The whole-store hash, so a byte-order slip or a dropped field in the
    // codec shows up here rather than as a colony that is subtly wrong.
    const sim = await decode(readFileSync(FIXTURE));
    expect(hashSim(sim)).toBe("5d843ae6");
  });

  it("keeps running from where it was saved", async () => {
    const sim = await decode(readFileSync(FIXTURE));
    for (let t = 0; t < 50; t++) advanceTick(sim);
    expect(sim.tick).toBe(450);
  });

  /**
   * The drift alarm the pinned hash cannot sound. A failure here means the
   * store grew or lost a field since v1 was frozen, so a v1 save no longer
   * decodes into a store this build can assume anything about: bump
   * `SAVE_VERSION` and add the rung that fills the gap.
   */
  it("still has the store shape this build produces", async () => {
    const old = await decode(readFileSync(FIXTURE));
    const now = rebuilt();

    expect(Object.keys(old).sort()).toEqual(Object.keys(now).sort());
    expect(Object.keys(old.world).sort()).toEqual(Object.keys(now.world).sort());

    for (const key of ["colonists", "items", "buildings", "tasks"] as const) {
      // A frozen file can only vouch for the kinds it actually contains, and
      // the recipe can only compare against the kinds it still produces — so
      // assert both are non-empty rather than letting the comparison pass
      // vacuously on an empty list.
      expect(old[key].length, `fixture holds no ${key}`).toBeGreaterThan(0);
      expect(now[key].length, `the recipe no longer produces ${key}`).toBeGreaterThan(0);
      expect(Object.keys(old[key][0]).sort(), key).toEqual(Object.keys(now[key][0]).sort());
    }
  });
});
