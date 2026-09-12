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
 * `tick.test.ts` pins the labour loop on the default seed, whose nearest den is
 * forty-odd tiles out — a quiet colony, which is the right thing for that file
 * and no use at all for this one. So this is a **second golden run on a
 * selected seed**, chosen because its nearest lair sits fourteen tiles from the
 * colony: found by seed selection rather than by special spawning, so what is
 * pinned is the game rather than a rigged world. Adding a second file rather
 * than moving the first keeps the labour pin untouched.
 *
 * The scenario, in beats, all of it emergent from the log below:
 *
 * 1. A palisade line goes up between the colony and the den, and is standing
 *    before the monster's hours bring it out.
 * 2. It wakes, walks over, and **camps** the segment for the whole prowl —
 *    biting it a point a second while the ground beside it is too dangerous to
 *    repair from. The clock runs out mid-bite and it walks home, leaving the
 *    segment standing and wounded.
 * 3. With the wilds quiet again a repairer strolls out and works the damage
 *    back to nothing, in labour alone.
 * 4. A second line is drawn just as the next prowl begins, so there are people
 *    out on open ground when it arrives — and one of them does not get home.
 */

const SEED = 20260981;
const CENTRE = 128;
const SIZE = 256;
const TICKS = 2400;

/** The den nearest the colony. A pure function of the store, like every choice
 *  the scripts in this repo make. */
function den(sim: Sim): (typeof sim.monsters)[number] {
  return sim.monsters.reduce((a, b) =>
    Math.hypot(a.lairX - CENTRE, a.lairY - CENTRE) <= Math.hypot(b.lairX - CENTRE, b.lairY - CENTRE) ? a : b,
  );
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

/** A seven-tile run partway between the colony and the den, `offset` rows on. */
function run(sim: Sim, offset: number): number[] {
  const m = den(sim);
  const cx = Math.round(CENTRE + (m.lairX - CENTRE) * 0.55);
  const cy = Math.round(CENTRE + (m.lairY - CENTRE) * 0.55) + offset;
  const out: number[] = [];
  for (let k = -3; out.length < 7 && k < 7; k++) {
    if (canPlaceWall(sim, cx + k, cy)) out.push(tileIndex(cx + k, cy, SIZE));
  }
  return out;
}

function script(sim: Sim): Command[] {
  switch (sim.tick) {
    case 0:
      return [{ kind: "designateChop", tiles: trees(sim, 24) }];
    case 5:
      return [{ kind: "place", building: BuildingKind.Stockpile, x: 126, y: 126 }];
    // Early enough to be standing when the monster's first full prowl arrives.
    // Moved 400 → 150 at the bread step: meals put every colonist on the road
    // for a few seconds a game-day, which was enough to leave this line half
    // built when the orc arrived — and a half-built line is a different
    // scenario (docs/changelog/2026-09-08-bread-economy.md).
    case 150:
      return [{ kind: "placeWall", tiles: run(sim, 0), material: "timber" }];
    // Late enough that its builders are still out on open ground when the next
    // prowl starts, and one row nearer the den than the first line, so it is
    // what the monster notices first.
    case 1700:
      return [{ kind: "placeWall", tiles: run(sim, 1), material: "timber" }];
    default:
      return [];
  }
}

/** The pinned hash of the run, named so the move history above can cite it. */
const PINNED_V10 = "88d00a73";

const damage = (sim: Sim): number => [...sim.wallDamageMap].reduce((n, v) => n + v, 0);

/** What the wall went through, watched as it happened — the interesting facts
 *  are all transient, since the damage peaks mid-prowl and is mended before the
 *  run ends. */
interface Trace {
  sim: Sim;
  peak: number;
  peakAt: number;
  healed: number;
}

function encounter(ticks: number): Trace {
  const sim = createSim(SEED);
  const out: Trace = { sim, peak: 0, peakAt: -1, healed: -1 };
  for (let t = 0; t < ticks; t++) {
    advanceTick(sim, script(sim));
    const d = damage(sim);
    if (d > out.peak) {
      out.peak = d;
      out.peakAt = t;
    }
    if (out.peak > 0 && d === 0 && out.healed < 0) out.healed = t;
  }
  return out;
}

/**
 * The finished run, computed **once** and shared by every assertion below.
 *
 * The run is by far the expensive part of this file — a 2400-tick colony on a
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
    // its own notice range. The colony loses more people for the first of
    // those, which is the fix working — a proper escape into open ground is
    // slower than a long errand route, and an orc is faster than either.
    //
    // 3290d599 → d06c4a79 with housing
    // (docs/changelog/2026-09-07-housing-and-wanderers.md): the store gained
    // `wandererTimer` and every colonist gained `dest`. Shape only — this
    // colony never builds a House, so no arrival clock ever runs and the
    // assertions below are untouched.
    //
    // **Unmoved by SAVE_VERSION 6**, alone among this repo's pins, and that is
    // worth stating rather than leaving as a puzzle: v6 adds a field to
    // `Colonist`, and by tick 2400 this colony has none — the wilds take all
    // five, which is what the assertions below already say. v5 moved it because
    // `wandererTimer` sits on `Sim`, which survives an empty colony.
    //
    // d06c4a79 → fe31cb4d with production ceilings (SAVE_VERSION 7,
    // docs/changelog/2026-09-07-production-limits-and-filters.md), and it moved
    // for the same reason v5 did: `limits` sits on `Sim`. Shape only — no
    // workshop, no ceiling, nothing here ever counts a plank.
    //
    // fe31cb4d → 4e86c393 with the bread economy (SAVE_VERSION 8,
    // docs/changelog/2026-09-08-bread-economy.md). Shape and behaviour: two
    // fields per colonist, three `limits` slots, fifteen loaves in the clearing
    // — and folk who walk off to eat once a game-day, which is what moved the
    // two wall placements in the script above. Every beat this file asserts is
    // unchanged: bitten hard, left standing, mended by labour, and somebody
    // does not come home.
    //
    // 4e86c393 → PINNED_V10 with the sheep chain (SAVE_VERSION 10,
    // docs/changelog/2026-09-11-sheep-and-clothes.md). **Shape only**, and
    // proved rather than argued: strip the two new colonist fields and the four
    // new `limits` slots back out and this run hashes to 4e86c393 exactly. It could
    // not be otherwise — no script here builds a Tailor, so no garment exists,
    // so the composed `workTicks` pays every tick what the old boolean gate
    // paid, and every assertion in this file is unchanged and still passes.
    expect(hashSim(final())).toBe(PINNED_V10);
  });

  it("bites a standing palisade, and leaves it standing when its hours run out", () => {
    const { sim, peak, peakAt, healed } = watched();
    // Bitten, badly, but nowhere near through: an orc needs forty seconds of
    // contact for a palisade and its prowl did not last that long.
    expect(peak).toBeGreaterThan(10);
    expect(peak).toBeLessThan(40);
    // And repaired afterwards, by labour alone — no material was spent, and
    // the segment is the one that was bitten rather than a rebuilt one.
    expect(healed).toBeGreaterThan(peakAt);
    expect(damage(sim)).toBe(0);
    expect(sim.tasks.some((t) => t.kind === TaskKind.Repair)).toBe(false);
  });

  it("costs the colony somebody, and the loss is quiet and permanent", () => {
    const sim = final();
    const dead = 5 - sim.colonists.length;
    const graves = [...sim.graveMap].filter(Boolean).length;
    // The count, pinned: three builders caught at the one segment the monster
    // camps. A future retiming that changes it has to be looked at rather than
    // absorbed by a bound that anything satisfies.
    expect(dead).toBe(3);
    expect(graves).toBeGreaterThan(0);
    // The whole obituary: a smaller colony and a marker in the grass. Nothing
    // in the store records mourning, because there is nothing to record.
    //
    // **Markers can be fewer than deaths and that is not a leak**: a grave is a
    // per-tile marker and a second death on a tile shares it
    // (docs/changelog/2026-09-05-monsters-and-the-hours-they-keep.md). This run
    // is exactly that case — a monster camping the segment catches each builder
    // who walks up to the same tile — so what is asserted is that no marker
    // exists without a death behind it, not a one-to-one count.
    expect(graves).toBeLessThanOrEqual(dead);
  });

  it("leaves the wall standing and the wilds still out there", () => {
    const sim = final();
    expect([...sim.wallMap].filter(Boolean).length).toBeGreaterThan(0);
    // Nothing killed a monster, because nothing can.
    expect(sim.monsters).toHaveLength(createSim(SEED).monsters.length);
  });

  it("survives a save and load in the middle of the siege", async () => {
    // The drift proof, run through the encounter rather than through a quiet
    // colony: save mid-prowl, load, run on — and the result has to equal an
    // uninterrupted run to the same tick. Monsters carry route state and phase
    // clocks, which is exactly the sort of thing a save quietly loses.
    const mid = 900;
    const straight = createSim(SEED);
    for (let t = 0; t < mid; t++) advanceTick(straight, script(straight));
    expect(damage(straight)).toBeGreaterThan(0);

    const restored = await decode(await encode(straight, "test"));
    expect(hashSim(restored)).toBe(hashSim(straight));

    for (let t = mid; t < TICKS; t++) {
      advanceTick(straight, script(straight));
      advanceTick(restored, script(restored));
    }
    expect(hashSim(restored)).toBe(hashSim(straight));
  });
});
