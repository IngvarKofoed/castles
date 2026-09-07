import { describe, expect, it } from "vitest";
import { MonsterPhase, type Colonist, type Sim } from "../store";
import { flatSim, testBuilding, testMonster } from "../test-sim";
import { DAY_TICKS, RHYTHM_FUZZ, THREAT_BUCKETS, THREAT_RANGE } from "../tuning";
import { WallState } from "../walls";
import { recomputeEnclosure } from "../walls/enclosure";
import { tileIndex } from "../world/world";
import { monsterAtTile, monsters, rhythm, threat } from "./index";

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

function peopled(size = 24): Sim {
  const sim = flatSim(size);
  const c: Colonist = {
    id: sim.nextId++,
    x: 12.5,
    y: 12.5,
    px: 12.5,
    py: 12.5,
    heading: 0,
    slot: -1,
    inside: 0,
    task: -1,
    phase: 0,
    work: 0,
    carrying: -1,
    path: [],
    step: 0,
  };
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
