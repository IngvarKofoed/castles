import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyCommands } from "../commands";
import { hashSim } from "../hash";
import { populationCap, settled } from "../settlers";
import { testBuilding } from "../test-sim";
import { BuildingKind, BuildingState, ItemType, TaskKind, type Sim } from "../store";
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
  V1_TICKS,
  V2_TICKS,
  V3_TICKS,
  V4_TICKS,
  V5_TICKS,
  V6_TICKS,
  replay,
  v1Script,
  v2Script,
  v3Script,
  v4Script,
  v5Script,
  v6Script,
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

type EntityKind = "colonists" | "items" | "buildings" | "tasks" | "monsters";

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
    const sim = await decode(readFileSync(V1));
    expect(hashSim(sim)).toBe("ab0c5574");
    // A v1 colony wakes up in a wilderness rather than in an empty world.
    expect(sim.monsters.length).toBeGreaterThan(0);
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
    // e0a0ad53 → 83891a24 at SAVE_VERSION 6 for the `patience` rung.
    const sim = await decode(readFileSync(V2));
    expect(hashSim(sim)).toBe("83891a24");
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
    // 7dcf3387 → 9935f38b at SAVE_VERSION 5, for the same 4 → 5 rung, and
    // 9935f38b → 8c8cb6fc at 6 for the `patience` one.
    const sim = await decode(readFileSync(V3));
    expect(hashSim(sim)).toBe("8c8cb6fc");
    // The half of that rung nothing else would catch: a migrated colony that
    // came through with an empty `monsters` array would be a save of a game
    // that has no threats in it at all, and nothing would ever say so.
    expect(sim.monsters.length).toBeGreaterThan(0);
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
  it("still loads, with its wilds mid-rhythm and its wall still wounded", async () => {
    const sim = await decode(readFileSync(V4));
    expect(sim.tick).toBe(V4_TICKS);
    expect(sim.world.seed).toBe(FIXTURE_SEED_V4);

    // A full wilderness, every monster carrying its own hours and its own
    // route — the state a save would most plausibly lose.
    expect(sim.monsters.length).toBeGreaterThan(0);
    expect(new Set(sim.monsters.map((m) => m.restTicks)).size).toBeGreaterThan(1);
    for (const m of sim.monsters) {
      expect(m.phaseTicks).toBeGreaterThanOrEqual(0);
      expect(m.circuit.length).toBeGreaterThan(0);
    }
    // Routes in flight, which is the other thing a save could quietly lose.
    expect(sim.monsters.some((m) => m.path.length > 0)).toBe(true);

    // A wounded segment the monster has walked away from, and somebody queued
    // to mend it — the state between a prowl ending and the repair landing.
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
    // give-up clock its own field.
    const sim = await decode(readFileSync(V4));
    expect(hashSim(sim)).toBe("aee29fc7");
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

  it("keeps running from where it was saved, and the siege resolves", async () => {
    const sim = await decode(readFileSync(V4));
    const wounded = [...sim.wallDamageMap].findIndex((v) => v > 0);
    const was = sim.wallDamageMap[wounded];
    for (let t = 0; t < 600; t++) advanceTick(sim);
    expect(sim.tick).toBe(V4_TICKS + 600);
    // The clocks kept running and the labour loop picked the siege back up:
    // the wounded segment is mended or gone, not frozen where the save left it.
    expect(sim.monsters.some((m) => m.phaseTicks !== m.restTicks && m.phaseTicks !== m.prowlTicks)).toBe(true);
    expect(sim.wallDamageMap[wounded]).not.toBe(was);
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
    // keeping.
    const sim = await decode(readFileSync(V5));
    expect(hashSim(sim)).toBe("1aba9400");
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

  it("decodes to the exact store it was written from", async () => {
    const sim = await decode(readFileSync(V6));
    expect(hashSim(sim)).toBe("7206746a");
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

/**
 * The drift alarm the pinned hashes cannot sound. A failure here means the
 * store grew or lost a field since a fixture was frozen, so that save no
 * longer decodes into a store this build can assume anything about: bump
 * `SAVE_VERSION` and add the rung that fills the gap.
 */
describe("the fixtures still have the store shape this build produces", () => {
  it("v1, through its migrations", async () => {
    expect(shapeOf(await decode(readFileSync(V1)))).toEqual(shapeOf(replay(v1Script, V1_TICKS, FIXTURE_SEED, true)));
  });

  it("v2, through its migrations", async () => {
    expect(shapeOf(await decode(readFileSync(V2)))).toEqual(shapeOf(replay(v2Script, V2_TICKS, FIXTURE_SEED, true)));
  });

  it("v3, through its migration", async () => {
    expect(shapeOf(await decode(readFileSync(V3)))).toEqual(
      shapeOf(replay(v3Script, V3_TICKS, FIXTURE_SEED_V3, true)),
    );
  });

  it("v5, through its migration", async () => {
    const kinds = [...OLD_KINDS, "monsters"] as const;
    expect(shapeOf(await decode(readFileSync(V5)), kinds)).toEqual(
      shapeOf(replay(v5Script, V5_TICKS, FIXTURE_SEED_V5), kinds),
    );
  });

  it("v6, natively — the arrival loop included", async () => {
    const kinds = [...OLD_KINDS, "monsters"] as const;
    expect(shapeOf(await decode(readFileSync(V6)), kinds)).toEqual(
      shapeOf(replay(v6Script, V6_TICKS, FIXTURE_SEED_V6), kinds),
    );
  });

  it("v4, natively — monsters included", async () => {
    // The one comparison that can carry the monster key set, because it is the
    // only recipe written for a world that has any.
    const kinds = [...OLD_KINDS, "monsters"] as const;
    expect(shapeOf(await decode(readFileSync(V4)), kinds)).toEqual(
      shapeOf(replay(v4Script, V4_TICKS, FIXTURE_SEED_V4), kinds),
    );
  });
});
