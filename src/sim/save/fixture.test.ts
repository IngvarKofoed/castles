import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyCommands } from "../commands";
import { hashSim } from "../hash";
import { batchTicks, fieldsInReach } from "../economy/workshop";
import { countItems } from "../items";
import { forecast, inspect } from "../know";
import { cellarSet, populationCap, settled } from "../settlers";
import { testBuilding } from "../test-sim";
import { BUILDING_DEFS, recipeOf } from "../buildings";
import { BuildingKind, BuildingState, ItemType, TaskKind, type Sim } from "../store";
import {
  CLOTHES_WEAR_TICKS,
  FIRST_STORM,
  HIVE_FIELDS_MAX,
  HIVE_TICKS_BY_FIELDS,
  PROVISION_BREAD,
  THREAT_BUCKETS,
  WATCH_BUCKETS,
} from "../tuning";
import { advanceTick } from "../tick";
import { WallState, canPlaceWall, isStoneWall } from "../walls";
import { tileIndex } from "../world/world";
import { decode } from "./codec";
import {
  FIXTURE_SEED,
  FIXTURE_SEED_V3,
  FIXTURE_SEED_V4,
  FIXTURE_SEED_V5,
  FIXTURE_SEED_V6,
  FIXTURE_SEED_V8,
  FIXTURE_SEED_V9,
  FIXTURE_SEED_V10,
  V1_TICKS,
  V2_TICKS,
  V3_TICKS,
  V4_TICKS,
  V5_TICKS,
  V6_TICKS,
  V7_TICKS,
  V8_TICKS,
  V9_TICKS,
  V10_TICKS,
  V11_TICKS,
  replay,
  v1Script,
  v2Script,
  v3Script,
  v4Script,
  v5Script,
  v6Script,
  v7Script,
  v8Script,
  v9Script,
  v10Script,
  v11Script,
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
 * - **v4**, written 2026-09-05 for the threat tier: two dozen monsters
 *   mid-rhythm with their routes and phase clocks in flight, and a standing
 *   palisade still carrying its bite damage with a live repair task queued
 *   against it. On the encounter seed, because the default seed's wilds are
 *   forty tiles out and would never reach a fixture's colony.
 * - **v5**, written 2026-09-07 for housing: a House built out of planks, and a
 *   **wanderer in transit** — a colonist with a destination, a hundred-tile
 *   route in flight, and the arrival clock parked behind them. Both are states
 *   the format had never held.
 * - **v6**, written 2026-09-07 for the patience un-pun: the same colony a
 *   thousand ticks later, holding all three ways an arrival can end at once — a
 *   settler who came by sea, the grave of the one after them, and a third
 *   mid-walk with a route half-consumed.
 * - **v7**, written 2026-09-07 for production control: a plank ceiling of two
 *   with the sawmill standing at it, a log parked in its buffer, and a stockpile
 *   with its rock filter off — the first save ever to hold a `limits` slot that
 *   is not `-1` or an accept flag that is not 1.
 * - **v8**, written 2026-09-08 for the bread economy: the whole chain standing
 *   and staffed on a seed with stone five tiles out, grain, flour and bread in
 *   the colony, five running hunger clocks, and a colonist **mid-meal** with a
 *   route to a particular loaf in flight.
 * - **v9**, written 2026-09-09 for the Watchtower: a **1×1 tower standing and
 *   manned**, watching a den eighteen tiles out — the format's first slot
 *   building with no recipe at all, and its first colonist bound to a slot
 *   that produces nothing. On its own seed, because the tower needs both a
 *   near wood and a den inside `WATCH_RANGE` (`fixtures/recipe.ts`).
 * - **v10**, written 2026-09-11 for the sheep chain: seven buildings standing,
 *   all four of its goods in the colony at once, three wear clocks running and
 *   two colonists caught mid-fitting.
 * - **v11**, written 2026-09-14 for the drink chain: a **manned Hive with three
 *   Flowers inside its reach**, so the file freezes a batch length that is a
 *   fact about *where a building stands* rather than a number off a def; a
 *   Meadery turning honey into mead; and a **cellar that is set** — mead for
 *   every settled colonist plus one, which is the number the arrival clock
 *   reads and a state no save had ever held.
 *
 * None is an empty world: an empty store would round-trip past almost every
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
const V4 = new URL("./fixtures/v4.castles", import.meta.url);
const V5 = new URL("./fixtures/v5.castles", import.meta.url);
const V6 = new URL("./fixtures/v6.castles", import.meta.url);
const V7 = new URL("./fixtures/v7.castles", import.meta.url);
const V8 = new URL("./fixtures/v8.castles", import.meta.url);
const V9 = new URL("./fixtures/v9.castles", import.meta.url);
const V10 = new URL("./fixtures/v10.castles", import.meta.url);
const V11 = new URL("./fixtures/v11.castles", import.meta.url);

type EntityKind = "colonists" | "items" | "buildings" | "tasks" | "monsters";

/**
 * What `v7.castles` decodes to. Native when it was written; from SAVE_VERSION 8
 * it walks the bread rung like every other old file, which is what moved this
 * number off `0ca62ff1`, from 10 the sheep rung as well, and from 12 the rung
 * that drops its monsters (docs/specs/2026-09-17-incursions-from-the-sea.md).
 */
const V7_HASH = "17f2479b";

/** The entity kinds a pre-threat recipe can still be asked about. Monsters are
 *  excluded because those three recipes replay in an empty wilderness — see
 *  `replay`'s `peaceful` flag, which explains why. */
const OLD_KINDS: readonly EntityKind[] = ["colonists", "items", "buildings", "tasks"];

/** Every store key, and every key of one entity of each kind, from a save. */
function shapeOf(sim: Sim, kinds: readonly EntityKind[] = OLD_KINDS): Record<string, string[]> {
  const out: Record<string, string[]> = {
    store: Object.keys(sim).sort(),
    world: Object.keys(sim.world).sort(),
  };
  for (const key of kinds) {
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
    // several rungs to get here, and the assertions below are what say the
    // later ones actually ran.
    //
    // cf8c3fd7 → c1b9ffd1 at SAVE_VERSION 4: the 3 → 4 rung adds
    // `wallDamageMap` and `graveMap`, and runs the lair pass over a world
    // regenerated from the save's *seed* — not the played-on layers the file
    // carries, which would give a migrated colony a different wilderness than a
    // fresh game (docs/changelog/2026-09-05-monsters-and-the-hours-they-keep.md).
    //
    // c1b9ffd1 → ea10914f at SAVE_VERSION 5: the 4 → 5 rung stamps `dest = -1`
    // on to every colonist and gives the store its arrival clock
    // (docs/changelog/2026-09-07-housing-and-wanderers.md). A v1 save now walks
    // four rungs to get here.
    //
    // ea10914f → ab0c5574 at SAVE_VERSION 6: the 5 → 6 rung gives every
    // colonist a `patience` field of its own, so the wanderer's give-up clock
    // stops borrowing `work`.
    //
    // ab0c5574 → d01e0770 at SAVE_VERSION 7: the 6 → 7 rung gives the store
    // its `limits` — four slots, all `-1`, which is the colony exactly as it
    // played (docs/changelog/2026-09-07-production-limits-and-filters.md).
    //
    // bd689ee3 → a6bb93fd at SAVE_VERSION 10: the 9 → 10 rung gives every
    // colonist `clothes` and `dressing`, stamps four more accept flags on every
    // building, and appends four `-1`s to `limits`. Nine is an identity, so no
    // number moved for the Watchtower. **Shape only**, and provable the same
    // way the scripted runs' moves were: strip those back out and the store
    // hashes to bd689ee3 again
    // (docs/changelog/2026-09-11-sheep-and-clothes.md).
    //
    // d01e0770 → bd689ee3 at SAVE_VERSION 8: the 7 → 8 rung gives every
    // colonist `hunger` and `eating`, stamps the three bread-chain accept flags
    // on to every building, appends three `-1`s to `limits`, and **grants three
    // loaves per settled colonist** so a loaded colony has the same three-day
    // runway a fresh one does (docs/changelog/2026-09-08-bread-economy.md).
    const sim = await decode(readFileSync(V1));
    // → b2feb0ed at SAVE_VERSION 12: the 11 → 12 rung **drops every monster** and
    // gives the store its forecast clock
    // (docs/specs/2026-09-17-incursions-from-the-sea.md). Every one of the
    // eleven pinned decode hashes in this file moved for it, and they moved
    // together: the files are frozen, and what changed is what a save now
    // decodes into.
    expect(hashSim(sim)).toBe("b2feb0ed");
    expect(sim.limits).toEqual([-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1]);
    // The grant, and the flags that would otherwise refuse it a home forever.
    expect(sim.items.filter((it) => it.type === ItemType.Bread)).toHaveLength(PROVISION_BREAD * 5);
    for (const c of sim.colonists) {
      expect(c.hunger).toBe(0);
      expect(c.eating).toBe(0);
    }
    for (const b of sim.buildings) {
      expect([b.acceptGrain, b.acceptFlour, b.acceptBread]).toEqual([1, 1, 1]);
    }
    // A v1 colony wakes up in an **empty** wilderness with a storm on the way:
    // the 3 → 4 rung used to wake two dozen dens over it, and the 11 → 12 rung
    // drops them again (docs/specs/2026-09-17-incursions-from-the-sea.md).
    expect(sim.monsters).toHaveLength(0);
    expect(sim.stormTicks).toBe(FIRST_STORM);
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
    // this file's stockpile and mill. Then 02dba047 → c74cb502 at
    // SAVE_VERSION 4, for the 3 → 4 rung that gives an old colony its wilds —
    // drawn from a world regenerated from the save's seed, not from the played
    // one, which is what keeps that wilderness equal to a fresh game's.
    // Then 41f2beab → e0a0ad53 at SAVE_VERSION 5, for the 4 → 5 rung the v1
    // pin above records: `dest` on every colonist, and the arrival clock. Then
    // e0a0ad53 → 83891a24 at SAVE_VERSION 6 for the `patience` rung,
    // 83891a24 → 28d26444 at 7 for the `limits` one, and 28d26444 → 16ca8dd6
    // at 8 for the bread rung — two colonist fields, three accept flags, three
    // `limits` slots and fifteen granted loaves
    // (docs/changelog/2026-09-08-bread-economy.md).
    const sim = await decode(readFileSync(V2));
    // → a71ca4ca at SAVE_VERSION 12: the 11 → 12 rung **drops every monster** and
    // gives the store its forecast clock
    // (docs/specs/2026-09-17-incursions-from-the-sea.md). Every one of the
    // eleven pinned decode hashes in this file moved for it, and they moved
    // together: the files are frozen, and what changed is what a save now
    // decodes into.
    expect(hashSim(sim)).toBe("a71ca4ca");
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

  it("decodes to the store the v4 migration turns it into", async () => {
    // b7480025 → 7dcf3387 at SAVE_VERSION 4: the 3 → 4 rung adds
    // `wallDamageMap` and `graveMap` and, crucially, **runs the lair pass over
    // the save's own world**, so a v3 colony wakes up in a wilderness rather
    // than in an empty one (docs/changelog/2026-09-05-monsters-and-the-hours-they-keep.md).
    // The file is untouched and stays so.
    // 7dcf3387 → 9935f38b at SAVE_VERSION 5, for the same 4 → 5 rung,
    // 9935f38b → 8c8cb6fc at 6 for the `patience` one, 8c8cb6fc → 30f9a9a0
    // at 7 for the `limits` one, and 30f9a9a0 → e8452d51 at 8 for the bread one.
    const sim = await decode(readFileSync(V3));
    // → 729385d2 at SAVE_VERSION 12: the 11 → 12 rung **drops every monster** and
    // gives the store its forecast clock
    // (docs/specs/2026-09-17-incursions-from-the-sea.md). Every one of the
    // eleven pinned decode hashes in this file moved for it, and they moved
    // together: the files are frozen, and what changed is what a save now
    // decodes into.
    expect(hashSim(sim)).toBe("729385d2");
    // Empty wilds and a fresh forecast, which is now what a migrated colony
    // is owed: the 3 → 4 rung's lair pass is gone with the dens it made, and
    // this file arrives at the 11 → 12 rung with nothing for it to drop.
    expect(sim.monsters).toHaveLength(0);
    expect(sim.stormTicks).toBe(FIRST_STORM);
    expect(sim.stormLanding).toBe(-1);
    expect(sim.wallDamageMap.some((v) => v !== 0)).toBe(false);
    expect(sim.graveMap.some((v) => v !== 0)).toBe(false);
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

describe("the committed v4 save", () => {
  it("still loads, with its wilds dropped and its wall still wounded", async () => {
    const sim = await decode(readFileSync(V4));
    expect(sim.tick).toBe(V4_TICKS);
    expect(sim.world.seed).toBe(FIXTURE_SEED_V4);

    // **The wilderness is gone, and that is the rung working.** This file was
    // frozen mid-siege with two dozen dens on its map; the 11 → 12 rung drops
    // every one of them, because there is no honest way to turn a resting den
    // into an incursion (docs/specs/2026-09-17-incursions-from-the-sea.md). What
    // it loads into is an empty wilderness with a storm on the way, which is
    // the truthful reading of *this world no longer has dens in it*.
    expect(sim.monsters).toHaveLength(0);
    expect(sim.stormTicks).toBe(FIRST_STORM);
    expect(sim.stormLanding).toBe(-1);

    // A wounded segment the monster walked away from, and somebody queued to
    // mend it — the state the rung does *not* touch, and the reason this file
    // still earns its place.
    expect([...sim.wallDamageMap].filter((v) => v > 0).length).toBeGreaterThan(0);
    expect(sim.tasks.some((t) => t.kind === TaskKind.Repair)).toBe(true);
    // The grave layer rides along empty — see `fixtures/recipe.ts` for why this
    // tick and not a later one.
    expect([...sim.graveMap].filter(Boolean)).toHaveLength(0);
    expect(sim.colonists).toHaveLength(5);
  });

  it("decodes to the store the v5 migration turns it into", async () => {
    // c32c98b0 → 80b2f86e at SAVE_VERSION 5: the 4 → 5 rung adds `dest` to
    // every colonist and `wandererTimer` to the store
    // (docs/changelog/2026-09-07-housing-and-wanderers.md). The file is
    // untouched and stays so.
    // Then 80b2f86e → aee29fc7 at SAVE_VERSION 6, for the rung that gives the
    // give-up clock its own field, aee29fc7 → 65b5106b at 7 for `limits`, and
    // 65b5106b → 87af28e4 at 8 for the bread rung.
    const sim = await decode(readFileSync(V4));
    // → 46fb9317 at SAVE_VERSION 12: the 11 → 12 rung **drops every monster** and
    // gives the store its forecast clock
    // (docs/specs/2026-09-17-incursions-from-the-sea.md). Every one of the
    // eleven pinned decode hashes in this file moved for it, and they moved
    // together: the files are frozen, and what changed is what a save now
    // decodes into.
    expect(hashSim(sim)).toBe("46fb9317");
    // The half of that rung nothing else would catch: a colonist that came
    // through without `dest` would be a store carrying `undefined`, which the
    // plain-data rule forbids and no other test looks for.
    for (const c of sim.colonists) expect(c.dest).toBe(-1);
    expect(sim.wandererTimer).toBeGreaterThan(0);
  });

  it("takes arrivals the moment it has a House, and none before", async () => {
    // The Outcome the 4 → 5 rung owes an old colony: it plays unchanged, and
    // its first House starts the inflow. Before one stands the cap is the
    // starting five and the clock does not run at all.
    const sim = await decode(readFileSync(V4));
    expect(populationCap(sim)).toBe(5);
    const before = sim.wandererTimer;
    for (let t = 0; t < 400; t++) advanceTick(sim);
    expect(sim.colonists.some((c) => c.dest >= 0)).toBe(false);
    expect(sim.wandererTimer).toBe(before);

    // A House dropped in finished — the build itself is pinned by
    // `settlers.test.ts`; what is being asked here is whether a *migrated*
    // store opens the gate.
    sim.buildings.push(testBuilding({ id: sim.nextId++, kind: BuildingKind.House, x: 120, y: 120 }));
    expect(populationCap(sim)).toBe(7);
    let arrived = false;
    for (let t = 0; t < 600 && !arrived; t++) {
      advanceTick(sim);
      arrived = sim.colonists.some((c) => c.dest >= 0);
    }
    expect(arrived).toBe(true);
  });

  it("keeps running from where it was saved, and the damage gets mended", async () => {
    const sim = await decode(readFileSync(V4));
    const wounded = [...sim.wallDamageMap].findIndex((v) => v > 0);
    const was = sim.wallDamageMap[wounded];
    for (let t = 0; t < 600; t++) advanceTick(sim);
    expect(sim.tick).toBe(V4_TICKS + 600);
    // The labour loop picked the repair back up, and with the wilds empty
    // nothing interrupted it: the wounded segment is mended, not frozen where
    // the save left it.
    expect(sim.wallDamageMap[wounded]).not.toBe(was);
    // The forecast clock ran with everything else, and no storm arrived inside
    // the opening grace.
    expect(sim.stormTicks).toBe(FIRST_STORM - 600);
    expect(sim.monsters).toHaveLength(0);
  });
});

describe("the committed v5 save", () => {
  it("still loads, with a House standing and somebody walking in", async () => {
    const sim = await decode(readFileSync(V5));
    expect(sim.tick).toBe(V5_TICKS);
    expect(sim.world.seed).toBe(FIXTURE_SEED_V5);

    // A House, built from planks by a mill this colony staffed itself.
    const house = sim.buildings.find((b) => b.kind === BuildingKind.House);
    expect(house?.state).toBe(BuildingState.Active);
    expect(sim.buildings.some((b) => b.kind === BuildingKind.Sawmill && b.worker >= 0)).toBe(true);
    expect(populationCap(sim)).toBe(7);

    // And somebody on the road, with the route and the clock a save could most
    // plausibly lose: `dest` naming the House, a long path mid-walk, and
    // `wandererTimer` at -1 because the interval is spent.
    const walking = sim.colonists.filter((c) => c.dest >= 0);
    expect(walking).toHaveLength(1);
    expect(walking[0].dest).toBe(house?.id);
    expect(walking[0].path.length - walking[0].step).toBeGreaterThan(50);
    expect(walking[0].task).toBe(-1);
    expect(sim.wandererTimer).toBe(-1);
    // They are not a pair of hands yet, which the readout has to agree with.
    expect(settled(sim)).toBe(5);
  });

  it("decodes to the store the v6 migration turns it into", async () => {
    // 9ce13a24 → 1aba9400 at SAVE_VERSION 6: the 5 → 6 rung moves the
    // wanderer's give-up clock off `work` and onto a `patience` field of its
    // own (docs/changelog/2026-09-07-housing-and-wanderers.md). The file is
    // untouched and stays so — it is the only fixture written by a codec that
    // had `dest` but not `patience`, which is exactly what makes it worth
    // keeping. Then 1aba9400 → 3fb33394 at SAVE_VERSION 7 for `limits`, and
    // 3fb33394 → c38bcff9 at 8 for the bread rung — whose grant counts the
    // **settled** five and not the wanderer this file was caught carrying,
    // because a colonist still walking in neither eats nor hungers.
    const sim = await decode(readFileSync(V5));
    // → 480525c9 at SAVE_VERSION 12: the 11 → 12 rung **drops every monster** and
    // gives the store its forecast clock
    // (docs/specs/2026-09-17-incursions-from-the-sea.md). Every one of the
    // eleven pinned decode hashes in this file moved for it, and they moved
    // together: the files are frozen, and what changed is what a save now
    // decodes into.
    expect(hashSim(sim)).toBe("480525c9");
    expect(sim.items.filter((it) => it.type === ItemType.Bread)).toHaveLength(PROVISION_BREAD * 5);
    for (const c of sim.colonists) expect(c.patience).toBe(0);
    // The wanderer it was caught carrying is still walking, clock and all.
    expect(sim.colonists.filter((c) => c.dest >= 0)).toHaveLength(1);
  });

  it("keeps running from where it was saved, and the walk finishes", async () => {
    const sim = await decode(readFileSync(V5));
    const walking = sim.colonists.find((c) => c.dest >= 0);
    for (let t = 0; t < 1000; t++) advanceTick(sim);
    expect(sim.tick).toBe(V5_TICKS + 1000);
    // The route was walked to its end and they settled: the load is genuinely
    // live, not merely readable, and a reloaded wanderer keeps their errand.
    expect(walking?.dest).toBe(-1);
    expect(settled(sim)).toBe(6);
    expect([...sim.graveMap].filter(Boolean)).toHaveLength(0);
  });
});

describe("the committed v6 save", () => {
  it("still loads, holding all three ends of an arrival at once", async () => {
    const sim = await decode(readFileSync(V6));
    expect(sim.tick).toBe(V6_TICKS);
    expect(sim.world.seed).toBe(FIXTURE_SEED_V6);

    // One who came by sea and stayed: the colony is six against a starting
    // five, and the newcomer is an ordinary pool worker with nothing about
    // them left over from the walk.
    expect(settled(sim)).toBe(6);
    const newest = sim.colonists.filter((c) => c.dest < 0).reduce((a, b) => (a.id > b.id ? a : b));
    expect(newest.dest).toBe(-1);
    expect(newest.patience).toBe(0);
    expect(newest.slot).toBe(-1);

    // One who did not make it, and one still on the road with a route
    // half-walked — the state a save is most likely to lose.
    expect([...sim.graveMap].filter(Boolean)).toHaveLength(1);
    const walking = sim.colonists.filter((c) => c.dest >= 0);
    expect(walking).toHaveLength(1);
    expect(walking[0].step).toBeGreaterThan(0);
    expect(walking[0].path.length - walking[0].step).toBeGreaterThan(50);
    expect(sim.wandererTimer).toBe(-1);
    // And live work in flight, per the late order in the recipe.
    expect(sim.tasks.some((t) => t.kind === TaskKind.Chop)).toBe(true);
  });

  it("decodes to the store the v7 migration turns it into", async () => {
    // 7206746a → e0d58baa at SAVE_VERSION 7: the 6 → 7 rung adds `limits`,
    // four slots of `-1`. The file is untouched and stays so. Then
    // e0d58baa → 251bfc06 at 8 for the bread rung, whose `limits` grows those
    // four slots to seven, and → a71f09d4 at 10 for the sheep rung, which grows
    // them to thirteen — the append ritual, one rung at a time.
    const sim = await decode(readFileSync(V6));
    // → d7412c48 at SAVE_VERSION 12: the 11 → 12 rung **drops every monster** and
    // gives the store its forecast clock
    // (docs/specs/2026-09-17-incursions-from-the-sea.md). Every one of the
    // eleven pinned decode hashes in this file moved for it, and they moved
    // together: the files are frozen, and what changed is what a save now
    // decodes into.
    expect(hashSim(sim)).toBe("d7412c48");
    expect(sim.limits).toEqual([-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1]);
    // Six settled folk by now, so six heads' worth of provisions.
    expect(sim.items.filter((it) => it.type === ItemType.Bread)).toHaveLength(PROVISION_BREAD * 6);
  });

  it("keeps running from where it was saved, and the third one arrives too", async () => {
    const sim = await decode(readFileSync(V6));
    const walking = sim.colonists.find((c) => c.dest >= 0);
    for (let t = 0; t < 900; t++) advanceTick(sim);
    expect(sim.tick).toBe(V6_TICKS + 900);
    // The reloaded route was walked to its end: seven folk, and the cap they
    // are now against.
    expect(walking?.dest).toBe(-1);
    expect(settled(sim)).toBe(7);
    expect(populationCap(sim)).toBe(7);
  });
});

describe("the committed v7 save", () => {
  it("still loads, with a ceiling holding the mill and a filter turned off", async () => {
    const sim = await decode(readFileSync(V7));
    expect(sim.tick).toBe(V7_TICKS);
    expect(sim.world.seed).toBe(FIXTURE_SEED);

    // The two states no earlier file could carry: a ceiling that is not
    // unlimited, and an accept flag that is not on.
    // The ceiling the file was written with, plus the three slots the bread
    // rung appended, the four the sheep rung appended and the two the drink
    // rung appended, for goods it had never heard of.
    expect(sim.limits).toEqual([-1, 2, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1]);
    const pile = sim.buildings.find((b) => b.kind === BuildingKind.Stockpile)!;
    expect([pile.acceptLog, pile.acceptPlank, pile.acceptRock, pile.acceptBlock]).toEqual([1, 1, 0, 1]);

    // And what they produce together: exactly two planks in the colony, both
    // in the pile, and a staffed mill standing at its ceiling with the spec's
    // accepted quirk on show — logs parked in an input buffer nothing empties.
    const planks = sim.items.filter((it) => it.type === ItemType.Plank);
    expect(planks).toHaveLength(2);
    expect(planks.every((it) => it.holder === pile.id)).toBe(true);
    const mill = sim.buildings.find((b) => b.kind === BuildingKind.Sawmill)!;
    expect(mill.worker).toBeGreaterThanOrEqual(0);
    expect(mill.millProgress).toBe(-1);
    expect(inspect(sim, mill.id)?.stall).toBe("at-limit");
    expect(sim.items.some((it) => it.type === ItemType.Log && it.holder === mill.id)).toBe(true);
  });

  it("decodes to the store the v8 migration turns it into", async () => {
    const sim = await decode(readFileSync(V7));
    expect(hashSim(sim)).toBe(V7_HASH);
  });

  it("keeps running from where it was saved, and the brake releases when planks are spent", async () => {
    const sim = await decode(readFileSync(V7));
    const mill = sim.buildings.find((b) => b.kind === BuildingKind.Sawmill)!;
    // The Outcome bullet on a loaded save rather than a fresh colony: raise the
    // ceiling to what a House costs and place one. The reloaded mill fills the
    // ceiling, the site takes all four planks, the build spends them, and the
    // count falling back to zero is what restarts the mill — unaided.
    //
    // Raised first, deliberately. Delivered materials still *exist* until the
    // build completes, so a House placed under a ceiling of two would hold the
    // colony's two planks, still count them, and wait for two more the mill
    // may not make — the documented consequence of counting every plank
    // anywhere (docs/changelog/2026-09-07-production-limits-and-filters.md).
    applyCommands(sim, [
      { kind: "setLimit", type: ItemType.Plank, value: BUILDING_DEFS[BuildingKind.House].cost },
      { kind: "place", building: BuildingKind.House, x: mill.x + 4, y: mill.y },
    ]);
    const house = sim.buildings.find((b) => b.kind === BuildingKind.House);
    expect(house).toBeDefined();
    let built = false;
    let milledAfter = false;
    for (let t = 0; t < 3000 && !milledAfter; t++) {
      advanceTick(sim);
      if (house!.state === BuildingState.Active) built = true;
      if (built && mill.millProgress >= 0) milledAfter = true;
    }
    expect(built).toBe(true);
    expect(milledAfter).toBe(true);
    expect(sim.limits[ItemType.Plank]).toBe(BUILDING_DEFS[BuildingKind.House].cost);
  });
});

describe("the committed v8 save", () => {
  it("still loads, with the bread chain running and somebody at lunch", async () => {
    const sim = await decode(readFileSync(V8));
    expect(sim.tick).toBe(V8_TICKS);
    expect(sim.world.seed).toBe(FIXTURE_SEED_V8);

    // The three workshops, standing and staffed — and the mason released, so
    // the colony is three slots deep with two pairs of hands feeding them.
    for (const kind of [BuildingKind.Farm, BuildingKind.Mill, BuildingKind.Oven]) {
      const b = sim.buildings.find((x) => x.kind === kind);
      expect(b?.state).toBe(BuildingState.Active);
      expect(b?.worker).toBeGreaterThanOrEqual(0);
      // The three accept flags a v8-native file was written with.
      expect([b?.acceptGrain, b?.acceptFlour, b?.acceptBread]).toEqual([1, 1, 1]);
    }
    expect(sim.buildings.find((b) => b.kind === BuildingKind.Mason)?.worker).toBe(-1);

    // All three goods, which can only have arrived in order.
    for (const type of [ItemType.Grain, ItemType.Flour, ItemType.Bread]) {
      expect(sim.items.some((it) => it.type === type)).toBe(true);
    }

    // And the state no earlier file could carry: a meal in flight. One
    // colonist with `eating` set and a route to a particular loaf, plus five
    // hunger clocks at five different readings.
    const eaters = sim.colonists.filter((c) => c.eating === 1);
    expect(eaters).toHaveLength(1);
    expect(eaters[0].path.length - eaters[0].step).toBeGreaterThan(0);
    expect(new Set(sim.colonists.map((c) => c.hunger)).size).toBe(sim.colonists.length);
    expect(sim.limits).toHaveLength(13);
  });

  it("decodes to the exact store it was written from", async () => {
    const sim = await decode(readFileSync(V8));
    // → 21daa846 at SAVE_VERSION 12: the 11 → 12 rung **drops every monster** and
    // gives the store its forecast clock
    // (docs/specs/2026-09-17-incursions-from-the-sea.md). Every one of the
    // eleven pinned decode hashes in this file moved for it, and they moved
    // together: the files are frozen, and what changed is what a save now
    // decodes into.
    expect(hashSim(sim)).toBe("21daa846");
  });

  it("keeps running from where it was saved, and the meal finishes", async () => {
    const sim = await decode(readFileSync(V8));
    const eater = sim.colonists.find((c) => c.eating === 1)!;
    const held = sim.items.filter((it) => it.type === ItemType.Bread).length;
    for (let t = 0; t < 600; t++) advanceTick(sim);
    expect(sim.tick).toBe(V8_TICKS + 600);
    // The reloaded errand was walked to its end and the loaf came off the map:
    // the meal is state, not something re-derived on load.
    expect(eater.eating).toBe(0);
    expect(eater.hunger).toBeLessThan(600);
    // And the oven kept baking, so the count did not simply fall.
    expect(sim.items.filter((it) => it.type === ItemType.Bread).length).toBeGreaterThanOrEqual(held - 5);
  });
});

describe("the committed v9 save", () => {
  it("still loads, with a manned Watchtower reading a den", async () => {
    const sim = await decode(readFileSync(V9));
    expect(sim.tick).toBe(V9_TICKS);
    expect(sim.world.seed).toBe(FIXTURE_SEED_V9);

    // The kind no earlier file could hold: 1×1, slot, no recipe.
    const tower = sim.buildings.find((b) => b.kind === BuildingKind.Watchtower)!;
    expect(tower.state).toBe(BuildingState.Active);
    expect([tower.w, tower.h]).toEqual([1, 1]);
    expect(BUILDING_DEFS[BuildingKind.Watchtower].recipe).toBeNull();
    // Nothing is stored in it and nothing ever will be: its output is not a
    // good, so a save that came back with something in its buffer would mean
    // the haul rules had started treating it as a workshop.
    expect(sim.items.some((it) => it.holder === tower.id)).toBe(false);
    expect(tower.millProgress).toBe(-1);

    // And a colonist bound to that slot, standing **inside** it — which is the
    // whole of what makes the coverage below real rather than nominal.
    const watcher = sim.colonists.find((c) => c.id === tower.worker)!;
    expect(watcher.slot).toBe(tower.id);
    expect(watcher.inside).toBe(1);

    // The reloaded colony's picture is whatever its *coast* says, off the file
    // alone. This tower was sited to cover a den, and dens are gone — so what
    // it is asked now is how much shore it can see, which for an inland tower
    // is honestly none (docs/specs/2026-09-17-incursions-from-the-sea.md).
    // The panel's wording for that is `hud.test.ts`'s to pin; what the save
    // owes is the number.
    expect(inspect(sim, tower.id)?.watching).toBe(0);
  });

  it("decodes to the exact store it was written from", async () => {
    const sim = await decode(readFileSync(V9));
    // → e585b94c at SAVE_VERSION 12: the 11 → 12 rung **drops every monster** and
    // gives the store its forecast clock
    // (docs/specs/2026-09-17-incursions-from-the-sea.md). Every one of the
    // eleven pinned decode hashes in this file moved for it, and they moved
    // together: the files are frozen, and what changed is what a save now
    // decodes into.
    expect(hashSim(sim)).toBe("e585b94c");
  });

  it("keeps watching from where it was saved, and blurs the frame it is unstaffed", async () => {
    const sim = await decode(readFileSync(V9));
    const tower = sim.buildings.find((b) => b.kind === BuildingKind.Watchtower)!;
    // Coverage is derived per read, not stored, so it survives a load by being
    // recomputed rather than by having been saved. Put the coming storm on the
    // tower's own doorstep and the picture is sharp.
    sim.stormLanding = tileIndex(tower.x, tower.y, sim.world.size);
    for (let t = 0; t < 200; t++) advanceTick(sim);
    expect(sim.tick).toBe(V9_TICKS + 200);
    expect(forecast(sim).buckets).toBe(WATCH_BUCKETS);

    // The running price, on a loaded colony: pull the watcher and the picture
    // is coarse on the very next read, with nothing banked.
    applyCommands(sim, [{ kind: "unstaff", building: tower.id }]);
    expect(forecast(sim).buckets).toBe(THREAT_BUCKETS);
    expect(forecast(sim).watched).toBe(false);
  });
});

describe("the committed v10 save", () => {
  it("still loads, with the whole cloth chain up and two folk at a fitting", async () => {
    const sim = await decode(readFileSync(V10));
    expect(sim.tick).toBe(V10_TICKS);
    expect(sim.world.seed).toBe(FIXTURE_SEED_V10);

    // The four kinds no earlier file could hold, all standing.
    for (const kind of [BuildingKind.Pasture, BuildingKind.Dairy, BuildingKind.Weaver, BuildingKind.Tailor]) {
      const b = sim.buildings.find((x) => x.kind === kind);
      expect(b?.state).toBe(BuildingState.Active);
      // The four accept flags a v10-native file was written with.
      expect([b?.acceptWool, b?.acceptCloth, b?.acceptClothes, b?.acceptCheese]).toEqual([1, 1, 1, 1]);
    }
    // Seven buildings against five pairs of hands, and never more than three
    // slots filled at once — which is what leaves anybody to haul between them.
    expect(sim.buildings).toHaveLength(7);
    expect(sim.buildings.filter((b) => b.worker >= 0)).toHaveLength(3);

    // All four new goods in the colony at the same instant, which can only have
    // happened in chain order: no wool, no cloth; no cloth, no garment.
    for (const type of [ItemType.Wool, ItemType.Cloth, ItemType.Clothes, ItemType.Cheese]) {
      expect(sim.items.some((it) => it.type === type)).toBe(true);
    }
    expect(sim.limits).toHaveLength(13);

    // And the states no earlier file could carry. Three colonists wearing
    // clothes on **three different wear clocks** — so the field is a live
    // countdown in the file rather than a flag — and two more caught mid-
    // fitting with a route to a garment in flight, which is the id-order race
    // for the tailor's output frozen on camera.
    const dressed = sim.colonists.filter((c) => c.clothes > 0);
    expect(dressed).toHaveLength(3);
    expect(new Set(dressed.map((c) => c.clothes)).size).toBe(3);
    for (const c of dressed) expect(c.clothes).toBeLessThan(CLOTHES_WEAR_TICKS);
    const fitting = sim.colonists.filter((c) => c.dressing === 1);
    expect(fitting).toHaveLength(2);
    for (const c of fitting) {
      expect(c.clothes).toBe(0);
      expect(c.path.length - c.step).toBeGreaterThan(0);
      // Both are slot workers who stepped out through their own door for it,
      // which is the meal errand's machinery carrying the fitting for free.
      expect(c.slot).toBeGreaterThanOrEqual(0);
      expect(c.inside).toBe(0);
    }
  });

  it("decodes to the exact store it was written from", async () => {
    const sim = await decode(readFileSync(V10));
    // → 38bb3d98 at SAVE_VERSION 12: the 11 → 12 rung **drops every monster** and
    // gives the store its forecast clock
    // (docs/specs/2026-09-17-incursions-from-the-sea.md). Every one of the
    // eleven pinned decode hashes in this file moved for it, and they moved
    // together: the files are frozen, and what changed is what a save now
    // decodes into.
    expect(hashSim(sim)).toBe("38bb3d98");
  });

  it("keeps running from where it was saved, and both fittings finish", async () => {
    const sim = await decode(readFileSync(V10));
    const fitting = sim.colonists
      .filter((c) => c.dressing === 1)
      .map((c) => c.id);
    const worn = new Map(sim.colonists.map((c) => [c.id, c.clothes]));
    for (let t = 0; t < 600; t++) advanceTick(sim);
    expect(sim.tick).toBe(V10_TICKS + 600);

    // The reloaded errands were walked to their end and the garments came off
    // the map: a fitting is state, not something re-derived on load.
    for (const id of fitting) {
      const c = sim.colonists.find((x) => x.id === id)!;
      expect(c.dressing).toBe(0);
      expect(c.clothes).toBeGreaterThan(0);
    }
    // And every clock that was already running has ticked down by exactly the
    // ticks that passed — wear is worn, whatever the colonist was doing.
    for (const c of sim.colonists) {
      const before = worn.get(c.id) ?? 0;
      if (before > 600) expect(c.clothes).toBe(before - 600);
    }
  });
});

describe("the committed v11 save", () => {
  it("still loads, with a boosted hive and a cellar that is set", async () => {
    const sim = await decode(readFileSync(V11));
    expect(sim.tick).toBe(V11_TICKS);
    expect(sim.world.seed).toBe(FIXTURE_SEED);

    // The three kinds no earlier file could hold, all standing — and the two
    // accept flags a v11-native file was written with, on every one of them.
    const hive = sim.buildings.find((b) => b.kind === BuildingKind.Hive)!;
    const meadery = sim.buildings.find((b) => b.kind === BuildingKind.Meadery)!;
    for (const b of [hive, meadery]) {
      expect(b.state).toBe(BuildingState.Active);
      expect(b.worker).toBeGreaterThanOrEqual(0);
      expect([b.acceptHoney, b.acceptMead]).toEqual([1, 1]);
    }
    expect(sim.limits).toHaveLength(13);

    // **The state no save has ever held**: a batch length that is a fact about
    // where a building stands. Three fields are up, all of them inside the
    // hive's reach, so the file freezes the boost rather than the def's number.
    const fields = sim.buildings.filter((b) => b.kind === BuildingKind.Flowers);
    expect(fields).toHaveLength(3);
    for (const f of fields) expect(f.state).toBe(BuildingState.Active);
    expect(fieldsInReach(sim, hive)).toBe(HIVE_FIELDS_MAX);
    expect(batchTicks(sim, hive, recipeOf(hive)!)).toBe(HIVE_TICKS_BY_FIELDS[HIVE_FIELDS_MAX]);

    // Both new goods in the colony at once, which can only have happened in
    // chain order: no honey, no mead.
    expect(countItems(sim, ItemType.Honey)).toBeGreaterThan(0);
    // And the cellar **set** — a cup a head and one for the newcomer — which is
    // the number the arrival clock reads and the reason this file exists.
    expect(countItems(sim, ItemType.Mead)).toBeGreaterThanOrEqual(settled(sim) + 1);
    expect(cellarSet(sim)).toBe(true);
  });

  it("decodes to the exact store it was written from", async () => {
    const sim = await decode(readFileSync(V11));
    // → dd0a01aa at SAVE_VERSION 12: the 11 → 12 rung **drops every monster** and
    // gives the store its forecast clock
    // (docs/specs/2026-09-17-incursions-from-the-sea.md). Every one of the
    // eleven pinned decode hashes in this file moved for it, and they moved
    // together: the files are frozen, and what changed is what a save now
    // decodes into.
    expect(hashSim(sim)).toBe("dd0a01aa");
  });

  it("keeps running from where it was saved, and the hive keeps its boosted rate", async () => {
    const sim = await decode(readFileSync(V11));
    const hive = sim.buildings.find((b) => b.kind === BuildingKind.Hive)!;
    const cups = countItems(sim, ItemType.Mead);
    // Four batches at the three-field rate. The reloaded hive counts its fields
    // off the buildings in the file rather than off anything stored on it,
    // which is the whole of "derived per read" surviving a round trip — and the
    // meadery turns what it makes into more cups.
    for (let t = 0; t < HIVE_TICKS_BY_FIELDS[HIVE_FIELDS_MAX] * 4; t++) advanceTick(sim);
    expect(fieldsInReach(sim, hive)).toBe(HIVE_FIELDS_MAX);
    expect(batchTicks(sim, hive, recipeOf(hive)!)).toBe(HIVE_TICKS_BY_FIELDS[HIVE_FIELDS_MAX]);
    expect(countItems(sim, ItemType.Mead)).toBeGreaterThan(cups);
  });
});

/**
 * The drift alarm the pinned hashes cannot sound. A failure here means the
 * store grew or lost a field since a fixture was frozen, so that save no
 * longer decodes into a store this build can assume anything about: bump
 * `SAVE_VERSION` and add the rung that fills the gap.
 */
describe("the fixtures still have the store shape this build produces", () => {
  it("v1, through its migrations", async () => {
    expect(shapeOf(await decode(readFileSync(V1)))).toEqual(shapeOf(replay(v1Script, V1_TICKS, FIXTURE_SEED)));
  });

  it("v2, through its migrations", async () => {
    expect(shapeOf(await decode(readFileSync(V2)))).toEqual(shapeOf(replay(v2Script, V2_TICKS, FIXTURE_SEED)));
  });

  it("v3, through its migration", async () => {
    expect(shapeOf(await decode(readFileSync(V3)))).toEqual(
      shapeOf(replay(v3Script, V3_TICKS, FIXTURE_SEED_V3)),
    );
  });

  it("v5, through its migration", async () => {
    expect(shapeOf(await decode(readFileSync(V5)))).toEqual(
      shapeOf(replay(v5Script, V5_TICKS, FIXTURE_SEED_V5)),
    );
  });

  it("v6, natively — the arrival loop included", async () => {
    expect(shapeOf(await decode(readFileSync(V6)))).toEqual(
      shapeOf(replay(v6Script, V6_TICKS, FIXTURE_SEED_V6)),
    );
  });

  it("v7, natively — ceilings included", async () => {
    expect(shapeOf(await decode(readFileSync(V7)))).toEqual(
      shapeOf(replay(v7Script, V7_TICKS, FIXTURE_SEED)),
    );
  });

  it("v8, natively — the bread chain and a meal in flight", async () => {
    expect(shapeOf(await decode(readFileSync(V8)))).toEqual(
      shapeOf(replay(v8Script, V8_TICKS, FIXTURE_SEED_V8)),
    );
  });

  it("v9, natively — a manned Watchtower included", async () => {
    expect(shapeOf(await decode(readFileSync(V9)))).toEqual(
      shapeOf(replay(v9Script, V9_TICKS, FIXTURE_SEED_V9)),
    );
  });

  it("v10, natively — the cloth chain and two fittings in flight", async () => {
    expect(shapeOf(await decode(readFileSync(V10)))).toEqual(
      shapeOf(replay(v10Script, V10_TICKS, FIXTURE_SEED_V10)),
    );
  });

  it("v11, natively — the boosted hive and the cellar", async () => {
    expect(shapeOf(await decode(readFileSync(V11)))).toEqual(
      shapeOf(replay(v11Script, V11_TICKS, FIXTURE_SEED)),
    );
  });

  it("v4, through the rung that emptied its wilderness", async () => {
    // **No `monsters` in the kinds any more**, and there is nothing left that
    // could put it back: `shapeOf` asserts each kind it is asked about is
    // non-empty, and every save in this folder now decodes with `monsters: []`
    // (docs/specs/2026-09-17-incursions-from-the-sea.md). The monster key set is
    // pinned by `threats/` instead, where the entity is actually made.
    expect(shapeOf(await decode(readFileSync(V4)))).toEqual(
      shapeOf(replay(v4Script, V4_TICKS, FIXTURE_SEED_V4)),
    );
  });
});
