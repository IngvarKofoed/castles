import { describe, expect, it } from "vitest";
import { MonsterPhase, type Building, type Colonist, type Sim } from "../store";
import { flatSim, testBuilding, testColonist, testMonster } from "../test-sim";
import {
  DAY_TICKS,
  RHYTHM_FUZZ,
  THREAT_BUCKETS,
  THREAT_RANGE,
  WATCH_BUCKETS,
  WATCH_RANGE,
} from "../tuning";
import { WallState } from "../walls";
import { recomputeEnclosure } from "../walls/enclosure";
import { tileIndex } from "../world/world";
import { inspect, monsterAtTile, monsters, readout, rhythm, threat } from "./index";
import { spawnItem } from "../items";
import { BuildingKind, BuildingState, ItemType } from "../store";
import { HUNGRY_TICKS, MEAL_TICKS, STARTING_COLONISTS } from "../tuning";

/**
 * What the player is allowed to know about the Wilds.
 *
 * This is the one place in the game where truth and knowledge genuinely differ,
 * so it is worth pinning from both sides: that the coarse estimate really is
 * coarse and really is wrong by a little (or watchtowers have nothing left to
 * sell), and that the exact clocks never leak out in a shape a consumer could
 * read (docs/ARCHITECTURE.md, "Truth and knowledge").
 */

const at = (sim: Sim, x: number, y: number): number => tileIndex(x, y, sim.world.size);

/** Where every tower in this file stands — far enough in that a `WATCH_RANGE`
 *  square and a den past its edge both fit on the map. */
const TOWER = 30;

/**
 * Put a Watchtower at `TOWER` with a watcher inside it, and hand both back.
 *
 * The staffing is set up by hand rather than by running `staff`: these tests
 * are about the *gate* — slot set, worker bound, worker inside — so they have
 * to be able to break each of its three parts on its own.
 */
function towered(sim: Sim, staffed = true): { tower: Building; watcher: Colonist } {
  const tower = testBuilding({ id: 50, kind: BuildingKind.Watchtower, x: TOWER, y: TOWER, w: 1, h: 1 });
  sim.buildings.push(tower);
  const watcher = sim.colonists[0];
  if (staffed) {
    watcher.slot = tower.id;
    watcher.inside = 1;
    tower.worker = watcher.id;
  }
  return { tower, watcher };
}

/** A den `d` tiles from the tower on the x axis, resting, with a clock the
 *  caller drives by writing `phaseTicks`. */
function denAt(sim: Sim, dx: number, dy = 0, id = 1): ReturnType<typeof testMonster> {
  const m = testMonster({
    id,
    lairX: TOWER + dx,
    lairY: TOWER + dy,
    phase: MonsterPhase.Rest,
    restTicks: 1000,
    phaseTicks: 1000,
  });
  sim.monsters.push(m);
  return m;
}

function peopled(size = 24): Sim {
  const sim = flatSim(size);
  const c = testColonist({ id: sim.nextId++, x: 12.5, y: 12.5 });
  sim.colonists.push(c);
  recomputeEnclosure(sim);
  return sim;
}

describe("what the renderer may see of a monster", () => {
  it("carries position and kind, and exactly two stances", () => {
    const sim = peopled();
    sim.monsters.push(testMonster({ id: 1, lairX: 4, lairY: 4, phase: MonsterPhase.Rest }));
    sim.monsters.push(testMonster({ id: 2, lairX: 18, lairY: 4, phase: MonsterPhase.Prowl }));
    sim.monsters.push(testMonster({ id: 3, lairX: 18, lairY: 18, phase: MonsterPhase.GoingHome }));

    const seen = monsters(sim);
    expect(seen.map((m) => m.stance)).toEqual(["dormant", "out", "out"]);
    // A monster walking home is visibly out there, and the rhythm below is
    // where the player learns it is leaving — not the stance.
    expect(seen[0].x).toBe(4.5);
  });

  it("hands the renderer nothing it could read a clock off", () => {
    const sim = peopled();
    sim.monsters.push(testMonster({ id: 1, lairX: 4, lairY: 4, phaseTicks: 137, restTicks: 999 }));
    const keys = Object.keys(monsters(sim)[0]).sort();
    // The exact timers, the circuit and the notice radius stay sim-internal:
    // leaking any of them is how the watchtower mechanic quietly stops being a
    // mechanic, and it would leak as a *field*, not as a decision.
    expect(keys).toEqual(["heading", "id", "kind", "px", "py", "stance", "x", "y"]);
  });

  it("resolves a click to the monster standing on that tile", () => {
    const sim = peopled();
    sim.monsters.push(testMonster({ id: 7, lairX: 4, lairY: 4 }));
    expect(monsterAtTile(sim, 4, 4)?.id).toBe(7);
    expect(monsterAtTile(sim, 5, 4)).toBeNull();
  });
});

describe("the rhythm estimate", () => {
  it("is never sharper than a fifth, and never exact", () => {
    const sim = peopled();
    const m = testMonster({ id: 1, lairX: 4, lairY: 4, phase: MonsterPhase.Rest, restTicks: 1000 });
    sim.monsters.push(m);

    const buckets = new Set<number>();
    for (let spent = 0; spent <= 1000; spent += 25) {
      m.phaseTicks = 1000 - spent;
      const r = rhythm(sim, 1)!;
      expect(r.phase).toBe("resting");
      expect(r.buckets).toBe(THREAT_BUCKETS);
      expect(r.bucket).toBeGreaterThanOrEqual(0);
      expect(r.bucket).toBeLessThan(THREAT_BUCKETS);
      buckets.add(r.bucket);
    }
    // It does move — a bar that never changed would be honest about nothing.
    expect(buckets.size).toBe(THREAT_BUCKETS);
  });

  it("is wrong by a per-monster amount, so two monsters at the same point disagree", () => {
    // The fuzz is what watchtowers narrow. If every monster reported the same
    // bucket for the same fraction there would be nothing to sharpen, and the
    // player could average two sightings into an exact clock.
    const sim = peopled();
    const shifted: number[] = [];
    for (let id = 1; id <= 40; id++) {
      const m = testMonster({ id, lairX: 4, lairY: 4, phase: MonsterPhase.Rest, restTicks: 1000 });
      sim.monsters = [m];
      // Just under a bucket boundary: whether it reads as spent or not is
      // exactly what the error decides.
      m.phaseTicks = 1000 - Math.round(1000 * (1 / THREAT_BUCKETS));
      shifted.push(rhythm(sim, id)!.bucket);
    }
    expect(new Set(shifted).size).toBeGreaterThan(1);
    // And bounded: the error is a fraction of a phase, not a free hand.
    for (const b of shifted) expect(Math.abs(b - 1)).toBeLessThanOrEqual(Math.ceil(RHYTHM_FUZZ * THREAT_BUCKETS) + 1);
  });

  it("says homeward for a monster on its way back", () => {
    const sim = peopled();
    sim.monsters.push(testMonster({ id: 1, lairX: 4, lairY: 4, phase: MonsterPhase.GoingHome, phaseTicks: 0 }));
    expect(rhythm(sim, 1)?.phase).toBe("homeward");
    expect(rhythm(sim, 99)).toBeNull();
  });
});

describe("a watchtower's coverage", () => {
  /**
   * The 4b product in one assertion: a watched den's estimate is finer *and*
   * exact. Both halves matter — tenths alone would still be wrong by a fuzzed
   * amount, and error-free fifths would not be finer.
   */
  it("reads a covered den in exact tenths", () => {
    const sim = peopled(70);
    towered(sim);
    const m = denAt(sim, 4);

    for (const left of [1000, 900, 750, 500, 250, 100, 1]) {
      m.phaseTicks = left;
      const r = rhythm(sim, m.id)!;
      const spent = 1 - left / 1000;
      expect(r.buckets).toBe(WATCH_BUCKETS);
      expect(r.watched).toBe(true);
      // No seeded error at all: the bucket is the true fraction, quantized.
      expect(r.bucket).toBe(Math.min(WATCH_BUCKETS - 1, Math.floor(spent * WATCH_BUCKETS)));
    }
  });

  it("makes two covered dens agree where two uncovered ones disagree", () => {
    // The fuzz is per-monster, so the base game's estimate can be averaged out
    // of two sightings only by guesswork. Under a watcher there is nothing to
    // average: every covered den reports the same fraction the same way.
    const sim = peopled(70);
    const seen = new Set<number>();
    for (let id = 1; id <= 20; id++) {
      const m = denAt(sim, 4, 0, id);
      // Parked on a *fifth* boundary, which is where the base game's error
      // actually shows: mid-bucket the fuzz mostly rounds back to the same
      // segment and the disagreement this test is about would be invisible.
      m.phaseTicks = 1000 - Math.round(1000 / THREAT_BUCKETS);
      seen.add(rhythm(sim, id)!.bucket);
    }
    expect(seen.size).toBeGreaterThan(1);

    towered(sim);
    const watched = new Set(sim.monsters.map((m) => rhythm(sim, m.id)!.bucket));
    expect(watched.size).toBe(1);
  });

  it("leaves an uncovered den exactly as coarse as it was", () => {
    // The base game's coarseness has to keep meaning something, so the
    // comparison is against the same monster in a colony with no tower at all
    // — not merely against "five buckets".
    const bare = peopled(70);
    const alone = denAt(bare, WATCH_RANGE + 1);
    alone.phaseTicks = 400;

    const sim = peopled(70);
    towered(sim);
    const m = denAt(sim, WATCH_RANGE + 1);
    m.phaseTicks = 400;

    expect(rhythm(sim, m.id)).toEqual(rhythm(bare, alone.id));
    expect(rhythm(sim, m.id)!.buckets).toBe(THREAT_BUCKETS);
    expect(rhythm(sim, m.id)!.watched).toBe(false);
  });

  it("cuts off exactly at WATCH_RANGE, and measures Chebyshev", () => {
    const sim = peopled(70);
    towered(sim);
    // Straight out: 24 covered, 25 not. The edge is exact, so a den one tile
    // past it is a den the player has to guess at.
    expect(rhythm(sim, denAt(sim, WATCH_RANGE, 0, 1).id)!.watched).toBe(true);
    expect(rhythm(sim, denAt(sim, WATCH_RANGE + 1, 0, 2).id)!.watched).toBe(false);
    // And on the diagonal, which is where a *circle* of radius 24 would have
    // disagreed with the square the overlay draws.
    expect(rhythm(sim, denAt(sim, WATCH_RANGE, WATCH_RANGE, 3).id)!.watched).toBe(true);
    expect(rhythm(sim, denAt(sim, WATCH_RANGE + 1, WATCH_RANGE, 4).id)!.watched).toBe(false);
  });

  it("is rented with hands: no watcher inside, no sharpening", () => {
    const sim = peopled(70);
    const { tower, watcher } = towered(sim);
    const m = denAt(sim, 4);
    m.phaseTicks = 400;
    expect(rhythm(sim, m.id)!.buckets).toBe(WATCH_BUCKETS);

    // Walking over: the slot is filled and the picture is still coarse. This
    // is also what makes the watcher's lunch coarsen it — an eater has left
    // the building, so `inside` is 0 for exactly the same reason.
    watcher.inside = 0;
    expect(rhythm(sim, m.id)!.buckets).toBe(THREAT_BUCKETS);
    watcher.inside = 1;

    // Bound to some other building: the gate matches the slot, not just the id.
    watcher.slot = 999;
    expect(rhythm(sim, m.id)!.buckets).toBe(THREAT_BUCKETS);
    watcher.slot = tower.id;

    // Unstaffed: back to fifths on the same read, with nothing remembered.
    tower.worker = -1;
    expect(rhythm(sim, m.id)!.buckets).toBe(THREAT_BUCKETS);
    expect(rhythm(sim, m.id)!.watched).toBe(false);

    // And an unfinished tower watches nothing however staffed the store says
    // it is — a blueprint is a plot with stakes in it.
    tower.worker = watcher.id;
    tower.state = BuildingState.Blueprint;
    expect(rhythm(sim, m.id)!.watched).toBe(false);
  });

  it("leaves the homeward branch its fixed shape, and still reports honestly", () => {
    // `GoingHome` ends on arrival rather than on a clock, so there is no timer
    // for a watcher to read more finely — but the note under the bar has to
    // stay true, which is why `watched` is reported rather than inferred from
    // the bucket count.
    const sim = peopled(70);
    towered(sim);
    const m = denAt(sim, 4);
    m.phase = MonsterPhase.GoingHome;

    const r = rhythm(sim, m.id)!;
    expect(r.phase).toBe("homeward");
    expect(r.buckets).toBe(THREAT_BUCKETS);
    expect(r.bucket).toBe(THREAT_BUCKETS - 1);
    expect(r.watched).toBe(true);
  });

  it("sharpens the ribbon's meter through rhythm alone", () => {
    // The meter renders `buckets` from data, so it needs no edit of its own —
    // this is that claim pinned rather than assumed.
    const sim = peopled(70);
    const m = denAt(sim, 4);
    m.phaseTicks = 400;
    expect(threat(sim).buckets).toBe(THREAT_BUCKETS);
    // And the caption keeps its exact vocabulary: finer, never a digit.
    expect(threat(sim).caption).not.toMatch(/\d/);

    towered(sim);
    expect(threat(sim).buckets).toBe(WATCH_BUCKETS);
    expect(threat(sim).caption).not.toMatch(/\d/);
    expect(threat(sim).caption).toMatch(/^orc wakes /);
  });
});

describe("a watchtower's panel", () => {
  it("counts the dens in reach whether or not anybody is watching", () => {
    // Staffing-blind on purpose: an unstaffed tower can then say what it
    // *would* watch, which is what makes siting one a decision rather than a
    // guess.
    const sim = peopled(70);
    const { tower } = towered(sim, false);
    expect(inspect(sim, tower.id)?.watching).toBe(0);

    denAt(sim, 4, 0, 1);
    denAt(sim, WATCH_RANGE, WATCH_RANGE, 2);
    denAt(sim, WATCH_RANGE + 1, 0, 3);
    expect(inspect(sim, tower.id)?.watching).toBe(2);

    // Unchanged by staffing — the wording is what carries that difference.
    tower.worker = sim.colonists[0].id;
    sim.colonists[0].slot = tower.id;
    sim.colonists[0].inside = 1;
    expect(inspect(sim, tower.id)?.watching).toBe(2);
  });

  it("reports -1 for everything that is not a tower", () => {
    const sim = peopled(70);
    const pile = testBuilding({ id: 60, x: 4, y: 4 });
    sim.buildings.push(pile);
    expect(inspect(sim, pile.id)?.watching).toBe(-1);
    // And a tower has no recipe at all, which is what drops the chain chip and
    // the input/output rows from its panel.
    const { tower } = towered(sim, false);
    expect(inspect(sim, tower.id)?.chain).toBeNull();
    expect(inspect(sim, tower.id)?.outputType).toBe(-1);
    expect(inspect(sim, tower.id)?.hasSlot).toBe(true);
  });
});

describe("the threat meter", () => {
  it("is empty only when there is no wilderness at all", () => {
    const sim = peopled();
    // No monsters: nothing to say.
    expect(threat(sim).monster).toBe(-1);
    expect(threat(sim).caption).toBe("wilds quiet");

    // One den, far past THREAT_RANGE and fast asleep — the state that used to
    // blank the bar. "Time to monsters" is the whole point of the meter, so a
    // quiet colony still gets a clock, marked as somebody else's wilderness.
    const far = testMonster({
      id: 1,
      lairX: 12 + THREAT_RANGE + 30,
      lairY: 12,
      phase: MonsterPhase.Rest,
      restTicks: 1200,
      phaseTicks: 1200,
    });
    sim.monsters.push(far);
    const t = threat(sim);
    expect(t.monster).toBe(1);
    expect(t.caption).toMatch(/^far wilds: orc wakes /);
    expect(t.lit).toBeGreaterThan(0);
  });

  it("falls back to the NEAREST den, not the soonest-waking one anywhere", () => {
    // Deliberate: two dozen staggered rhythms mean something is always about to
    // wake, so a soonest-waking fallback would sit permanently full and say
    // nothing about this colony.
    const sim = peopled();
    const near = testMonster({ id: 1, lairX: 12, lairY: 12 + THREAT_RANGE + 5, phase: MonsterPhase.Rest, restTicks: 1200, phaseTicks: 1100 });
    const soon = testMonster({ id: 2, lairX: 12, lairY: 12 + THREAT_RANGE + 60, phase: MonsterPhase.Rest, restTicks: 1200, phaseTicks: 3 });
    sim.monsters.push(soon, near);
    expect(threat(sim).monster).toBe(near.id);
  });

  it("fills toward a waking and drains toward a leaving", () => {
    const sim = peopled();
    const m = testMonster({ id: 1, lairX: 14, lairY: 14, phase: MonsterPhase.Rest, restTicks: 100, phaseTicks: 100 });
    sim.monsters.push(m);

    const early = threat(sim);
    m.phaseTicks = 1;
    const late = threat(sim);
    expect(late.lit).toBeGreaterThan(early.lit);
    expect(late.caption).toMatch(/^orc wakes /);

    m.phase = MonsterPhase.Prowl;
    m.prowlTicks = 100;
    m.phaseTicks = 100;
    const fresh = threat(sim);
    m.phaseTicks = 1;
    const spent = threat(sim);
    expect(spent.lit).toBeLessThan(fresh.lit);
    expect(spent.caption).toMatch(/^orc prowling, gone /);
  });

  it("tells the time in words, off the same bucket the bar shows", () => {
    const sim = peopled();
    // A troll two game-days from waking reads as days; the same troll a few
    // ticks out reads as moments. Never a digit either way — a figure invites
    // arithmetic the estimate is a fifth of a phase too coarse to support.
    const m = testMonster({ id: 1, kind: 1, lairX: 14, lairY: 14, phase: MonsterPhase.Rest, restTicks: 4 * DAY_TICKS });
    sim.monsters.push(m);

    m.phaseTicks = m.restTicks;
    expect(threat(sim).caption).toBe("troll wakes in a few days");
    // A tick from waking it still says "within the day", and that is the
    // quantization being honest rather than a bug: the last bucket of a
    // four-day rest is most of a day wide, so the estimate genuinely does not
    // know the monster is about to stir. Only a short phase can reach
    // "any moment" — which is exactly the resolution 4b's towers buy back.
    m.phaseTicks = 1;
    expect(threat(sim).caption).toBe("troll wakes within the day");

    // Swept across the whole rest it really does move through its phrases
    // rather than sticking on one — and never once shows a digit.
    const said = new Set<string>();
    for (let left = m.restTicks; left > 0; left -= 20) {
      m.phaseTicks = left;
      const caption = threat(sim).caption;
      expect(caption).not.toMatch(/\d/);
      said.add(caption);
    }
    expect(said.size).toBeGreaterThan(2);

    // A short phase is what can reach "any moment": a fifth of half a day is
    // minutes, so there the estimate is sharp enough to say so.
    m.restTicks = DAY_TICKS / 2;
    m.phaseTicks = 1;
    expect(threat(sim).caption).toBe("troll wakes any moment now");
  });

  it("puts a monster biting the walls above the one it was already watching", () => {
    // The hold exists so the bar does not flicker between clocks; it must not
    // outrank the one event the meter is for.
    const sim = peopled();
    const wall = at(sim, 13, 13);
    sim.wallMap[wall] = WallState.Palisade;
    const far = testMonster({ id: 1, lairX: 12, lairY: 20, x: 12.5, y: 20.5 });
    const chewer = testMonster({ id: 2, lairX: 16, lairY: 13, x: 14.5, y: 13.5, targetTile: wall });
    sim.monsters.push(far, chewer);

    expect(threat(sim, far.id).monster).toBe(chewer.id);
    // And with nothing being bitten, the hold does its job.
    chewer.targetTile = -1;
    expect(threat(sim, far.id).monster).toBe(far.id);
  });

  it("anchors on the folk until there are buildings, then on those", () => {
    const sim = peopled();
    // A den just inside range of the colonists standing at (12, 12).
    sim.monsters.push(testMonster({ id: 1, lairX: 12, lairY: 12 + THREAT_RANGE - 2, phase: MonsterPhase.Rest }));
    expect(threat(sim).monster).toBe(1);
    expect(threat(sim).caption).not.toMatch(/far wilds/);

    // Out of their range: still tracked, because the ladder always lands — but
    // marked as somebody else's wilderness rather than their doorstep.
    sim.monsters[0].lairY = 12 + THREAT_RANGE + 2;
    expect(threat(sim).monster).toBe(1);
    expect(threat(sim).caption).toMatch(/^far wilds: /);

    // The moment the colony builds something the anchor is *that*, wherever the
    // folk happen to be standing: a colony is where its things are — and this
    // den is near the building even though it was far from the folk.
    sim.buildings.push(testBuilding({ x: 12, y: 20 }));
    expect(threat(sim).caption).not.toMatch(/far wilds/);
  });
});

describe("what the ribbon may know about hunger", () => {
  it("counts the slowed, not everyone who is merely due a meal", () => {
    // The distinction is the whole reason the readout is trustworthy: a colony
    // walking to lunch is not a colony in trouble, and a suffix that flickered
    // at every meal would be noise (docs/specs/2026-09-08-bread-economy.md).
    const sim = peopled();
    const c = sim.colonists[0];
    expect(readout(sim).hungry).toBe(0);

    c.hunger = MEAL_TICKS;
    expect(readout(sim).hungry).toBe(0);
    c.hunger = HUNGRY_TICKS;
    expect(readout(sim).hungry).toBe(1);

    // A wanderer is in none of the numbers, this one included: they do not
    // hunger at all until they settle.
    c.dest = 7;
    expect(readout(sim).hungry).toBe(0);
    expect(readout(sim).folk).toBe(0);
  });
});

describe("what the ribbon may know about idle hands", () => {
  it("counts hands the player could spend, so somebody at a meal is not idle", () => {
    // `idle` is how the player reads the pool's slack, so it has to mean
    // available for work: an eater holds no task and cannot take one either,
    // and counted the other way day two reads `5 idle` with every starting
    // hunger clock due at once
    // (docs/changelog/2026-09-09-idle-means-available.md).
    const sim = peopled();
    const c = sim.colonists[0];
    expect(readout(sim).idle).toBe(1);

    // Away at a meal: still a pool worker, no longer a spendable pair of hands.
    c.eating = 1;
    expect(readout(sim).idle).toBe(0);
    expect(readout(sim).pool).toBe(1);

    // A claimed task is the other way to stop being idle, unchanged.
    c.eating = 0;
    c.task = 3;
    expect(readout(sim).idle).toBe(0);
  });
});

describe("what a House says about the food gate", () => {
  it("reports the table as short only when bread, not the cap, is what holds arrivals", () => {
    const sim = peopled();
    const house = testBuilding({ id: 40, kind: BuildingKind.House, x: 4, y: 4 });
    sim.buildings.push(house);
    // One settled colonist, no bread, room under the cap: the gate is shut and
    // it is the larder that shuts it.
    expect(inspect(sim, house.id)?.tableShort).toBe(true);

    // A loaf per head plus the newcomer clears it.
    spawnItem(sim, ItemType.Bread, 8, 8);
    spawnItem(sim, ItemType.Bread, 8, 8);
    expect(inspect(sim, house.id)?.tableShort).toBe(false);

    // And the *cap* holding arrivals is not the table being short: a colony at
    // its cap with an empty larder says nothing, because bread is not what is
    // stopping anybody.
    for (const loaf of [...sim.items]) sim.items.splice(sim.items.indexOf(loaf), 1);
    while (sim.colonists.length < STARTING_COLONISTS + 2) {
      sim.colonists.push({ ...sim.colonists[0], id: sim.nextId++ });
    }
    expect(inspect(sim, house.id)?.tableShort).toBe(false);

    // Nothing but a House ever reports it, and neither does an unfinished one.
    const mill = testBuilding({ id: 41, kind: BuildingKind.Sawmill, x: 12, y: 4 });
    const site = testBuilding({ id: 42, kind: BuildingKind.House, x: 12, y: 12, state: BuildingState.Blueprint });
    sim.buildings.push(mill, site);
    expect(inspect(sim, mill.id)?.tableShort).toBe(false);
    expect(inspect(sim, site.id)?.tableShort).toBe(false);
  });
});
