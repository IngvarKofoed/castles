import { describe, expect, it } from "vitest";
import { canPlace } from "./buildings";
import { applyCommands } from "./commands";
import type { Command } from "./commands";
import { hashSim } from "./hash";
import { readout } from "./know";
import { decode, encode } from "./save/codec";
import { spawnItem } from "./items";
import { countItems } from "./items";
import { bedsBuilt, populationCap, settled, tableSet, wanderer } from "./settlers";
import { BuildingKind, BuildingState, ItemType, createSim, type Sim } from "./store";
import { flatSim, testBuilding, testColonist, testMonster } from "./test-sim";
import { advanceTick } from "./tick";
import { MonsterPhase } from "./store";
import { STARTING_COLONISTS, WANDERER_PATIENCE } from "./tuning";
import { WallState } from "./walls";
import { recomputeEnclosure } from "./walls/enclosure";
import { Terrain, tileIndex } from "./world/world";

/**
 * Population inflow, pinned from both ends: two scripted golden runs on real
 * maps, and unit tests for the arithmetic and the two failure modes
 * (docs/specs/2026-09-07-housing-wanderers.md).
 *
 * **Two runs, because the interesting outcomes are mutually exclusive.** One
 * seed's wanderer walks in and settles; another's is caught by an orc halfway.
 * Both are found by **seed selection** rather than by rigging a spawn — the
 * method the threat tier established — so what is pinned is the game and not a
 * staged scenario. `tick.test.ts` keeps the labour pin on its own quiet seed
 * and is untouched by either.
 *
 * The script both runs share is the shortest honest road to a House: chop,
 * stockpile, sawmill, staff it, and place the House once planks are coming out
 * — which is the point of the building. It cannot be shortened much: the
 * arrival cannot begin until the House is *active*, and the walk in from the
 * coast is a hundred tiles of real ground.
 */

const SETTLING = 20260908;
/**
 * The death-en-route seed, **re-picked at the bread step**: on 20260912 the
 * wanderer now walks in unharmed, because meals move everybody's timings by a
 * few seconds and an interception is decided in seconds
 * (docs/specs/2026-09-08-bread-economy.md). 20260918 is the same scenario found
 * the same way — by seed selection rather than by staging a spawn — and it is a
 * better one: the orc catches this one early, and the replacement is on the
 * road before the run ends.
 */
const CAUGHT = 20260918;
/** Long enough for the first wanderer to settle **and** the second to be on
 *  the road, which is what makes "a second follows while beds remain" an
 *  observable rather than a promise. */
const SETTLING_TICKS = 2400;
/** Long enough for the death and for the countdown to restart after it — the
 *  recovery loop is the whole point of the step, so it sits inside the pin. */
const CAUGHT_TICKS = 1950;

const CENTRE = 128;
const SIZE = 256;

/** Tree tiles nearest the colony, by growing rings — a pure function of the
 *  store, like every choice the scripts in this repo make. */
function trees(sim: Sim, count: number): number[] {
  const out: number[] = [];
  for (let r = 1; r < 40 && out.length < count; r++) {
    for (let dy = -r; dy <= r && out.length < count; dy++) {
      for (let dx = -r; dx <= r && out.length < count; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const i = tileIndex(CENTRE + dx, CENTRE + dy, SIZE);
        if (sim.world.treeMap[i]) out.push(i);
      }
    }
  }
  return out;
}

/** The nearest site this kind fits, kept clear of what is already built. */
function site(sim: Sim, kind: 0 | 1 | 3): [number, number] | null {
  for (let r = 2; r < 30; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = CENTRE + dx;
        const y = CENTRE + dy;
        if (sim.buildings.some((b) => Math.abs(x - b.x) < 4 && Math.abs(y - b.y) < 4)) continue;
        if (canPlace(sim, kind, x, y)) return [x, y];
      }
    }
  }
  return null;
}

function script(sim: Sim): Command[] {
  switch (sim.tick) {
    case 0:
      return [{ kind: "designateChop", tiles: trees(sim, 40) }];
    case 5: {
      const s = site(sim, BuildingKind.Stockpile);
      return s ? [{ kind: "place", building: BuildingKind.Stockpile, x: s[0], y: s[1] }] : [];
    }
    case 200: {
      const s = site(sim, BuildingKind.Sawmill);
      return s ? [{ kind: "place", building: BuildingKind.Sawmill, x: s[0], y: s[1] }] : [];
    }
    case 600: {
      const mill = sim.buildings.find((b) => b.kind === BuildingKind.Sawmill);
      return mill && mill.state === BuildingState.Active ? [{ kind: "staff", building: mill.id }] : [];
    }
    // Placed once the mill is cutting, so the site is fed planks rather than
    // sitting as a blueprint waiting for a chain that has not started.
    case 900: {
      const s = site(sim, BuildingKind.House);
      return s ? [{ kind: "place", building: BuildingKind.House, x: s[0], y: s[1] }] : [];
    }
    default:
      return [];
  }
}

/**
 * Keep a few loaves in the colony, topped up as they are eaten.
 *
 * The arrival gate now wants bread for everyone plus the newcomer
 * (docs/specs/2026-09-08-bread-economy.md), so a colony with no food chain
 * stops growing the moment its opening provisions run out — three game-days
 * in, which is *inside* both runs below. Left unfed neither of them would
 * produce an arrival to watch at all.
 *
 * So the larder is **stocked rather than farmed**: the bread chain has its own
 * pinned run (`economy/bread.test.ts`) and the gate has its own tests below,
 * while what these two exist for is the walk — the beach, the hundred tiles,
 * the orc on the way. Deterministic, like every other choice these scripts
 * make: `spawnItem`'s drop spiral draws nothing from the PRNG.
 */
function larder(sim: Sim, want: number): void {
  for (let n = countItems(sim, ItemType.Bread); n < want; n++) spawnItem(sim, ItemType.Bread, CENTRE, CENTRE);
}

/** Loaves kept in the colony: comfortably above the gate's `settled + 1` for
 *  the seven folk these runs can reach, and small enough that hauling it is
 *  not what the pool spends its day on. */
const LARDER = 10;

/**
 * What the run *did*, watched as it happened. The interesting facts are all
 * transient — a landing tile is walked off, a spawn tick is gone a tick later
 * — so they are gathered by the same pass that produces the end state rather
 * than by a second identical run (the encounter's lesson).
 */
interface Trace {
  sim: Sim;
  /** Where the first wanderer was put down, and when. */
  landing: [number, number] | null;
  spawnedAt: number;
  /** When the colony first grew, and how many wanderers appeared in all. */
  settledAt: number;
  arrivals: number;
}

function run(seed: number, ticks: number): Trace {
  const sim = createSim(seed);
  const out: Trace = { sim, landing: null, spawnedAt: -1, settledAt: -1, arrivals: 0 };
  const seen = new Set<number>();
  let folk = settled(sim);
  for (let t = 0; t < ticks; t++) {
    // Topped up on a fixed cadence rather than every tick, so the run pays for
    // one scan a game-minute instead of one a tick.
    // `settled + 2` is the floor rather than a courtesy: the gate wants
    // `settled + 1`, so a run that ever grows past `LARDER` folk would drop
    // below its own bar and stop producing arrivals again — the exact failure
    // this larder exists to prevent, recurring silently.
    if (t % 200 === 0) larder(sim, Math.max(LARDER, settled(sim) + 2));
    advanceTick(sim, script(sim));
    const walking = wanderer(sim);
    if (walking && !seen.has(walking.id)) {
      seen.add(walking.id);
      out.arrivals++;
      if (!out.landing) {
        out.landing = [Math.floor(walking.x), Math.floor(walking.y)];
        out.spawnedAt = t;
      }
    }
    const now = settled(sim);
    if (now > folk && out.settledAt < 0) out.settledAt = t;
    folk = now;
  }
  return out;
}

/**
 * Each run computed **once** and shared by every assertion that only reads it
 * — the pattern `tick.test.ts` and the encounter both had to adopt: the run is
 * the whole cost of the file, and a run per test is what put this suite near
 * its timeout twice already. The byte-identical checks and the drift test
 * build their own, because each genuinely needs an independent one.
 */
let settlingRun: Trace | null = null;
let caughtRun: Trace | null = null;
const settling = (): Sim => (settlingWatched().sim);
const caught = (): Sim => (caughtWatched().sim);
const settlingWatched = (): Trace => (settlingRun ??= run(SETTLING, SETTLING_TICKS));
const caughtWatched = (): Trace => (caughtRun ??= run(CAUGHT, CAUGHT_TICKS));

const graves = (sim: Sim): number => [...sim.graveMap].filter(Boolean).length;
const house = (sim: Sim) => sim.buildings.find((b) => b.kind === BuildingKind.House);

describe("the scripted settling", () => {
  it("replays byte-identically", () => {
    expect(hashSim(settling())).toBe(hashSim(run(SETTLING, SETTLING_TICKS).sim));
  });

  it("holds its golden hash", () => {
    // A hash change here is a change to housing or to the arrival loop. If this
    // fails, say in the changelog what moved and why — the assertions below are
    // what tell you whether it moved for a reason.
    //
    // 24628f58 → 09cadca1 when the patience clock became its own field
    // (SAVE_VERSION 6): one more number per colonist, and no behaviour change —
    // nobody in this run is ever stuck, so every clock reads 0 throughout.
    //
    // 09cadca1 → e3cf9525 with production ceilings (SAVE_VERSION 7,
    // docs/changelog/2026-09-07-production-limits-and-filters.md): the store
    // gained `limits`, all four slots `-1`. Shape only — this run sets no
    // ceiling, so the mill fills the House exactly as before.
    //
    // e3cf9525 → 2cecf74f with the bread economy (SAVE_VERSION 8,
    // docs/changelog/2026-09-08-bread-economy.md). Shape **and** behaviour, and
    // the behaviour is the point of the step: every colonist gained `hunger`
    // and `eating`, the store's `limits` grew three slots, the colony opens
    // holding provision bread, and the run now feeds itself (see `larder`) —
    // so folk break off to eat, and the arrival gate asks for a loaf per head
    // before anybody may land. The assertions below are what say the number
    // moved for that and not for something quiet: the walk, the settle, the
    // second arrival and the cap are all unchanged in kind, only later.
    //
    // 2cecf74f → 3d64cb83 with the sheep chain (SAVE_VERSION 10,
    // docs/changelog/2026-09-11-sheep-and-clothes.md). **Shape only**, and
    // proved rather than argued: strip the two new colonist fields and the four
    // new `limits` slots back out and this run hashes to 2cecf74f exactly. It could
    // not be otherwise — no script here builds a Tailor, so no garment exists,
    // so the composed `workTicks` pays every tick what the old boolean gate
    // paid, and every assertion in this file is unchanged and still passes.
    expect(hashSim(settling())).toBe("3d64cb83");
  });

  it("builds a House out of planks, which is what planks are for", () => {
    const sim = settling();
    const h = house(sim);
    expect(h?.state).toBe(BuildingState.Active);
    // Four planks went into it: the blueprint flipped to `Building` on the
    // count of *planks*, which is the whole of what `costType` buys. Counted
    // as "the mill made more than the house ate" rather than as a stock
    // figure, since the colony keeps milling afterwards.
    expect(sim.items.some((it) => it.type === ItemType.Plank)).toBe(true);
    expect(bedsBuilt(sim)).toBe(2);
    expect(populationCap(sim)).toBe(STARTING_COLONISTS + 2);
  });

  it("lands a wanderer on a beach and walks them in to settle as a pool worker", () => {
    const { sim, landing, spawnedAt, settledAt } = settlingWatched();
    expect(landing).not.toBeNull();
    const [lx, ly] = landing ?? [0, 0];
    // They arrived **by sea**: put down on sand, beside water, out where the
    // island ends rather than anywhere near the colony.
    expect(sim.world.tmap[tileIndex(lx, ly, SIZE)]).toBe(Terrain.Sand);
    expect(Math.abs(lx - CENTRE) + Math.abs(ly - CENTRE)).toBeGreaterThan(80);
    // And then walked, for a long time, before the folk count moved.
    expect(settledAt).toBeGreaterThan(spawnedAt + 200);

    // One more pair of hands than the colony started with, and nobody died to
    // pay for it.
    expect(settled(sim)).toBe(STARTING_COLONISTS + 1);
    expect(graves(sim)).toBe(0);
    // The settler is in the pool, not in a slot — every arrival is a standard
    // pool worker, with no skills and no name.
    const newest = sim.colonists.filter((c) => c.dest < 0).reduce((a, b) => (a.id > b.id ? a : b));
    expect(newest.id).toBeGreaterThan(STARTING_COLONISTS);
    expect(newest.slot).toBe(-1);
    expect(newest.inside).toBe(0);
    expect(newest.dest).toBe(-1);
  });

  it("gives the ribbon its cap the moment the first House stands", () => {
    const sim = settling();
    const r = readout(sim);
    expect(r.folk).toBe(STARTING_COLONISTS + 1);
    expect(r.cap).toBe(STARTING_COLONISTS + 2);
    // The one in transit is in none of the four numbers, which is what stops
    // the labour meter inventing a phantom slot worker.
    expect(wanderer(sim)).not.toBeNull();
    expect(r.folk).toBe(sim.colonists.length - 1);
    expect(r.slots).toBe(r.folk - r.pool);
    expect(r.slots).toBe(1);
  });

  it("sends a second while beds remain", () => {
    // The bed the first settler did not take: one wanderer at a time, so the
    // second is still walking at the end of the run.
    const { sim, arrivals } = settlingWatched();
    expect(arrivals).toBe(2);
    const walking = wanderer(sim);
    expect(walking?.dest).toBe(house(sim)?.id);
    expect(sim.wandererTimer).toBe(-1);
    expect(settled(sim)).toBeLessThan(populationCap(sim));
  });
});

describe("the scripted death en route", () => {
  it("replays byte-identically", () => {
    expect(hashSim(caught())).toBe(hashSim(run(CAUGHT, CAUGHT_TICKS).sim));
  });

  it("holds its golden hash", () => {
    // 08abe6b8 → b740df36 for the v6 `patience` field, exactly as above, and
    // b740df36 → 70cb202a for the v7 `limits` array — shape only, as above.
    //
    // 70cb202a → 3050f53e at the bread step, and this one is **a different
    // colony**: the run is on a new seed and thirty ticks longer, because meals
    // moved every timing by a few seconds and 20260912's orc now misses the
    // wanderer entirely (see `CAUGHT`). What is pinned is the same scenario,
    // re-found the same way.
    //
    // 3050f53e → 78fd60d6 with the sheep chain (SAVE_VERSION 10,
    // docs/changelog/2026-09-11-sheep-and-clothes.md). **Shape only**, and
    // proved rather than argued: strip the two new colonist fields and the four
    // new `limits` slots back out and this run hashes to 3050f53e exactly. It could
    // not be otherwise — no script here builds a Tailor, so no garment exists,
    // so the composed `workTicks` pays every tick what the old boolean gate
    // paid, and every assertion in this file is unchanged and still passes.
    expect(hashSim(caught())).toBe("78fd60d6");
  });

  it("loses the wanderer to an orc, and buries them like anyone", () => {
    const { sim, landing } = caughtWatched();
    expect(sim.world.tmap[tileIndex(landing?.[0] ?? 0, landing?.[1] ?? 0, SIZE)]).toBe(Terrain.Sand);
    // The colony itself never grew and never shrank: the grave is the
    // wanderer's, which is what makes this the death-en-route run rather than
    // a colony being eaten at home.
    expect(settled(sim)).toBe(STARTING_COLONISTS);
    expect(graves(sim)).toBe(1);
    // Out in the wilds, not at the door — the walk is where the risk is.
    // Measured as walking distance from the House rather than as a difference
    // in x alone: which axis the coast lies on is a property of the seed, and
    // the claim is about distance.
    const grave = [...sim.graveMap].findIndex(Boolean);
    const h = house(sim);
    expect(h).toBeDefined();
    const away = Math.abs((grave % SIZE) - (h?.x ?? 0)) + Math.abs(Math.floor(grave / SIZE) - (h?.y ?? 0));
    expect(away).toBeGreaterThan(20);
    // No announcement anywhere: nothing in the store records a death but the
    // marker and the missing pair of hands.
    expect(sim.colonists.some((c) => c.dest >= 0 && c.patience >= WANDERER_PATIENCE)).toBe(false);
  });

  it("starts the next countdown, so the colony can refill the room", () => {
    // The whole point of the step: a death is not a ratchet. The clock
    // restarted without anything special-casing "died", and somebody else is
    // already on the road.
    const { sim, arrivals } = caughtWatched();
    expect(arrivals).toBe(2);
    expect(wanderer(sim)).not.toBeNull();
    expect(settled(sim)).toBeLessThan(populationCap(sim));
  });
});

describe("a wanderer survives a save and load mid-walk", () => {
  // Through **both** runs, because the state at risk differs: one has a
  // wanderer with a live route and a fresh countdown behind it, the other has a
  // monster committed to a chase. `dest`, the patience clock and
  // `wandererTimer` are all store fields a save could quietly lose.
  for (const [name, seed, ticks, mid] of [
    ["settling", SETTLING, SETTLING_TICKS, 1500],
    ["caught", CAUGHT, CAUGHT_TICKS, 1600],
  ] as const) {
    it(`carries the ${name} run through a reload`, async () => {
      const straight = createSim(seed);
      // The same larder cadence `run` uses, or these two colonies stop growing
      // three days in and there is no wanderer left to carry through anything.
      for (let t = 0; t < mid; t++) {
        if (t % 200 === 0) larder(straight, Math.max(LARDER, settled(straight) + 2));
        advanceTick(straight, script(straight));
      }
      expect(wanderer(straight)).not.toBeNull();

      const restored = await decode(await encode(straight, "test"));
      expect(hashSim(restored)).toBe(hashSim(straight));

      for (let t = mid; t < ticks; t++) {
        // Both sides fed identically: the top-up is part of the run, so a
        // divergence here would be the larder's and not the save format's.
        if (t % 200 === 0) {
          larder(straight, Math.max(LARDER, settled(straight) + 2));
          larder(restored, Math.max(LARDER, settled(restored) + 2));
        }
        advanceTick(straight, script(straight));
        advanceTick(restored, script(restored));
      }
      expect(hashSim(restored)).toBe(hashSim(straight));
    });
  }
});

describe("a running patience clock is state, not a recomputation", () => {
  // The v6 fixture carries `patience` at 0 on every colonist, because nothing
  // on that seed ever blocks the walk — so a *running* clock is pinned here
  // instead, on a wanderer caught mid-wait. Through `structuredClone` rather
  // than the codec: `assertSim` refuses a hand-built 24-tile world, and the
  // codec has no per-field code anyway — the v6 fixture is what proves the
  // field crosses the format.
  it("clones mid-wait, and the copy runs the same wait down to the same tick", () => {
    const sim = coastSim();
    homeAt(sim, 10, 10);
    for (let t = 0; t < 400 && !wanderer(sim); t++) advanceTick(sim);
    const size = sim.world.size;
    for (let y = 0; y < size; y++) sim.wallMap[tileIndex(4, y, size)] = WallState.Stone;
    recomputeEnclosure(sim);
    for (let t = 0; t < 300; t++) advanceTick(sim);

    const waited = wanderer(sim)?.patience ?? 0;
    expect(waited).toBeGreaterThan(200);
    const copy = structuredClone(sim);
    expect(hashSim(copy)).toBe(hashSim(sim));
    expect(wanderer(copy)?.patience).toBe(waited);

    // The clock runs out on the copy exactly when it does on the original: it
    // is carried, not re-derived from how long the walk has been going.
    for (let t = 0; t < WANDERER_PATIENCE; t++) {
      advanceTick(sim);
      advanceTick(copy);
      expect(wanderer(copy)?.patience ?? -1).toBe(wanderer(sim)?.patience ?? -1);
    }
    expect(wanderer(sim)).toBeNull();
    expect(hashSim(copy)).toBe(hashSim(sim));
  });
});

// ------------------------------------------------------------------- units

/**
 * A flat world with a sea down its west edge and a sand strip beside it, so
 * there is a genuine coast to land on — **and a larder in the far corner**,
 * because the arrival gate now asks for a loaf per head plus one and every
 * test below is about an arrival. Clear of the tiles these tests put buildings
 * on, and generous enough to feed a full colony for the few game-days they run.
 */
function coastSim(size = 24): Sim {
  const sim = flatSim(size);
  for (let n = 0; n < 30; n++) spawnItem(sim, ItemType.Bread, size - 4, 2);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < 2; x++) {
      const i = tileIndex(x, y, size);
      sim.world.tmap[i] = Terrain.Water;
      sim.world.hmap[i] = 1;
    }
    const shore = tileIndex(2, y, size);
    sim.world.tmap[shore] = Terrain.Sand;
    sim.world.hmap[shore] = 3;
  }
  recomputeEnclosure(sim);
  return sim;
}

/** A finished House at (x, y). */
function homeAt(sim: Sim, x: number, y: number, patch = {}) {
  const b = testBuilding({ kind: BuildingKind.House, x, y, ...patch });
  sim.buildings.push(b);
  return b;
}

describe("the population cap", () => {
  it("counts the beds of active Houses only", () => {
    const sim = flatSim();
    expect(populationCap(sim)).toBe(STARTING_COLONISTS);

    homeAt(sim, 4, 4);
    expect(populationCap(sim)).toBe(STARTING_COLONISTS + 2);

    // A blueprint and a half-built House are promises, not beds.
    homeAt(sim, 8, 4, { id: 100, state: BuildingState.Blueprint });
    homeAt(sim, 8, 8, { id: 101, state: BuildingState.Building });
    expect(populationCap(sim)).toBe(STARTING_COLONISTS + 2);

    homeAt(sim, 4, 8, { id: 102 });
    expect(populationCap(sim)).toBe(STARTING_COLONISTS + 4);
  });

  it("counts nothing for a workshop or a stockpile, however many there are", () => {
    const sim = flatSim();
    sim.buildings.push(testBuilding({ x: 4, y: 4 }));
    sim.buildings.push(testBuilding({ id: 100, kind: BuildingKind.Sawmill, x: 8, y: 4 }));
    sim.buildings.push(testBuilding({ id: 101, kind: BuildingKind.Mason, x: 8, y: 8 }));
    expect(bedsBuilt(sim)).toBe(0);
    expect(populationCap(sim)).toBe(STARTING_COLONISTS);
  });
});

describe("the bread gate", () => {
  it("wants a loaf for everyone plus the newcomer", () => {
    // The arithmetic, stated once: `settled + 1`, so the table is set for the
    // colony *and* the one arriving (docs/specs/2026-09-08-bread-economy.md).
    const sim = flatSim();
    // **Except with nobody left**, which is not a softening: with no colonists
    // there is nobody to staff a farm, so the bar would be unsatisfiable and
    // the arrival loop — the housing step's recovery from a wipe — would stop
    // for good. An empty colony always admits one pair of hands.
    expect(settled(sim)).toBe(0);
    expect(tableSet(sim)).toBe(true);

    for (let i = 0; i < 3; i++) {
      sim.colonists.push(testColonist({ id: sim.nextId++, x: 6.5, y: 6.5 }));
    }
    // Three settled folk and no bread: now the bar binds.
    expect(settled(sim)).toBe(3);
    expect(tableSet(sim)).toBe(false);
    // Three loaves is still one short — the newcomer's.
    for (let i = 0; i < 3; i++) spawnItem(sim, ItemType.Bread, 8, 8);
    expect(countItems(sim, ItemType.Bread)).toBe(3);
    expect(tableSet(sim)).toBe(false);
    spawnItem(sim, ItemType.Bread, 8, 8);
    expect(tableSet(sim)).toBe(true);
  });

  it("holds the countdown shut, and opens it the moment the loaves exist", () => {
    // The gate is checked beside the cap check and *before* the clock, so a
    // colony short of bread is not banking arrivals it will get all at once.
    const sim = coastSim();
    homeAt(sim, 10, 10);
    for (const loaf of sim.items.filter((it) => it.type === ItemType.Bread)) {
      sim.items.splice(sim.items.indexOf(loaf), 1);
    }
    // Somebody lives here, so the empty-colony exemption does not apply and the
    // bar is two loaves: theirs and the newcomer's.
    sim.colonists.push(testColonist({ id: sim.nextId++, x: 10.5, y: 13.5 }));
    const parked = sim.wandererTimer;
    for (let t = 0; t < 400; t++) advanceTick(sim);
    expect(wanderer(sim)).toBeNull();
    // The clock is exactly where it was left — paused, not spent.
    expect(sim.wandererTimer).toBe(parked);

    // Two loaves, and the road opens again from where the clock stopped.
    spawnItem(sim, ItemType.Bread, 20, 2);
    spawnItem(sim, ItemType.Bread, 20, 2);
    for (let t = 0; t < 400 && !wanderer(sim); t++) advanceTick(sim);
    expect(wanderer(sim)).not.toBeNull();
  });
});

describe("arrivals", () => {
  it("stop at the cap and start again when a death opens room", () => {
    const sim = coastSim();
    homeAt(sim, 10, 10);
    // A colony already at its cap: seven folk against five plus two beds.
    for (let i = 0; i < STARTING_COLONISTS + 2; i++) {
      sim.colonists.push(testColonist({ id: sim.nextId++, x: 10.5, y: 12.5 }));
    }
    for (let t = 0; t < 800; t++) advanceTick(sim);
    // Nobody came, and the clock is exactly where it started: the countdown
    // does not run while the colony is full, so a death is not paid off with
    // banked time.
    expect(wanderer(sim)).toBeNull();
    expect(sim.wandererTimer).toBeGreaterThan(0);

    sim.colonists.pop();
    for (let t = 0; t < 800 && !wanderer(sim); t++) advanceTick(sim);
    // The room a death opened is refilled, which is the recovery loop.
    const arrival = wanderer(sim);
    expect(arrival).not.toBeNull();
    expect(sim.world.tmap[tileIndex(Math.floor(arrival?.x ?? 0), Math.floor(arrival?.y ?? 0), 24)]).toBe(Terrain.Sand);
  });

  it("never land on a shore a prowling monster is watching", () => {
    const sim = coastSim();
    homeAt(sim, 10, 10);
    // Three orcs awake on the sand, spaced so their notice radii cover the
    // whole strip: there is nowhere calm to put anybody down.
    for (let k = 0; k < 3; k++) {
      sim.monsters.push(testMonster({ id: 900 + k, lairX: 2, lairY: 4 + k * 8 }));
    }
    for (let t = 0; t < 600; t++) advanceTick(sim);
    expect(wanderer(sim)).toBeNull();
    // The countdown is spent and waiting: the attempt retries every tick
    // rather than rescheduling, so the shore opens the moment the orc sleeps.
    expect(sim.wandererTimer).toBe(0);

    for (const m of sim.monsters) {
      m.phase = MonsterPhase.Rest;
      m.phaseTicks = 10_000;
    }
    advanceTick(sim);
    // A resting monster notices nothing, so it closes no shore.
    expect(wanderer(sim)).not.toBeNull();
  });

  it("give up and leave, with no grave, when nothing leads to the door", () => {
    const sim = coastSim();
    homeAt(sim, 10, 10);
    for (let t = 0; t < 400 && !wanderer(sim); t++) advanceTick(sim);
    const walking = wanderer(sim);
    expect(walking).not.toBeNull();

    // Seal the coast off behind them: a full-height stone line with no gate,
    // which is exactly the "wall the colony shut" case.
    const size = sim.world.size;
    for (let y = 0; y < size; y++) sim.wallMap[tileIndex(4, y, size)] = WallState.Stone;
    recomputeEnclosure(sim);

    // The clock runs on its own field, and only while they are stuck.
    for (let t = 0; t < 30; t++) advanceTick(sim);
    expect(walking?.patience).toBeGreaterThan(0);
    expect(walking?.work).toBe(0);

    for (let t = 0; t < WANDERER_PATIENCE + 40 && wanderer(sim); t++) advanceTick(sim);
    // Gone, quietly: no grave, no message, nobody settled.
    expect(wanderer(sim)).toBeNull();
    expect(graves(sim)).toBe(0);
    expect(settled(sim)).toBe(0);
    // And the countdown running again on the next tick — a give-up resolves
    // the attempt exactly as a settle or a death does.
    advanceTick(sim);
    expect(sim.wandererTimer).toBeGreaterThanOrEqual(0);
  });

  it("neither advance nor reset the clock while a wanderer is running from an orc", () => {
    // The un-punned clock's whole point (docs/specs/2026-09-07-housing-wanderers.md,
    // the 2026-09-07 amendment). `patience` advances in exactly one place — the
    // tick where a repath failed — so a flee cannot advance it (nobody times
    // out for the time they spent running) and cannot reset it either (running
    // in a circle is not progress). On `work` neither half was stated: the
    // no-advance came from `stepWanderer` not running, and the no-reset from
    // `abandonForFlight` happening to return early for a colonist with no task.
    const sim = coastSim();
    homeAt(sim, 10, 10);
    for (let t = 0; t < 400 && !wanderer(sim); t++) advanceTick(sim);
    const walking = wanderer(sim);
    expect(walking).not.toBeNull();

    // Sealed out, so the clock starts running.
    const size = sim.world.size;
    for (let y = 0; y < size; y++) sim.wallMap[tileIndex(4, y, size)] = WallState.Stone;
    recomputeEnclosure(sim);
    for (let t = 0; t < 200; t++) advanceTick(sim);
    const waited = walking?.patience ?? 0;
    expect(waited).toBeGreaterThan(100);

    // A prowler on the far side of the wall: near enough to run from — flee
    // knows about enclosure and nothing else, so a wall between them changes
    // nothing — and unable to reach them, so this is a flee and not a death.
    sim.monsters.push(testMonster({ lairX: 5, lairY: Math.floor(walking?.y ?? 12) }));
    for (let t = 0; t < 20; t++) advanceTick(sim);
    expect(wanderer(sim)).not.toBeNull();
    expect(walking?.patience).toBe(waited);
    expect(walking?.work).toBe(0);

    // It beds down, and the wait picks up where it left off rather than
    // starting over: what is left of two game-days, not two more of them.
    for (const m of sim.monsters) {
      m.phase = MonsterPhase.Rest;
      m.phaseTicks = 100_000;
    }
    let ran = 0;
    for (; ran < WANDERER_PATIENCE + 200 && wanderer(sim); ran++) advanceTick(sim);
    expect(wanderer(sim)).toBeNull();
    expect(ran).toBeLessThan(WANDERER_PATIENCE);
    expect(graves(sim)).toBe(0);
  });

  it("hold the patience clock at zero while a wanderer is actually walking", () => {
    const sim = coastSim();
    homeAt(sim, 10, 10);
    for (let t = 0; t < 400 && !wanderer(sim); t++) advanceTick(sim);
    const walking = wanderer(sim);
    expect(walking).not.toBeNull();
    for (let t = 0; t < 20; t++) advanceTick(sim);
    // Moving is not waiting: the clock only runs for somebody who cannot find
    // a route, which is why two game-days of walking never times anybody out.
    expect(walking?.patience).toBe(0);
    // And `work` means what it has always meant — a wanderer holds no task, so
    // nothing writes it (docs/specs/2026-09-07-housing-wanderers.md, the
    // 2026-09-07 amendment: the clock is its own field, not a corner of this).
    expect(walking?.work).toBe(0);
    expect((walking?.path.length ?? 0) - (walking?.step ?? 0)).toBeGreaterThan(0);
  });

  it("are never staffed into a workshop while still walking in", () => {
    // `staff` takes the nearest colonist with no slot — deliberately including
    // a busy one. A wanderer has no slot either, and a route that ends beside
    // the House puts them among the colony's buildings, so they can be the
    // nearest body when the player presses Staff. Bound to a slot they would
    // keep walking anyway (`stepColonists` reads `dest` first), leaving the
    // workshop marked staffed by somebody who never arrives — and a give-up
    // then despawns them with the building still pointing at their id.
    const sim = coastSim();
    homeAt(sim, 10, 10);
    const mill = testBuilding({ id: 51, kind: BuildingKind.Sawmill, x: 4, y: 10 });
    sim.buildings.push(mill);
    for (let t = 0; t < 400 && !wanderer(sim); t++) advanceTick(sim);
    const walking = wanderer(sim);
    expect(walking).not.toBeNull();

    applyCommands(sim, [{ kind: "staff", building: mill.id }]);
    // Nobody was taken: the wanderer is the only colonist on this map.
    expect(mill.worker).toBe(-1);
    expect(walking?.slot).toBe(-1);
  });

  it("claim no task while walking in, and join the pool the moment they settle", () => {
    const sim = coastSim();
    homeAt(sim, 10, 10);
    // Work to be had, and nobody else on the map to do it: a marked tree
    // beside the road in. A wanderer walks past it; a settler fells it.
    const tree = tileIndex(6, 14, 24);
    sim.world.treeMap[tree] = 1;
    sim.chopMap[tree] = 1;
    for (let t = 0; t < 400 && !wanderer(sim); t++) advanceTick(sim);
    const walking = wanderer(sim);
    expect(walking).not.toBeNull();

    let walked = 0;
    for (let t = 0; t < 300 && (walking?.dest ?? -1) >= 0; t++) {
      advanceTick(sim);
      expect(walking?.task).toBe(-1);
      expect(walking?.slot).toBe(-1);
      walked++;
    }
    expect(walked).toBeGreaterThan(2);
    expect(walking?.dest).toBe(-1);
    expect(sim.world.treeMap[tree]).toBe(1);

    // Settled, and a pool worker by that alone — no staffing, no assignment.
    for (let t = 0; t < 400 && sim.world.treeMap[tree]; t++) advanceTick(sim);
    expect(sim.world.treeMap[tree]).toBe(0);
  });
});
