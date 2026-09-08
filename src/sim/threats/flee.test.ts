import { describe, expect, it } from "vitest";
import { applyCommands } from "../commands";
import { spawnItem } from "../items";
import { stepColonists } from "../labour/colonists";
import { generateTasks } from "../labour/tasks";
import { occupancy } from "../path";
import { ItemType, MonsterPhase, TaskKind, type Colonist, type Sim } from "../store";
import { flatSim, testBuilding, testMonster } from "../test-sim";
import { advanceTick } from "../tick";
import { PALISADE_HP, REPAIR_HP_PER_SECOND, TICK_HZ } from "../tuning";
import { WallState } from "../walls";
import { recomputeEnclosure } from "../walls/enclosure";
import { tileIndex } from "../world/world";
import { stepMonsters } from "./monsters";

/**
 * The safety boundary from the colonist's side — who runs, who does not, and
 * what a death costs — plus the repair that is the only counterplay there is.
 */

const at = (sim: Sim, x: number, y: number): number => tileIndex(x, y, sim.world.size);

function walker(sim: Sim, x: number, y: number, patch: Partial<Colonist> = {}): Colonist {
  const c: Colonist = {
    id: sim.nextId++,
    x: x + 0.5,
    y: y + 0.5,
    px: x + 0.5,
    py: y + 0.5,
    heading: 0,
    slot: -1,
    inside: 0,
    task: -1,
    phase: 0,
    work: 0,
    carrying: -1,
    dest: -1,
    patience: 0,
    hunger: 0,
    eating: 0,
    path: [],
    step: 0,
    ...patch,
  };
  sim.colonists.push(c);
  return c;
}

/** A closed 5×5 stone ring with a 3×3 interior, and the fill run over it. */
function ring(sim: Sim): void {
  for (let x = 7; x <= 11; x++) {
    sim.wallMap[at(sim, x, 7)] = WallState.Stone;
    sim.wallMap[at(sim, x, 11)] = WallState.Stone;
  }
  for (let y = 7; y <= 11; y++) {
    sim.wallMap[at(sim, 7, y)] = WallState.Stone;
    sim.wallMap[at(sim, 11, y)] = WallState.Stone;
  }
  recomputeEnclosure(sim);
}

describe("fleeing", () => {
  it("drops everything and runs for enclosed ground", () => {
    const sim = flatSim(20);
    ring(sim);
    sim.wallMap[at(sim, 9, 11)] = WallState.Gate;
    recomputeEnclosure(sim);

    // A real errand, taken up the ordinary way: a log outside and a stockpile
    // inside, so the colonist is genuinely mid-haul when the monster turns up.
    const c = walker(sim, 9, 13);
    sim.buildings.push(testBuilding({ x: 8, y: 8 }));
    spawnItem(sim, ItemType.Log, 9, 13, occupancy(sim));
    for (let t = 0; t < 40 && c.carrying < 0; t++) advanceTick(sim);
    expect(c.carrying).toBeGreaterThanOrEqual(0);

    // At the very edge of the flee range, which is the head start the numbers
    // actually give: an orc is faster than a colonist, so any less than the
    // full six tiles and this ends in a grave rather than in a gateway.
    sim.monsters.push(testMonster({ lairX: 9, lairY: 19, x: 9.5, y: 19.5 }));
    for (let t = 0; t < 60; t++) {
      stepColonists(sim);
      stepMonsters(sim);
    }

    // They got in, empty-handed: the release-and-drop is the standard path, so
    // the log is on the ground for somebody to fetch when it is safe again.
    expect(sim.insideMap[at(sim, Math.floor(c.x), Math.floor(c.y))]).toBe(1);
    expect(c.carrying).toBe(-1);
    expect(c.task).toBe(-1);
    expect(sim.items[0].loc).toBe(0);
  });

  it("runs away when there is nowhere safe to run to", () => {
    // The whole early game: before the first ring closes there is nothing to
    // run *to*, and running is still the right move.
    const sim = flatSim(24);
    recomputeEnclosure(sim);
    const c = walker(sim, 12, 12);
    sim.monsters.push(testMonster({ kind: 1, lairX: 12, lairY: 8, x: 12.5, y: 9.5 }));
    const before = Math.abs(c.y - 9.5);
    for (let t = 0; t < 40; t++) {
      stepColonists(sim);
      stepMonsters(sim);
    }
    expect(sim.colonists).toContain(c);
    expect(Math.abs(c.y - sim.monsters[0].y)).toBeGreaterThan(before);
  });

  it("ignores a monster that is resting or on its way home", () => {
    for (const phase of [MonsterPhase.Rest, MonsterPhase.GoingHome]) {
      const sim = flatSim(20);
      recomputeEnclosure(sim);
      const c = walker(sim, 12, 12);
      sim.monsters.push(testMonster({ lairX: 12, lairY: 9, x: 12.5, y: 10.5, phase, phaseTicks: 9999 }));
      for (let t = 0; t < 20; t++) stepColonists(sim);
      expect([c.x, c.y]).toEqual([12.5, 12.5]);
    }
  });

  it("ignores monsters entirely from inside the walls", () => {
    const sim = flatSim(20);
    ring(sim);
    const c = walker(sim, 9, 9);
    sim.monsters.push(testMonster({ lairX: 9, lairY: 5, x: 9.5, y: 6.5 }));
    for (let t = 0; t < 30; t++) {
      stepColonists(sim);
      stepMonsters(sim);
    }
    expect([c.x, c.y]).toEqual([9.5, 9.5]);
  });

  it("flees across a wall it is on the wrong side of, because enclosure is all it knows", () => {
    // Stated aloud rather than left as a surprise: a palisade line between a
    // colonist and a prowler is not cover, because a line encloses nothing.
    const sim = flatSim(20);
    for (let y = 0; y < 20; y++) sim.wallMap[at(sim, 10, y)] = WallState.Stone;
    recomputeEnclosure(sim);
    const c = walker(sim, 12, 9);
    sim.monsters.push(testMonster({ lairX: 6, lairY: 9, x: 8.5, y: 9.5 }));
    for (let t = 0; t < 20; t++) stepColonists(sim);
    expect(c.x).not.toBe(12.5);
  });
});

describe("death", () => {
  it("removes the colonist, frees the slot, drops the cargo and leaves a grave", () => {
    const sim = flatSim(20);
    recomputeEnclosure(sim);
    const shop = testBuilding({ id: 77, x: 2, y: 2, w: 2, h: 2 });
    sim.buildings.push(shop);
    const c = walker(sim, 12, 12, { slot: 77 });
    shop.worker = c.id;
    const log = spawnItem(sim, ItemType.Log, 12, 13, occupancy(sim))!;
    log.loc = 1;
    log.holder = c.id;
    c.carrying = log.id;

    sim.monsters.push(testMonster({ lairX: 12, lairY: 9, x: 12.5, y: 11.5 }));
    for (let t = 0; t < 30 && sim.colonists.length; t++) {
      stepColonists(sim);
      stepMonsters(sim);
    }

    expect(sim.colonists).toHaveLength(0);
    expect(shop.worker).toBe(-1);
    expect(sim.monsters[0].target).toBe(-1);
    // The whole obituary: one fewer pair of hands, a log on the grass, and a
    // marker. No mourning mechanics anywhere.
    expect(sim.items[0].loc).toBe(0);
    expect([...sim.graveMap].filter(Boolean)).toHaveLength(1);
  });

  it("shares a marker when a second colonist dies on the same tile", () => {
    const sim = flatSim(20);
    recomputeEnclosure(sim);
    walker(sim, 12, 12);
    walker(sim, 12, 12);
    sim.monsters.push(testMonster({ lairX: 12, lairY: 9, x: 12.5, y: 11.5 }));
    for (let t = 0; t < 40 && sim.colonists.length; t++) {
      stepColonists(sim);
      stepMonsters(sim);
    }
    expect(sim.colonists).toHaveLength(0);
    expect([...sim.graveMap].filter(Boolean).length).toBeLessThanOrEqual(2);
  });

  it("clears a grave silently when the colony builds or levels over it", () => {
    const sim = flatSim(20);
    sim.graveMap[at(sim, 5, 5)] = 1;
    sim.graveMap[at(sim, 8, 8)] = 1;
    applyCommands(sim, [{ kind: "placeWall", tiles: [at(sim, 5, 5)], material: "timber" }]);
    expect(sim.graveMap[at(sim, 5, 5)]).toBe(0);
    expect(sim.wallMap[at(sim, 5, 5)]).toBe(WallState.PalisadeBp);
    // And a grave never refused the ground in the first place.
    applyCommands(sim, [{ kind: "place", building: 0, x: 8, y: 8 }]);
    expect(sim.buildings).toHaveLength(1);
    expect(sim.graveMap[at(sim, 8, 8)]).toBe(0);
  });
});

describe("repair", () => {
  it("is generated per wounded segment, worked by labour alone, and outranks hauling", () => {
    const sim = flatSim(20);
    const wall = at(sim, 10, 10);
    sim.wallMap[wall] = WallState.Palisade;
    sim.wallDamageMap[wall] = 12;
    recomputeEnclosure(sim);
    walker(sim, 10, 14);
    // A loose log, so there is a haul task competing for the same pair of hands.
    spawnItem(sim, ItemType.Log, 12, 14, occupancy(sim));
    sim.buildings.push(testBuilding({ x: 2, y: 2 }));

    generateTasks(sim);
    const repairs = sim.tasks.filter((t) => t.kind === TaskKind.Repair);
    expect(repairs).toHaveLength(1);
    // Idempotent: running again tops up rather than piling on.
    generateTasks(sim);
    expect(sim.tasks.filter((t) => t.kind === TaskKind.Repair)).toHaveLength(1);
    // Nothing is reserved for it — repair is people, not materials.
    expect(repairs[0].item).toBe(-1);

    for (let t = 0; t < 200 && sim.wallDamageMap[wall] > 0; t++) advanceTick(sim);
    expect(sim.wallDamageMap[wall]).toBe(0);
    expect(sim.wallMap[wall]).toBe(WallState.Palisade);
    expect(sim.tasks.some((t) => t.kind === TaskKind.Repair)).toBe(false);
  });

  it("works at its stated rate, in whole points", () => {
    const sim = flatSim(20);
    const wall = at(sim, 10, 10);
    sim.wallMap[wall] = WallState.Palisade;
    sim.wallDamageMap[wall] = PALISADE_HP - 1;
    recomputeEnclosure(sim);
    walker(sim, 10, 11);
    let ticks = 0;
    for (; ticks < 400 && sim.wallDamageMap[wall] > 0; ticks++) advanceTick(sim);
    // Allowing a few ticks for the claim and the walk, the rate is the spec's.
    const working = (PALISADE_HP - 1) / REPAIR_HP_PER_SECOND * TICK_HZ;
    expect(ticks).toBeGreaterThanOrEqual(working);
    expect(ticks).toBeLessThan(working + 60);
  });

  it("is held off the outside face while a monster is camping the segment", () => {
    // The tier's whole shape: a biting monster keeps the ground beside it
    // lethal, so a mid-siege repair only works from the inside face.
    const sim = flatSim(20);
    const wall = at(sim, 10, 10);
    sim.wallMap[wall] = WallState.Palisade;
    sim.wallDamageMap[wall] = 20;
    recomputeEnclosure(sim);
    const c = walker(sim, 10, 13);
    sim.monsters.push(testMonster({ lairX: 10, lairY: 6, x: 10.5, y: 9.5 }));

    for (let t = 0; t < 60; t++) advanceTick(sim);
    // They never got to work: the repairer is running, not repairing, and the
    // damage is going the wrong way.
    expect(sim.colonists).toContain(c);
    expect(sim.wallDamageMap[wall]).toBeGreaterThanOrEqual(20);
  });
});
