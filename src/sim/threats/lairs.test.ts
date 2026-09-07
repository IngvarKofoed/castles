import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decode } from "../save/codec";
import { FIXTURE_SEED_V3 } from "../save/fixtures/recipe";
import { MonsterKind, MonsterPhase, createSim, type Sim } from "../store";
import {
  LAIR_CLEAR_RADIUS,
  LAIR_SPACING,
  LAIR_TARGET,
  OUTER_BAND,
  PERIOD_SPREAD,
  PROWL_BASE,
  REST_BASE,
} from "../tuning";
import { MIGRATIONS } from "../save/migrations";
import { WallState } from "../walls";
import { recomputeEnclosure } from "../walls/enclosure";
import { threatNear } from "./flee";
import { spawnLairs } from "./lairs";
import { Terrain, generate, tileIndex } from "../world/world";

/**
 * The lair pass. What is pinned here is not the exact map — that is a function
 * of the seed — but the *properties* the pass promises: a full complement of
 * dens, spaced out, denser outward, with the spawn clearing empty and no
 * protected radius beyond it, and hours that differ per monster.
 */

const SEEDS = [20260901, 20260904, 20260981, 42];
const CENTRE = 127.5;

const distance = (x: number, y: number): number => Math.hypot(x - CENTRE, y - CENTRE);

/**
 * A big ring, out where dens are common rather than near the middle where the
 * gradient makes them rare — otherwise the "no den inside" assertion would be
 * true because nothing was ever going to land there.
 */
const RING = { x: 60, y: 60, size: 64 };

/** A colony that has walled a large square, with its enclosure worked out. */
function ringed(seed: number): Sim {
  const sim = createSim(seed);
  const n = sim.world.size;
  for (let k = 0; k < RING.size; k++) {
    sim.wallMap[tileIndex(RING.x + k, RING.y, n)] = WallState.Stone;
    sim.wallMap[tileIndex(RING.x + k, RING.y + RING.size - 1, n)] = WallState.Stone;
    sim.wallMap[tileIndex(RING.x, RING.y + k, n)] = WallState.Stone;
    sim.wallMap[tileIndex(RING.x + RING.size - 1, RING.y + k, n)] = WallState.Stone;
  }
  sim.monsters = [];
  recomputeEnclosure(sim);
  return sim;
}

/** The same store as a version-3 save would have carried: no monsters, no
 *  damage layer, no graves. */
function v3Shaped(sim: Sim): Record<string, unknown> {
  const { monsters, wallDamageMap, graveMap, ...rest } = sim as unknown as Record<string, unknown> & Sim;
  void monsters;
  void wallDamageMap;
  void graveMap;
  return { ...rest };
}

describe("the lair pass", () => {
  it("fills the map to its target, on every seed", () => {
    for (const seed of SEEDS) {
      const sim = createSim(seed);
      expect(sim.monsters.length, `seed ${seed}`).toBe(LAIR_TARGET);
    }
  });

  it("keeps dens apart", () => {
    const sim = createSim(20260901);
    for (const a of sim.monsters) {
      for (const b of sim.monsters) {
        if (a.id === b.id) continue;
        const d = Math.max(Math.abs(a.lairX - b.lairX), Math.abs(a.lairY - b.lairY));
        expect(d).toBeGreaterThanOrEqual(LAIR_SPACING);
      }
    }
  });

  it("puts every den on walkable ground, never in water, rock or a wood", () => {
    for (const seed of SEEDS) {
      const sim = createSim(seed);
      for (const m of sim.monsters) {
        const i = tileIndex(m.lairX, m.lairY, sim.world.size);
        expect([Terrain.Grass, Terrain.Sand]).toContain(sim.world.tmap[i]);
        expect(sim.world.treeMap[i]).toBe(0);
      }
    }
  });

  it("leaves the spawn clearing alone, and protects nothing beyond it", () => {
    // Two halves of one deliberate decision (docs/specs/2026-09-04-monsters.md,
    // Alternatives): the clearing is excluded for spawn sanity, and there is no
    // safe radius past it — the outward gradient is the only mercy. So the
    // assertion is a floor, not a moat.
    for (const seed of SEEDS) {
      const sim = createSim(seed);
      for (const m of sim.monsters) {
        expect(distance(m.lairX, m.lairY)).toBeGreaterThan(LAIR_CLEAR_RADIUS);
      }
    }
  });

  it("grows denser outward", () => {
    // Counted over several seeds, because one map's draw is a small sample. The
    // gradient is quadratic in radius, so the outer band should hold the clear
    // majority of dens.
    let inner = 0;
    let outer = 0;
    for (const seed of SEEDS) {
      for (const m of createSim(seed).monsters) {
        if (distance(m.lairX, m.lairY) / 128 >= OUTER_BAND) outer++;
        else inner++;
      }
    }
    expect(outer).toBeGreaterThan(inner);
  });

  it("weights trolls to the outer band", () => {
    let innerTrolls = 0;
    let outerTrolls = 0;
    let innerAll = 0;
    let outerAll = 0;
    for (const seed of SEEDS) {
      for (const m of createSim(seed).monsters) {
        const out = distance(m.lairX, m.lairY) / 128 >= OUTER_BAND;
        if (out) {
          outerAll++;
          if (m.kind === MonsterKind.Troll) outerTrolls++;
        } else {
          innerAll++;
          if (m.kind === MonsterKind.Troll) innerTrolls++;
        }
      }
    }
    expect(outerTrolls / outerAll).toBeGreaterThan(innerTrolls / innerAll);
  });

  it("gives every monster its own hours, inside the spread", () => {
    const sim = createSim(20260901);
    const rests = new Set<number>();
    for (const m of sim.monsters) {
      expect(m.restTicks).toBeGreaterThanOrEqual(Math.round(REST_BASE * (1 - PERIOD_SPREAD)));
      expect(m.restTicks).toBeLessThanOrEqual(Math.round(REST_BASE * (1 + PERIOD_SPREAD)));
      // The outward gradient multiplies the prowl share, up to double.
      expect(m.prowlTicks).toBeGreaterThanOrEqual(Math.round(PROWL_BASE * (1 - PERIOD_SPREAD)));
      expect(m.prowlTicks).toBeLessThanOrEqual(Math.round(PROWL_BASE * (1 + PERIOD_SPREAD) * 2) + 1);
      expect(m.phaseTicks).toBeGreaterThan(0);
      expect([MonsterPhase.Rest, MonsterPhase.Prowl]).toContain(m.phase);
      rests.add(m.restTicks);
    }
    // Lairs must not tick in unison, which is what makes each one's window its
    // own thing to learn.
    expect(rests.size).toBeGreaterThan(sim.monsters.length / 2);
  });

  it("is a pure function of the world seed", () => {
    const a = createSim(20260901).monsters;
    const b = createSim(20260901).monsters;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("wakes the same monsters for a migrated v3 save as for a fresh game", () => {
    // The load-bearing property of the v4 rung: the pass reads the world seed
    // and nothing else, so an old colony's wilderness is the same wilderness a
    // new game on that seed would have had. Only the ids differ, because those
    // come off the save's own counter.
    const fresh = createSim(20260904);
    const migrated = MIGRATIONS[3]({
      world: fresh.world,
      nextId: 5000,
      monsters: undefined,
    }) as { monsters: typeof fresh.monsters };

    expect(migrated.monsters).toHaveLength(fresh.monsters.length);
    const strip = (m: (typeof fresh.monsters)[number]): string =>
      JSON.stringify({ ...m, id: 0 });
    expect(migrated.monsters.map(strip)).toEqual(fresh.monsters.map(strip));
    // And the ids really did come from the save's counter, not the world's.
    expect(migrated.monsters[0].id).toBe(5000);
  });

  it("never wakes a den inside ground an old colony had already walled", () => {
    // Lair ground is never "inside" (walls/enclosure), so a den waking within
    // an old ring would turn that colony's whole interior to open country on
    // load — unchosen and unrecoverable. The rung refuses those tiles.
    //
    // Checked across several seeds, and paired with the *vacuity* check below:
    // a test that passes because nothing would ever have landed there proves
    // nothing at all.
    let wouldHave = 0;
    for (const seed of SEEDS) {
      const walled = ringed(seed);
      const inside = walled.insideMap;

      const migrated = MIGRATIONS[3](v3Shaped(walled)) as { monsters: typeof walled.monsters };
      for (const m of migrated.monsters) {
        const i = tileIndex(m.lairX, m.lairY, walled.world.size);
        expect(inside[i], `seed ${seed}`).toBe(0);
        // And not on the ring either. A wall tile is never "inside", so masking
        // the enclosure alone would let a den land *on* the wall — and since a
        // lair seeds the flood unconditionally, one den there floods everything
        // behind it and the colony loses its enclosure just the same.
        expect(walled.wallMap[i], `seed ${seed}`).toBe(WallState.None);
      }

      // The same state, spawned with no mask: how many dens the colony's own
      // ground would have taken if the rung did not refuse them.
      const unmasked = { ...v3Shaped(walled), monsters: [] } as unknown as typeof walled;
      spawnLairs(unmasked, generate(seed));
      wouldHave += unmasked.monsters.filter((m) => {
        const i = tileIndex(m.lairX, m.lairY, walled.world.size);
        return inside[i] || walled.wallMap[i] !== WallState.None;
      }).length;
    }
    expect(wouldHave, "the rings enclose no ground a den would ever want").toBeGreaterThan(0);
  });

  it("leaves the walled interior enclosed, and the folk in it calm", () => {
    const walled = ringed(20260901);
    const migrated = MIGRATIONS[3](v3Shaped(walled)) as unknown as Sim;
    // The fill that matters is the one `decode` runs after every rung: it seeds
    // from the new dens as well as the map edge, which is exactly the flood
    // that used to swallow the colony.
    recomputeEnclosure(migrated);

    const middle = tileIndex(RING.x + 4, RING.y + 4, migrated.world.size);
    expect(migrated.insideMap[middle]).toBe(1);
    expect(migrated.monsters.length).toBeGreaterThan(0);

    // And a colonist standing in there has nothing to run from, whatever the
    // wilds outside are doing.
    migrated.colonists = [
      {
        id: 1,
        x: RING.x + 4.5,
        y: RING.y + 4.5,
        px: RING.x + 4.5,
        py: RING.y + 4.5,
        heading: 0,
        slot: -1,
        inside: 0,
        task: -1,
        phase: 0,
        work: 0,
        carrying: -1,
        path: [],
        step: 0,
      },
    ];
    for (const m of migrated.monsters) m.phase = MonsterPhase.Prowl;
    expect(threatNear(migrated, migrated.colonists[0])).toBeNull();
  });

  it("wakes them the same for a world the colony has already worked", async () => {
    // The half the test above cannot see, and the reason the rung regenerates
    // the world instead of reading the save's: a real v3 save has been *played*
    // on — trees felled, outcrops quarried — and the pass filters candidates on
    // exactly those two layers. Since the candidate list is a running
    // cumulative weight, one tile gained or lost moves every later draw. Run
    // against the committed v3 fixture, whose recipe deliberately chops and
    // mines, so the world it carries genuinely differs from its seed's.
    const played = await decode(readFileSync(new URL("../save/fixtures/v3.castles", import.meta.url)));
    const pristine = generate(FIXTURE_SEED_V3);
    const worked = [...played.world.treeMap].filter((v, i) => v !== pristine.treeMap[i]).length;
    expect(worked, "the fixture's world is unplayed — this test proves nothing").toBeGreaterThan(0);

    const fresh = createSim(FIXTURE_SEED_V3);
    const den = (m: { lairX: number; lairY: number; kind: number; restTicks: number; prowlTicks: number }): string =>
      `${m.lairX},${m.lairY},k${m.kind},r${m.restTicks},p${m.prowlTicks}`;
    expect(played.monsters.map(den)).toEqual(fresh.monsters.map(den));
  });
});
