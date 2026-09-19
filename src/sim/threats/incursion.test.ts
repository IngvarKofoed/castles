import { describe, expect, it } from "vitest";
import { MonsterKind, MonsterPhase, createSim, type Sim } from "../store";
import { advanceTick } from "../tick";
import {
  FIRST_STORM,
  INCURSION_BASE,
  INCURSION_MAX,
  INCURSION_TICKS,
  LAND_PER_MONSTER,
  STORM_INTERVAL,
  STORM_JITTER,
  WITHDRAW_BACKSTOP,
} from "../tuning";
import { WallState } from "../walls";
import { enclosedLand, recomputeEnclosure } from "../walls/enclosure";
import { Terrain, tileIndex } from "../world/world";
import { stepMonsters } from "./monsters";

/**
 * The weather: peace, the landing, and the withdrawal
 * (docs/specs/2026-09-17-incursions-from-the-sea.md).
 *
 * Run on a real generated map rather than on `flatSim`, because everything here
 * is about the **coast** — a landing site is a beach, and a flat test world has
 * none. The seed is the default one the labour pin uses, so a failure here is
 * never a failure of an exotic map.
 */

const SEED = 20260901;
const SIZE = 256;

/** Run the sim until a predicate holds, or give up. Returns the tick it took. */
function until(sim: Sim, ticks: number, done: (s: Sim) => boolean): number {
  for (let t = 0; t < ticks; t++) {
    advanceTick(sim);
    if (done(sim)) return t;
  }
  return -1;
}

describe("peace", () => {
  it("opens with no monsters anywhere, and keeps it that way for the whole grace", () => {
    // The promise the change exists for: the land outside the wall is genuinely
    // safe, so a wall push has a window long enough to finish in.
    const sim = createSim(SEED);
    expect(sim.monsters).toHaveLength(0);
    expect(sim.stormTicks).toBe(FIRST_STORM);
    for (let t = 0; t < FIRST_STORM; t++) {
      advanceTick(sim);
      expect(sim.monsters).toHaveLength(0);
    }
  });

  it("runs the clock on the tick, so a pause is a pause", () => {
    // ×0 is the renderer simply not calling `advanceTick`. Wall-clock time is
    // not available to `sim/` at all, and a forecast that depended on it would
    // break determinism outright — this is that pinned as a property of the
    // field rather than as an argument.
    const sim = createSim(SEED);
    const parked = sim.stormTicks;
    // Nothing moves the clock but a tick: the forecast reads no wall clock, and
    // there is no other caller that could advance it behind the pause.
    expect(sim.stormTicks).toBe(parked);
    advanceTick(sim);
    expect(sim.stormTicks).toBe(parked - 1);
    advanceTick(sim);
    expect(sim.stormTicks).toBe(parked - 2);
  });

  it("picks the coast it is coming in on before it arrives", () => {
    // Direction is half of what a forecast is for, so it is resolved while the
    // clock is still running rather than at the landing.
    const sim = createSim(SEED);
    advanceTick(sim);
    expect(sim.stormLanding).toBeGreaterThanOrEqual(0);
    const x = sim.stormLanding % SIZE;
    const y = (sim.stormLanding - x) / SIZE;
    expect(sim.world.tmap[tileIndex(x, y, SIZE)]).toBe(Terrain.Sand);
  });
});

describe("the landing", () => {
  it("puts an incursion on one beach, all of it from the same boat", () => {
    const sim = createSim(SEED);
    sim.stormTicks = 0;
    advanceTick(sim);
    expect(sim.monsters.length).toBeGreaterThanOrEqual(INCURSION_BASE);
    // One site however large the incursion: a single readable direction is
    // what the boats buy, and several landings dilute exactly that.
    expect(new Set(sim.monsters.map((m) => `${m.landX},${m.landY}`)).size).toBe(1);
    for (const m of sim.monsters) {
      expect(m.phase).toBe(MonsterPhase.Ashore);
      expect(Math.floor(m.x)).toBe(m.landX);
      expect(Math.floor(m.y)).toBe(m.landY);
    }
    // And the clock has turned over into the incursion's own.
    expect(sim.stormTicks).toBe(INCURSION_TICKS);
  });

  it("lands when the clock runs out on its own, not only when a test zeroes it", () => {
    // **The regression this exists for.** The clock reaches zero one tick before
    // `stepForecast` can act on it, so a settle that keyed off "zero and nothing
    // ashore" rescheduled the storm on that very tick and the landing never
    // happened — every storm in the game silently skipped, with the ribbon
    // flicking from *any moment now* straight back to *far off*
    // (docs/specs/2026-09-17-incursions-from-the-sea.md).
    const sim = createSim(SEED);
    advanceTick(sim);
    sim.stormTicks = 3;
    const landed = until(sim, 10, (s) => s.monsters.length > 0);
    expect(landed).toBeGreaterThanOrEqual(0);
    // And the clock has turned straight over into the incursion's own, with no
    // peacetime interval in between.
    expect(sim.stormTicks).toBe(INCURSION_TICKS);
  });

  it("retries next tick when no shore qualifies, without touching the PRNG", () => {
    const sim = createSim(SEED);
    advanceTick(sim);
    // Every beach on the island under stone: nothing can come ashore anywhere.
    for (let i = 0; i < sim.world.tmap.length; i++) {
      if (sim.world.tmap[i] === Terrain.Sand) sim.wallMap[i] = WallState.Stone;
    }
    recomputeEnclosure(sim);
    sim.stormTicks = 0;
    const rng = sim.rngState;
    until(sim, 20, () => false);
    expect(sim.monsters).toHaveLength(0);
    // The clock waits at zero rather than rescheduling, and no draw was spent:
    // a draw per failed attempt would make the weather depend on how long the
    // coast happened to be busy.
    expect(sim.stormTicks).toBe(0);
    expect(sim.rngState).toBe(rng);
  });

  it("marks the enclosure stale, because a monster seeds the flood", () => {
    const sim = createSim(SEED);
    sim.stormTicks = 0;
    sim.enclosureDirty = 0;
    // Straight to `stepMonsters`, so the tick's own `settleEnclosure` does not
    // clear the flag before it can be read.
    stepMonsters(sim);
    expect(sim.monsters.length).toBeGreaterThan(0);
    expect(sim.enclosureDirty).toBe(1);
  });

  it("scales with enclosed land, and reads the acreage at the landing", () => {
    // Pillar 2, by a different mechanism: expansion is what buys the risk.
    const bare = createSim(SEED);
    bare.stormTicks = 0;
    advanceTick(bare);

    const walled = createSim(SEED);
    // A big square of stone, drawn straight onto the layer: the point is the
    // acreage, not how it was built.
    for (let y = 100; y <= 156; y++) {
      for (let x = 100; x <= 156; x++) {
        if (x === 100 || x === 156 || y === 100 || y === 156) walled.wallMap[tileIndex(x, y, SIZE)] = WallState.Stone;
      }
    }
    recomputeEnclosure(walled);
    expect(enclosedLand(walled)).toBeGreaterThan(LAND_PER_MONSTER * 2);
    walled.stormTicks = 0;
    advanceTick(walled);

    expect(walled.monsters.length).toBeGreaterThan(bare.monsters.length);
    expect(walled.monsters.length).toBeLessThanOrEqual(INCURSION_MAX);
    // And it presses further inland with the colony's reach — depth still costs
    // something, so the deep map is still earned.
    expect(walled.monsters[0].depth).toBeGreaterThan(bare.monsters[0].depth);
  });

  it("is not sized off the fill a sealed-in monster collapses", () => {
    // The exploit this closes: a monster inside a closed wall makes the whole
    // enclosure read as outside, so an acreage taken at the *end* of a storm
    // would price the next one at zero forever.
    const sim = createSim(SEED);
    for (let y = 100; y <= 156; y++) {
      for (let x = 100; x <= 156; x++) {
        if (x === 100 || x === 156 || y === 100 || y === 156) sim.wallMap[tileIndex(x, y, SIZE)] = WallState.Stone;
      }
    }
    recomputeEnclosure(sim);
    const acreage = enclosedLand(sim);
    sim.stormTicks = 0;
    advanceTick(sim);
    const first = sim.monsters.length;

    // Now seal one inside and let the storm end with it in there. The fill
    // collapses, which is the trap doing its job — and the *next* storm must
    // not be priced off it.
    const captive = sim.monsters[0];
    captive.x = 128.5;
    captive.y = 128.5;
    recomputeEnclosure(sim);
    expect(enclosedLand(sim)).toBe(0);

    // Run past the storm and its backstop: every monster leaves, the fill comes
    // back, and only then is the next strength drawn.
    until(sim, INCURSION_TICKS + WITHDRAW_BACKSTOP + 200, (s) => s.monsters.length === 0);
    expect(sim.monsters).toHaveLength(0);
    expect(enclosedLand(sim)).toBe(acreage);
    sim.stormTicks = 0;
    advanceTick(sim);
    expect(sim.monsters.length).toBe(first);
  });

  it("mixes trolls into the bigger storms", () => {
    const sim = createSim(SEED);
    for (let y = 60; y <= 196; y++) {
      for (let x = 60; x <= 196; x++) {
        if (x === 60 || x === 196 || y === 60 || y === 196) sim.wallMap[tileIndex(x, y, SIZE)] = WallState.Stone;
      }
    }
    recomputeEnclosure(sim);
    sim.stormTicks = 0;
    advanceTick(sim);
    expect(sim.monsters.length).toBe(INCURSION_MAX);
    expect(sim.monsters.some((m) => m.kind === MonsterKind.Troll)).toBe(true);
    expect(sim.monsters.some((m) => m.kind === MonsterKind.Orc)).toBe(true);
  });
});

describe("the withdrawal", () => {
  it("turns everything ashore on the storm's own clock, and empties the map", () => {
    const sim = createSim(SEED);
    sim.stormTicks = 0;
    advanceTick(sim);
    expect(sim.monsters.length).toBeGreaterThan(0);

    const turned = until(sim, INCURSION_TICKS + 5, (s) =>
      s.monsters.every((m) => m.phase === MonsterPhase.Withdrawing),
    );
    expect(turned).toBeGreaterThanOrEqual(0);
    // A tick short of the full backstop: the turn and the first step of the
    // walk home happen in the same `stepMonsters`, so the clock is already
    // running by the time anything can look at it.
    for (const m of sim.monsters) expect(m.phaseTicks).toBe(WITHDRAW_BACKSTOP - 1);

    const gone = until(sim, WITHDRAW_BACKSTOP + 200, (s) => s.monsters.length === 0);
    expect(gone).toBeGreaterThanOrEqual(0);
  });

  it("sets the next forecast when the last one leaves, and only then", () => {
    const sim = createSim(SEED);
    sim.stormTicks = 0;
    advanceTick(sim);
    const rng = sim.rngState;
    // Nothing is drawn while the storm is ashore: the schedule is re-seeded at
    // exactly one moment, which is what makes a replay meet the same weather.
    until(sim, 50, () => false);
    expect(sim.rngState).toBe(rng);

    until(sim, INCURSION_TICKS + WITHDRAW_BACKSTOP + 200, (s) => s.monsters.length === 0);
    expect(sim.rngState).not.toBe(rng);
    expect(sim.stormTicks).toBeGreaterThanOrEqual(STORM_INTERVAL - STORM_JITTER);
    expect(sim.stormTicks).toBeLessThanOrEqual(STORM_INTERVAL + STORM_JITTER);
    expect(sim.stormLanding).toBeGreaterThanOrEqual(0);
  });

  it("is replayable: the same seed meets the same weather", () => {
    const one = createSim(SEED);
    const two = createSim(SEED);
    for (const sim of [one, two]) {
      sim.stormTicks = 0;
      for (let t = 0; t < INCURSION_TICKS + WITHDRAW_BACKSTOP + 400; t++) advanceTick(sim);
    }
    expect(one.stormTicks).toBe(two.stormTicks);
    expect(one.stormStrength).toBe(two.stormStrength);
    expect(one.stormLanding).toBe(two.stormLanding);
  });
});
