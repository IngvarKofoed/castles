import { describe, expect, it } from "vitest";
import { MonsterPhase, type Colonist, type Sim } from "../store";
import { flatSim, testBuilding, testColonist, testMonster } from "../test-sim";
import {
  GATE_HP,
  ORC_BITE_TICKS,
  PALISADE_HP,
  TICK_HZ,
  TROLL_BITE,
  TROLL_BITE_TICKS,
  WITHDRAW_BACKSTOP,
} from "../tuning";
import { WallState, damageTier } from "../walls";
import { recomputeEnclosure } from "../walls/enclosure";
import { tileIndex } from "../world/world";
import { stepMonsters } from "./monsters";

/**
 * The rules a monster runs on, pinned one at a time on flat ground with a
 * hand-placed monster — so each assertion is about the rule rather than about
 * whatever a landing happened to put in the way. The landing itself is
 * `incursion.test.ts`'s job, and the whole tier working together is
 * `encounter.test.ts`'s.
 *
 * Every monster here is placed by hand rather than landed, and `flatSim` opens
 * with the full opening grace on its clock — so nothing below ever meets a storm
 * it did not ask for.
 */

const at = (sim: Sim, x: number, y: number): number => tileIndex(x, y, sim.world.size);

function walker(sim: Sim, x: number, y: number, patch: Partial<Colonist> = {}): Colonist {
  const c = testColonist({ id: sim.nextId++, x: x + 0.5, y: y + 0.5, ...patch });
  sim.colonists.push(c);
  return c;
}

/** Run the monster system alone, without the rest of the tick. */
function steps(sim: Sim, n: number): void {
  for (let i = 0; i < n; i++) stepMonsters(sim);
}

describe("the storm's clock", () => {
  it("is dangerous ashore and harmless withdrawing", () => {
    const sim = flatSim(16);
    sim.wallMap[at(sim, 8, 4)] = WallState.Palisade;
    sim.monsters.push(
      testMonster({ x: 4.5, y: 4.5, phase: MonsterPhase.Withdrawing, phaseTicks: WITHDRAW_BACKSTOP, landX: 4, landY: 12 }),
    );

    // Withdrawing: it notices nothing, and nothing it walks past is touched.
    steps(sim, 20);
    expect(sim.monsters[0].targetTile).toBe(-1);
    expect(sim.wallDamageMap[at(sim, 8, 4)]).toBe(0);
  });

  it("disengages mid-bite when the storm clock runs out, and turns for the boats", () => {
    // CONCEPT's "an attack ends only when the monster leaves", made literal:
    // the clock is the law, and it is what makes outlasting a real plan. The
    // clock is now the colony's weather rather than the monster's own hours, so
    // every monster ashore turns on the same tick.
    const sim = flatSim(16);
    const wall = at(sim, 6, 4);
    sim.wallMap[wall] = WallState.Palisade;
    sim.stormTicks = 200;
    sim.monsters.push(testMonster({ x: 2.5, y: 4.5, landX: 2, landY: 14 }));

    steps(sim, 199);
    const bitten = sim.wallDamageMap[wall];
    expect(bitten).toBeGreaterThan(0);
    expect(bitten).toBeLessThan(PALISADE_HP);

    steps(sim, 1);
    expect(sim.monsters[0].phase).toBe(MonsterPhase.Withdrawing);
    expect(sim.monsters[0].targetTile).toBe(-1);
    steps(sim, 20);
    // Left standing, with its wounds — the segment survived because the storm
    // passed, not because anybody drove the monster off.
    expect(sim.wallMap[wall]).toBe(WallState.Palisade);
    expect(sim.wallDamageMap[wall]).toBe(bitten);
  });

  it("is gone the moment it reaches its boat", () => {
    const sim = flatSim(16);
    const wall = at(sim, 6, 4);
    sim.wallMap[wall] = WallState.Palisade;
    sim.monsters.push(
      testMonster({ x: 7.5, y: 4.5, phase: MonsterPhase.Withdrawing, phaseTicks: WITHDRAW_BACKSTOP, landX: 2, landY: 4 }),
    );
    steps(sim, 60);
    expect(sim.wallDamageMap[wall]).toBe(0);
    expect(sim.monsters).toHaveLength(0);
    // Removing one changes the enclosure's seed set, so the fill is flagged.
    expect(sim.enclosureDirty).toBe(1);
  });

  it("is removed on the backstop clock when its way to the boats is walled off", () => {
    // Without this a player who closed a ring at the wrong moment keeps a
    // permanent resident — the den problem reborn, and indoors this time.
    const sim = flatSim(20);
    for (const [x, y] of [[3, 3], [4, 3], [5, 3], [5, 4], [5, 5], [4, 5], [3, 5], [3, 4]]) {
      sim.wallMap[at(sim, x, y)] = WallState.Stone;
    }
    sim.monsters.push(
      testMonster({ x: 4.5, y: 4.5, phase: MonsterPhase.Withdrawing, phaseTicks: 40, landX: 15, landY: 15 }),
    );
    recomputeEnclosure(sim);
    // Sealed in stone with nowhere to go and nothing to chew: it stays until
    // the clock says otherwise, and then it is simply not there.
    steps(sim, 39);
    expect(sim.monsters).toHaveLength(1);
    steps(sim, 1);
    expect(sim.monsters).toHaveLength(0);
  });

  it("detours round a wall raised across its way to the boats", () => {
    // `move` throws a stored route away when one of its steps stops being legal
    // — a segment finished across it, ground raised into a cliff — and an empty
    // route is otherwise indistinguishable from a finished one. Read as
    // "arrived", it would take a monster off the map nowhere near its boat.
    const sim = flatSim(16);
    sim.monsters.push(
      testMonster({ x: 12.5, y: 8.5, phase: MonsterPhase.Withdrawing, phaseTicks: WITHDRAW_BACKSTOP, landX: 2, landY: 8 }),
    );
    const m = sim.monsters[0];
    steps(sim, 4);
    expect(m.path.length).toBeGreaterThan(m.step);
    expect(sim.monsters).toHaveLength(1);

    // Stone across the very next tile of the stored route: finished stone is
    // not damageable, so there is nothing to chew and a detour is the only
    // answer available.
    sim.wallMap[m.path[m.step]] = WallState.Stone;
    steps(sim, 1);
    expect(m.phase).toBe(MonsterPhase.Withdrawing);
    expect(sim.monsters).toHaveLength(1);

    steps(sim, 120);
    expect(sim.monsters).toHaveLength(0);
  });
});

describe("notice and the hold", () => {
  it("takes the nearest noticeable thing, and keeps it", () => {
    const sim = flatSim(20);
    const near = at(sim, 6, 4);
    const far = at(sim, 9, 4);
    sim.wallMap[near] = WallState.Palisade;
    sim.wallMap[far] = WallState.Palisade;
    sim.monsters.push(testMonster({x: 2 + 0.5, y: 4 + 0.5}));

    steps(sim, 30);
    expect(sim.monsters[0].targetTile).toBe(near);
    // A second, closer segment appearing does not steal the hold: no per-tick
    // nearest-swapping, so a chasing monster never abandons its victim for a
    // closer fence post.
    sim.wallMap[at(sim, 4, 4)] = WallState.Palisade;
    steps(sim, 10);
    expect(sim.monsters[0].targetTile).toBe(near);
  });

  it("ignores a colonist standing on enclosed ground", () => {
    const sim = flatSim(20);
    // A closed ring with one tile inside it.
    for (const [x, y] of [[8, 8], [9, 8], [10, 8], [10, 9], [10, 10], [9, 10], [8, 10], [8, 9]]) {
      sim.wallMap[at(sim, x, y)] = WallState.Stone;
    }
    recomputeEnclosure(sim);
    expect(sim.insideMap[at(sim, 9, 9)]).toBe(1);
    const safe = walker(sim, 9, 9);
    sim.monsters.push(testMonster({x: 6.5, y: 9.5}));

    steps(sim, 20);
    expect(sim.monsters[0].target).toBe(-1);
    expect(sim.colonists).toContain(safe);
  });

  it("ignores a colonist who is indoors, wherever the building stands", () => {
    const sim = flatSim(16);
    sim.buildings.push(testBuilding({ x: 6, y: 4 }));
    walker(sim, 6, 4, { inside: 1, slot: 99 });
    sim.monsters.push(testMonster({x: 2 + 0.5, y: 4 + 0.5}));
    steps(sim, 40);
    expect(sim.monsters[0].target).toBe(-1);
    expect(sim.colonists).toHaveLength(1);
  });
});

describe("the bite", () => {
  it("lands on the kind's cadence, and finished stone is never touched", () => {
    const sim = flatSim(16);
    const timber = at(sim, 6, 4);
    sim.wallMap[timber] = WallState.Palisade;
    sim.monsters.push(testMonster({x: 4 + 0.5, y: 4 + 0.5}));
    // Walk over, then exactly one bite interval of contact.
    steps(sim, 20);
    const before = sim.wallDamageMap[timber];
    steps(sim, ORC_BITE_TICKS);
    expect(sim.wallDamageMap[timber]).toBe(before + 1);

    const stone = flatSim(16);
    stone.wallMap[at(stone, 6, 4)] = WallState.Stone;
    stone.monsters.push(testMonster({x: 4 + 0.5, y: 4 + 0.5}));
    steps(stone, 100);
    expect(stone.wallDamageMap[at(stone, 6, 4)]).toBe(0);
    expect(stone.wallMap[at(stone, 6, 4)]).toBe(WallState.Stone);
    // Nothing to notice at all, so it never acquires a target.
    expect(stone.monsters[0].targetTile).toBe(-1);
  });

  it("a troll ruins a palisade in about twenty seconds, an orc in about forty", () => {
    const ruin = (kind: number): number => {
      const sim = flatSim(20);
      sim.wallMap[at(sim, 6, 4)] = WallState.Palisade;
      sim.monsters.push(testMonster({kind, x: 5.5, y: 4.5}));
      for (let t = 0; t < 2000; t++) {
        stepMonsters(sim);
        if (sim.wallMap[at(sim, 6, 4)] === WallState.None) return t;
      }
      return -1;
    };
    const orc = ruin(0);
    const troll = ruin(1);
    expect(orc).toBeGreaterThan(0);
    expect(troll).toBeGreaterThan(0);
    // Within a couple of seconds of the spec's figures, allowing for the walk in.
    expect(orc / TICK_HZ).toBeGreaterThan(35);
    expect(orc / TICK_HZ).toBeLessThan(50);
    expect(troll / TICK_HZ).toBeLessThan(orc / TICK_HZ);
  });

  it("kills a blueprint in one bite, whatever the numbers say", () => {
    const sim = flatSim(16);
    const bp = at(sim, 6, 4);
    sim.wallMap[bp] = WallState.PalisadeBp;
    sim.monsters.push(testMonster({x: 4 + 0.5, y: 4 + 0.5}));
    steps(sim, 20 + ORC_BITE_TICKS);
    expect(sim.wallMap[bp]).toBe(WallState.None);
    expect(sim.wallDamageMap[bp]).toBe(0);
  });

  it("brings a segment down at its maximum, with no refund, and reopens the ground", () => {
    const sim = flatSim(20);
    // A stone ring with one timber segment in its west face: only that one can
    // be touched, so which tile the monster takes is not left to chance.
    for (const [x, y] of [[8, 8], [9, 8], [10, 8], [10, 9], [10, 10], [9, 10], [8, 10]]) {
      sim.wallMap[at(sim, x, y)] = WallState.Stone;
    }
    const weak = at(sim, 8, 9);
    sim.wallMap[weak] = WallState.Palisade;
    sim.wallDamageMap[weak] = PALISADE_HP - 1;
    sim.monsters.push(testMonster({x: 6.5, y: 9.5}));
    recomputeEnclosure(sim);
    expect(sim.insideMap[at(sim, 9, 9)]).toBe(1);

    steps(sim, ORC_BITE_TICKS + 12);

    expect(sim.wallMap[weak]).toBe(WallState.None);
    // No refund: the material went into something a monster ate.
    expect(sim.items).toHaveLength(0);
    // The hole is real: the recompute is flagged, and the calm zone goes with
    // it — no breach code anywhere, just "inside" honestly stopping.
    expect(sim.enclosureDirty).toBe(1);
    recomputeEnclosure(sim);
    expect(sim.insideMap[at(sim, 9, 9)]).toBe(0);
  });

  it("rebakes the chunk only when the damage crosses a third", () => {
    const sim = flatSim(20);
    const wall = at(sim, 6, 4);
    sim.wallMap[wall] = WallState.Palisade;
    // A troll's bite is four points, so the crossings are countable.
    sim.monsters.push(testMonster({kind: 1, x: 5.5, y: 4.5}));
    let versions = sim.world.chunkVersion[0];
    let bumps = 0;
    let tiers = 0;
    let tier = 0;
    for (let t = 0; t < TROLL_BITE_TICKS * (PALISADE_HP / TROLL_BITE) - 1; t++) {
      stepMonsters(sim);
      if (sim.world.chunkVersion[0] !== versions) {
        bumps++;
        versions = sim.world.chunkVersion[0];
      }
      const now = damageTier(sim.wallMap[wall], sim.wallDamageMap[wall]);
      if (now !== tier) {
        tiers++;
        tier = now;
      }
    }
    expect(tiers).toBe(2);
    expect(bumps).toBe(2);
  });
});

describe("where a monster may go", () => {
  it("never walks through a gate, though it will happily gnaw on one", () => {
    const sim = flatSim(16);
    // A stone wall across the map with one wooden gate in it, and a colonist
    // behind it. The gate is the only way through and the only thing a monster
    // can hurt, which is exactly the pair of facts being pinned.
    for (let y = 0; y < 16; y++) sim.wallMap[at(sim, 8, y)] = WallState.Stone;
    sim.wallMap[at(sim, 8, 4)] = WallState.Gate;
    const behind = walker(sim, 12, 4);
    sim.monsters.push(testMonster({x: 6.5, y: 4.5}));
    recomputeEnclosure(sim);

    steps(sim, 200);
    expect(sim.colonists).toContain(behind);
    expect(sim.monsters[0].x).toBeLessThan(8);
    // A wooden gate is damageable, so it *is* being worked on — it simply has
    // not fallen, and until it does nothing gets through it.
    expect(sim.wallDamageMap[at(sim, 8, 4)]).toBeGreaterThan(0);
    expect(sim.wallDamageMap[at(sim, 8, 4)]).toBeLessThan(GATE_HP);
    expect(sim.wallMap[at(sim, 8, 4)]).toBe(WallState.Gate);
  });

  it("walks over a drawn line harmlessly when it has already eaten it", () => {
    // Blueprints are open ground to a monster: it crosses a drawn run rather
    // than being stopped by sticks.
    const sim = flatSim(16);
    for (let y = 0; y < 16; y++) sim.wallMap[at(sim, 8, y)] = WallState.PalisadeBp;
    const beyond = walker(sim, 10, 4);
    sim.monsters.push(testMonster({x: 6.5, y: 4.5}));
    steps(sim, 400);
    expect(sim.colonists).not.toContain(beyond);
  });

  it("chews its way out of a palisade pen rather than becoming furniture", () => {
    const sim = flatSim(20);
    for (const [x, y] of [[3, 3], [4, 3], [5, 3], [5, 4], [5, 5], [4, 5], [3, 5], [3, 4]]) {
      sim.wallMap[at(sim, x, y)] = WallState.Palisade;
    }
    recomputeEnclosure(sim);
    sim.monsters.push(testMonster({ x: 4.5, y: 4.5 }));
    steps(sim, 600);
    const standing = [...sim.wallMap].filter((v) => v === WallState.Palisade).length;
    expect(standing).toBeLessThan(8);
  });

  it("waits where it stands when only stone and cliffs hold it", () => {
    const sim = flatSim(20);
    for (const [x, y] of [[3, 3], [4, 3], [5, 3], [5, 4], [5, 5], [4, 5], [3, 5], [3, 4]]) {
      sim.wallMap[at(sim, x, y)] = WallState.Stone;
    }
    sim.monsters.push(testMonster({ x: 4.5, y: 4.5 }));
    // The fill runs *after* the monster exists, because a monster is one of its
    // seeds — which is the whole point of the assertion below.
    recomputeEnclosure(sim);
    steps(sim, 300);
    // Contained and unhurt — and the pen it is in is *not* calm ground, which is
    // what stops this being a way to win.
    expect([...sim.wallMap].filter((v) => v === WallState.Stone)).toHaveLength(8);
    expect(sim.insideMap[at(sim, 4, 4)]).toBe(0);
  });
});
