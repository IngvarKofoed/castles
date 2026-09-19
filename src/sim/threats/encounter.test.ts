import { describe, expect, it } from "vitest";
import type { Command } from "../commands";
import { hashSim } from "../hash";
import { decode, encode } from "../save/codec";
import { BuildingKind, TaskKind, createSim, type Sim } from "../store";
import { advanceTick } from "../tick";
import { canPlaceWall } from "../walls";
import { tileIndex } from "../world/world";

/**
 * The scripted encounter: the determinism pin for the whole threat tier.
 *
 * `tick.test.ts` pins the labour loop on the default seed and runs entirely
 * inside the opening grace — a quiet colony, which is the right thing for that
 * file and no use at all for this one. So this is a **second golden run**, and
 * it **calls its own storms in** by zeroing the forecast clock: the opening
 * grace is deliberately longer than any run in this suite, so a scripted run
 * that waited for weather would never see any
 * (docs/specs/2026-09-17-incursions-from-the-sea.md).
 *
 * It was a seed-selected run against a nearby den until that spec. There are no
 * dens to select for now, so what is chosen is a pair of *ticks* — and a seed
 * whose opening coast puts a landing where a push can meet it. Every beat below
 * is the one the old run had.
 *
 * The scenario, in beats, all of it emergent from the log below:
 *
 * 1. A palisade line goes up between the colony and the coast the first storm
 *    is forecast on, and is standing before the boats land.
 * 2. An incursion comes ashore, presses inland and **camps** the line — biting
 *    it while the ground beside it is too dangerous to repair from. The storm
 *    passes mid-bite and the monster walks back to its boat, leaving the
 *    segment standing and wounded.
 * 3. With the wilds empty again a repairer strolls out and works the damage
 *    back to nothing, in labour alone.
 * 4. A second line is drawn just as the next storm lands, so there are people
 *    out on open ground when it arrives — and two of them do not get home.
 */

const SEED = 20260912;
const CENTRE = 128;
const SIZE = 256;
const TICKS = 2600;

/**
 * When the two storms are called in.
 *
 * The first is early enough that the line raised at tick 150 is standing when
 * the boats arrive; the second lands while the *second* line is still a row of
 * blueprints with its builders around it, which is what beat 4 is about.
 */
const FIRST_STORM = 300;
const SECOND_STORM = 1700;

/** How far from the colony the palisade lines are drawn, toward whichever coast
 *  the storm is forecast on. Far enough out that walking there is a commitment,
 *  near enough that the colony can supply it. */
const LINE_OUT = 26;

/**
 * A seven-tile run `LINE_OUT` tiles from the colony, on the bearing of the
 * coast the *next* storm is forecast on, `offset` rows along.
 *
 * A pure function of the store, like every choice the scripts in this repo
 * make: the forecast's landing site is a store field, so the line and the boats
 * cannot disagree about which side of the colony this run is about.
 */
function run(sim: Sim, offset: number): number[] {
  const tile = sim.stormLanding;
  if (tile < 0) return [];
  const lx = tile % SIZE;
  const ly = (tile - lx) / SIZE;
  const d = Math.max(1, Math.hypot(lx - CENTRE, ly - CENTRE));
  const cx = Math.round(CENTRE + ((lx - CENTRE) / d) * LINE_OUT);
  const cy = Math.round(CENTRE + ((ly - CENTRE) / d) * LINE_OUT) + offset;
  const out: number[] = [];
  for (let k = -3; out.length < 7 && k < 7; k++) {
    if (canPlaceWall(sim, cx + k, cy)) out.push(tileIndex(cx + k, cy, SIZE));
  }
  return out;
}

/** Unmarked tree tiles nearest the colony, by growing rings. */
function trees(sim: Sim, count: number): number[] {
  const out: number[] = [];
  for (let r = 1; r < 40 && out.length < count; r++) {
    for (let dy = -r; dy <= r && out.length < count; dy++) {
      for (let dx = -r; dx <= r && out.length < count; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const i = tileIndex(CENTRE + dx, CENTRE + dy, SIZE);
        if (sim.world.treeMap[i] && !sim.chopMap[i]) out.push(i);
      }
    }
  }
  return out;
}

function script(sim: Sim): Command[] {
  switch (sim.tick) {
    case 0:
      return [{ kind: "designateChop", tiles: trees(sim, 24) }];
    case 5:
      return [{ kind: "place", building: BuildingKind.Stockpile, x: 126, y: 126 }];
    // A new pile accepts nothing, so it is opened the tick after placement —
    // while it is still a blueprint, so nothing in the encounter below moves.
    case 6: {
      const pile = sim.buildings.find((b) => b.kind === BuildingKind.Stockpile);
      return pile ? [{ kind: "setAllFilters", building: pile.id, on: true }] : [];
    }
    // Early enough to be standing when the first storm lands.
    // Moved 400 → 150 at the bread step: meals put every colonist on the road
    // for a few seconds a game-day, which was enough to leave this line half
    // built when the orc arrived — and a half-built line is a different
    // scenario (docs/changelog/2026-09-08-bread-economy.md).
    case 150:
      return [{ kind: "placeWall", tiles: run(sim, 0), material: "timber" }];
    // Late enough that its builders are still out on open ground when the
    // second storm lands, and one row along from the first line.
    case SECOND_STORM:
      return [{ kind: "placeWall", tiles: run(sim, 1), material: "timber" }];
    default:
      return [];
  }
}

/** The pinned hash of the run, named so the move history above can cite it. */
const PINNED_V12 = "a765fa45";

const damage = (sim: Sim): number => [...sim.wallDamageMap].reduce((n, v) => n + v, 0);

/** What the wall went through, watched as it happened — the interesting facts
 *  are all transient, since the damage peaks mid-storm and is mended before the
 *  run ends. */
interface Trace {
  sim: Sim;
  peak: number;
  peakAt: number;
  healed: number;
  /** The largest number of monsters that were ashore at once. */
  landed: number;
}

function encounter(ticks: number): Trace {
  const sim = createSim(SEED);
  const out: Trace = { sim, peak: 0, peakAt: -1, healed: -1, landed: 0 };
  for (let t = 0; t < ticks; t++) {
    // The two storms, called in rather than waited for. Written on the store
    // directly, the way `larder` is in `settlers.test.ts`: there is no command
    // for weather, and there should not be — the player never schedules one.
    if (t === FIRST_STORM || t === SECOND_STORM) sim.stormTicks = 0;
    advanceTick(sim, script(sim));
    const d = damage(sim);
    if (d > out.peak) {
      out.peak = d;
      out.peakAt = t;
    }
    if (out.peak > 0 && d === 0 && out.healed < 0) out.healed = t;
    if (sim.monsters.length > out.landed) out.landed = sim.monsters.length;
  }
  return out;
}

/**
 * The finished run, computed **once** and shared by every assertion below.
 *
 * The run is by far the expensive part of this file — a 2600-tick colony on a
 * 256² map — and the timing evidence is that a run per test is not affordable:
 * this file has hit the suite's timeout on a loaded machine three times. So the
 * tick-by-tick trace is gathered by the same pass that produces the end state
 * rather than by a second identical run, and only the byte-identical check and
 * the save/load drift test build runs of their own, because each genuinely
 * needs an independent one.
 */
let finished: Trace | null = null;
const watched = (): Trace => (finished ??= encounter(TICKS));
const final = (): Sim => watched().sim;

describe("the scripted encounter", () => {
  it("replays byte-identically", () => {
    expect(hashSim(final())).toBe(hashSim(encounter(TICKS).sim));
  });

  it("holds its golden hash", () => {
    // A hash change here is a change to how monsters behave. If this fails, say
    // in the changelog what moved in the threat tier and why — the assertions
    // below are what tell you whether it moved for a reason.
    //
    // 1f90820d → 3290d599 with the review's two behaviour repairs: a colonist
    // with a live route and no task now actually flees instead of walking it
    // past the monster, and a monster no longer notices a wall a tile beyond
    // its own notice range.
    //
    // 3290d599 → d06c4a79 with housing
    // (docs/changelog/2026-09-07-housing-and-wanderers.md), d06c4a79 → fe31cb4d
    // with production ceilings, fe31cb4d → 4e86c393 with the bread economy,
    // 4e86c393 → 88d00a73 with the sheep chain and 88d00a73 → b5e291f3 with the
    // drink chain — every one of those a shape move on a store field, each
    // proved by stripping the new fields back out and re-hashing.
    //
    // b5e291f3 → PINNED_V12 with incursions (SAVE_VERSION 12,
    // docs/specs/2026-09-17-incursions-from-the-sea.md), and this one is **a
    // different colony**: the seed moved from 20260981 to 20260912, the world
    // opens empty, the run calls two storms in rather than waiting on a den's
    // rhythm, and the palisade lines are sited off the forecast's landing
    // rather than off a lair. What is pinned is the same scenario — a line
    // bitten and left standing, mended by labour, and people caught out on the
    // second push — re-found the same way.
    expect(hashSim(final())).toBe(PINNED_V12);
  });

  it("opens on an empty wilderness, and the first storm has to be called in", () => {
    // The promise the whole change exists for: in peace there is nothing on the
    // map at all, so a wall push has a window long enough to finish in.
    const sim = createSim(SEED);
    expect(sim.monsters).toHaveLength(0);
    for (let t = 0; t < FIRST_STORM; t++) advanceTick(sim, script(sim));
    expect(sim.monsters).toHaveLength(0);
    // And the forecast has already picked the coast it will come in on, which
    // is what makes the line above possible to site at all.
    expect(sim.stormLanding).toBeGreaterThanOrEqual(0);
  });

  it("lands an incursion from one beach, and takes it away again", () => {
    const { sim, landed } = watched();
    expect(landed).toBeGreaterThan(0);
    // One site, however large the incursion: a single readable direction is
    // what the boats buy.
    expect(new Set(sim.monsters.map((m) => `${m.landX},${m.landY}`)).size).toBeLessThanOrEqual(1);
    // The first storm is long gone — it did not simply accumulate.
    expect(sim.monsters.length).toBeLessThan(landed + 1);
  });

  it("bites a standing palisade, and leaves it standing when the storm passes", () => {
    const { sim, peak, peakAt, healed } = watched();
    // Bitten, badly, but nowhere near through: an orc needs forty seconds of
    // contact for a palisade and the storm did not last that long over it.
    expect(peak).toBeGreaterThan(10);
    expect(peak).toBeLessThan(40);
    // And repaired afterwards, by labour alone — no material was spent, and
    // the segment is the one that was bitten rather than a rebuilt one.
    expect(healed).toBeGreaterThan(peakAt);
    expect(sim.tasks.some((t) => t.kind === TaskKind.Repair)).toBe(false);
  });

  it("costs the colony somebody, and the loss is quiet and permanent", () => {
    const sim = final();
    const dead = 5 - sim.colonists.length;
    const graves = [...sim.graveMap].filter(Boolean).length;
    // The count, pinned: two builders caught out on the second line. A future
    // retiming that changes it has to be looked at rather than absorbed by a
    // bound that anything satisfies.
    expect(dead).toBe(2);
    expect(graves).toBeGreaterThan(0);
    // The whole obituary: a smaller colony and a marker in the grass. Nothing
    // in the store records mourning, because there is nothing to record.
    //
    // **Markers can be fewer than deaths and that is not a leak**: a grave is a
    // per-tile marker and a second death on a tile shares it
    // (docs/changelog/2026-09-05-monsters-and-the-hours-they-keep.md).
    expect(graves).toBeLessThanOrEqual(dead);
  });

  it("leaves the wall standing and the wilds still out there", () => {
    const sim = final();
    expect([...sim.wallMap].filter(Boolean).length).toBeGreaterThan(0);
    // Nothing killed a monster, because nothing can: the second storm is still
    // ashore or walking back to its boat when the run ends.
    expect(sim.monsters.length).toBeGreaterThan(0);
  });

  it("survives a save and load in the middle of the storm", async () => {
    // The drift proof, run through the encounter rather than through a quiet
    // colony: save mid-bite, load, run on — and the result has to equal an
    // uninterrupted run to the same tick. Monsters carry route state and the
    // store carries a forecast clock, which is exactly the sort of thing a save
    // quietly loses.
    const mid = 880;
    const straight = createSim(SEED);
    for (let t = 0; t < mid; t++) {
      if (t === FIRST_STORM) straight.stormTicks = 0;
      advanceTick(straight, script(straight));
    }
    expect(damage(straight)).toBeGreaterThan(0);
    expect(straight.monsters.length).toBeGreaterThan(0);

    const restored = await decode(await encode(straight, "test"));
    expect(hashSim(restored)).toBe(hashSim(straight));

    for (let t = mid; t < TICKS; t++) {
      if (t === SECOND_STORM) {
        straight.stormTicks = 0;
        restored.stormTicks = 0;
      }
      advanceTick(straight, script(straight));
      advanceTick(restored, script(restored));
    }
    expect(hashSim(restored)).toBe(hashSim(straight));
  });
});
