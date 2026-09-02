import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyCommands } from "../commands";
import { hashSim } from "../hash";
import { BuildingKind, ItemType, TaskKind, type Sim } from "../store";
import { advanceTick } from "../tick";
import { WallState, canPlaceWall, isStoneWall } from "../walls";
import { tileIndex } from "../world/world";
import { decode } from "./codec";
import {
  FIXTURE_SEED_V3,
  V1_TICKS,
  V2_TICKS,
  V3_TICKS,
  replay,
  v1Script,
  v2Script,
  v3Script,
} from "./fixtures/recipe";

/**
 * The committed `.castles` fixtures: real saves, written by the codec of their
 * own version and **frozen**. ARCHITECTURE.md's versioning policy asks for
 * migrations tested against fixture saves; this is that test.
 *
 * **Never regenerate either file.** If the `Sim` shape changes, the shape test
 * below starts failing, and the fix is a `SAVE_VERSION` bump plus a rung in
 * `MIGRATIONS` — that failure is the alarm working, not a stale fixture. The
 * pinned hashes move only when a migration legitimately changes what a save
 * decodes into, and the changelog entry for that migration says so.
 *
 * What they hold — recipes in `fixtures/recipe.ts`:
 *
 * - **v1**, written 2026-09-02 by the version-1 codec: colonists mid-path,
 *   items on the ground, a blueprint under construction, live tasks with
 *   reservations. No walls; the format had none.
 * - **v2**, written 2026-09-02: all of that plus a closed ring of palisade
 *   with a gate in it (so `insideMap` is not all zeroes), a run of blueprints
 *   with live build-wall tasks holding their logs reserved, and a raze
 *   designation nobody has finished acting on.
 * - **v3**, written 2026-09-02 for the stone tier: a staffed mason, rock and
 *   blocks in the colony, a stone segment standing and two more drawn, a live
 *   quarry designation, a levelling area mid-job, and a raze mark. On its own
 *   seed, because the stone chain needs an outcrop within walking distance —
 *   see `fixtures/recipe.ts`.
 *
 * Neither is an empty world: an empty store would round-trip past almost every
 * mistake this file exists to catch.
 *
 * **The pinned hashes alone cannot raise that alarm**, which is the trap here:
 * decoding a frozen file is a function of the bytes and the codec only, so
 * nothing in `store.ts` participates and a field added to `Colonist` leaves
 * every hash untouched — the old save would load with that field simply
 * missing. So the shape tests re-run each fixture's own recipe with the
 * *current* build and compare key sets. Key sets, not hashes: retuning the
 * labour numbers changes the colony a recipe produces and must not read as a
 * broken save format.
 */
const V1 = new URL("./fixtures/v1.castles", import.meta.url);
const V2 = new URL("./fixtures/v2.castles", import.meta.url);
const V3 = new URL("./fixtures/v3.castles", import.meta.url);

/** Every store key, and every key of one entity of each kind, from a save. */
function shapeOf(sim: Sim): Record<string, string[]> {
  const out: Record<string, string[]> = {
    store: Object.keys(sim).sort(),
    world: Object.keys(sim.world).sort(),
  };
  for (const key of ["colonists", "items", "buildings", "tasks"] as const) {
    // A frozen file can only vouch for the kinds it actually contains, and a
    // recipe can only compare against the kinds it still produces — so assert
    // both are non-empty rather than letting the comparison pass vacuously.
    expect(sim[key].length, `holds no ${key}`).toBeGreaterThan(0);
    out[key] = Object.keys(sim[key][0]).sort();
  }
  return out;
}

describe("the committed v1 save", () => {
  it("still loads", async () => {
    const sim = await decode(readFileSync(V1));
    expect(sim.tick).toBe(400);
    expect(sim.world.seed).toBe(20260901);
    expect(sim.world.size).toBe(256);
    expect(sim.colonists).toHaveLength(5);
    expect(sim.buildings.length).toBeGreaterThan(0);
    expect(sim.items.length).toBeGreaterThan(0);
  });

  it("decodes to the store the v2 migration turns it into", async () => {
    // The whole-store hash, so a byte-order slip or a dropped field in the
    // codec shows up here rather than as a colony that is subtly wrong.
    //
    // 5d843ae6 → 507f1746 at SAVE_VERSION 2: the 1 → 2 rung adds the three
    // wall layers and `decode` recomputes enclosure over them
    // (docs/changelog/2026-09-02-palisade-walls.md). The *file* is untouched
    // and must stay so; what moved is what a v1 save now decodes into, which
    // is exactly when this number is allowed to move.
    //
    // 507f1746 → cf8c3fd7 at SAVE_VERSION 3: the 2 → 3 rung adds `mineMap` and
    // `terraformMap` and stamps `acceptRock`/`acceptBlock` on to every
    // building already in the file
    // (docs/changelog/2026-09-02-stone-and-terraform.md). A v1 save now walks
    // two rungs to get here, and the assertion below is what says the second
    // one actually ran.
    const sim = await decode(readFileSync(V1));
    expect(hashSim(sim)).toBe("cf8c3fd7");
    // The half of that rung nothing else would catch: a pre-v3 stockpile that
    // came through with the flags missing would refuse rock and blocks for the
    // rest of its life, and no test but this one would notice.
    for (const b of sim.buildings) {
      expect(b.acceptRock).toBe(1);
      expect(b.acceptBlock).toBe(1);
    }
  });

  it("keeps running from where it was saved", async () => {
    const sim = await decode(readFileSync(V1));
    for (let t = 0; t < 50; t++) advanceTick(sim);
    expect(sim.tick).toBe(450);
  });

  it("opens wall-less, and takes a wall immediately", async () => {
    const sim = await decode(readFileSync(V1));
    expect(sim.wallMap).toHaveLength(256 * 256);
    expect(sim.wallMap.some((v) => v !== 0)).toBe(false);
    expect(sim.razeMap.some((v) => v !== 0)).toBe(false);
    // Nothing enclosed and nothing pending: the load ran the fill over the
    // empty wall graph rather than trusting the zeroes the migration handed it.
    expect(sim.insideMap.some((v) => v !== 0)).toBe(false);
    expect(sim.enclosureDirty).toBe(0);

    const i = tileIndex(120, 120, 256);
    expect(canPlaceWall(sim, 120, 120)).toBe(true);
    applyCommands(sim, [{ kind: "placeWall", tiles: [i], material: "timber" }]);
    expect(sim.wallMap[i]).toBe(WallState.PalisadeBp);
  });

  it("opens with nothing designated, and takes the stone tier's orders straight away", async () => {
    // The 2 → 3 rung's other half: a v1 colony has never heard of quarrying or
    // levelling, so both layers arrive zeroed and usable rather than absent.
    const sim = await decode(readFileSync(V1));
    expect(sim.mineMap).toHaveLength(256 * 256);
    expect(sim.terraformMap).toHaveLength(256 * 256);
    expect(sim.mineMap.some((v) => v !== 0)).toBe(false);
    expect(sim.terraformMap.some((v) => v !== 0)).toBe(false);

    const i = tileIndex(122, 122, 256);
    applyCommands(sim, [{ kind: "designateTerraform", tiles: [i], target: 5 }]);
    expect(sim.terraformMap[i]).toBe(6);
    applyCommands(sim, [{ kind: "placeWall", tiles: [tileIndex(124, 124, 256)], material: "stone" }]);
    expect(sim.wallMap[tileIndex(124, 124, 256)]).toBe(WallState.StoneBp);
  });
});

describe("the committed v2 save", () => {
  it("still loads, with its walls, its ring and its work in flight", async () => {
    const sim = await decode(readFileSync(V2));
    expect(sim.tick).toBe(V2_TICKS);
    expect(sim.world.seed).toBe(20260901);

    // Every wall state the tier ships except the transient gate blueprint.
    const states = new Set([...sim.wallMap].filter((v) => v !== WallState.None));
    expect(states).toEqual(new Set([WallState.PalisadeBp, WallState.Palisade, WallState.Gate]));

    // A closed ring with a gate in it encloses its interior — in a real save,
    // not only in a unit test.
    expect([...sim.insideMap].reduce((n, v) => n + v, 0)).toBe(1);
    expect(sim.enclosureDirty).toBe(0);

    // Work in flight: a dismantle mark nobody has finished, and build-wall
    // tasks each holding a log reserved.
    expect([...sim.razeMap].filter((v) => v)).toHaveLength(1);
    const walling = sim.tasks.filter((t) => t.kind === TaskKind.BuildWall);
    expect(walling.length).toBeGreaterThan(0);
    for (const t of walling) {
      expect(sim.items.find((it) => it.id === t.item)?.reservedBy).toBe(t.id);
    }
    expect(sim.tasks.some((t) => t.kind === TaskKind.Raze)).toBe(true);
  });

  it("decodes to the exact store it was written from", async () => {
    // 680d0d2e → 02dba047 at SAVE_VERSION 3, for the same 2 → 3 rung the v1
    // pin above records: two zeroed layers, and the accept flags stamped on to
    // this file's stockpile and mill.
    const sim = await decode(readFileSync(V2));
    expect(hashSim(sim)).toBe("02dba047");
    for (const b of sim.buildings) {
      expect(b.acceptRock).toBe(1);
      expect(b.acceptBlock).toBe(1);
    }
  });

  it("keeps running from where it was saved, and finishes what it was doing", async () => {
    const sim = await decode(readFileSync(V2));
    const razing = [...sim.razeMap].findIndex((v) => v === 1);
    for (let t = 0; t < 400; t++) advanceTick(sim);
    expect(sim.tick).toBe(V2_TICKS + 400);
    // The marked segment came down and the ring is open again, which is the
    // load being genuinely live rather than merely readable.
    expect(sim.wallMap[razing]).toBe(WallState.None);
    expect([...sim.insideMap].reduce((n, v) => n + v, 0)).toBe(0);
  });
});

describe("the committed v3 save", () => {
  it("still loads, with its stone tier caught mid-flow", async () => {
    const sim = await decode(readFileSync(V3));
    expect(sim.tick).toBe(V3_TICKS);
    expect(sim.world.seed).toBe(FIXTURE_SEED_V3);

    // The chain, in one file: rock quarried out of the map, a block cut from
    // it, and a stone segment standing where a block was carried.
    expect(sim.items.some((it) => it.type === ItemType.Rock)).toBe(true);
    expect(sim.items.some((it) => it.type === ItemType.Block)).toBe(true);
    const stone = [...sim.wallMap].filter((v) => isStoneWall(v));
    expect(stone.filter((v) => v === WallState.Stone)).toHaveLength(1);
    expect(stone.filter((v) => v === WallState.StoneBp)).toHaveLength(2);

    // A staffed mason, and both intent layers carrying real designations.
    const mason = sim.buildings.find((b) => b.kind === BuildingKind.Mason);
    expect(mason?.worker).toBeGreaterThanOrEqual(0);
    expect([...sim.mineMap].filter((v) => v)).toHaveLength(1);
    expect([...sim.terraformMap].filter((v) => v).length).toBeGreaterThan(0);
    expect([...sim.razeMap].filter((v) => v)).toHaveLength(1);
  });

  it("decodes to the exact store it was written from", async () => {
    const sim = await decode(readFileSync(V3));
    expect(hashSim(sim)).toBe("b7480025");
  });

  it("keeps running from where it was saved, and finishes what it was doing", async () => {
    const sim = await decode(readFileSync(V3));
    const razing = [...sim.razeMap].findIndex((v) => v === 1);
    const levelling = [...sim.terraformMap].findIndex((v) => v !== 0);
    const target = sim.terraformMap[levelling] - 1;
    for (let t = 0; t < 600; t++) advanceTick(sim);
    expect(sim.tick).toBe(V3_TICKS + 600);
    // The marked segment came down, and the levelling area reached its target
    // height — the load is genuinely live, not merely readable.
    expect(sim.wallMap[razing]).toBe(WallState.None);
    expect(sim.world.hmap[levelling]).toBe(target);
    expect(sim.terraformMap[levelling]).toBe(0);
  });
});

/**
 * The drift alarm the pinned hashes cannot sound. A failure here means the
 * store grew or lost a field since a fixture was frozen, so that save no
 * longer decodes into a store this build can assume anything about: bump
 * `SAVE_VERSION` and add the rung that fills the gap.
 */
describe("the fixtures still have the store shape this build produces", () => {
  it("v1, through its migration", async () => {
    expect(shapeOf(await decode(readFileSync(V1)))).toEqual(shapeOf(replay(v1Script, V1_TICKS)));
  });

  it("v2, through its migration", async () => {
    expect(shapeOf(await decode(readFileSync(V2)))).toEqual(shapeOf(replay(v2Script, V2_TICKS)));
  });

  it("v3, natively", async () => {
    expect(shapeOf(await decode(readFileSync(V3)))).toEqual(
      shapeOf(replay(v3Script, V3_TICKS, FIXTURE_SEED_V3)),
    );
  });
});
