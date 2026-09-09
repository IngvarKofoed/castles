import { describe, expect, it } from "vitest";
import { applyCommands } from "../commands";
import { hashSim } from "../hash";
import { countItems, spawnItem } from "../items";
import { inspect } from "../know";
import {
  BuildingKind,
  BuildingState,
  ItemType,
  Loc,
  createSim,
  type Colonist,
  type Sim,
} from "../store";
import { flatSim, testBuilding, testColonist, testMonster } from "../test-sim";
import { advanceTick } from "../tick";
import {
  CHOP_TICKS,
  HUNGRY_FACTOR,
  HUNGRY_TICKS,
  MEAL_TICKS,
  PROVISION_BREAD,
  STARTING_COLONISTS,
  WALK_TILES_PER_TICK,
} from "../tuning";
import { recomputeEnclosure } from "../walls/enclosure";
import { tileIndex } from "../world/world";
import { hungry, mealDue, walkBudget, worksThisTick } from "./hunger";

/**
 * Meals, hunger, and the plateau (docs/specs/2026-09-08-bread-economy.md).
 *
 * The two rules everything here exists to hold down: a meal is **physical** —
 * a colonist walks to a loaf and takes it off the map, so bread is the one
 * good that never teleports — and hunger **plateaus**. A colony with no bread
 * is a slower colony and nothing worse, ever: nobody dies, nobody stops, and
 * nothing alerts.
 */

const at = (sim: Sim, x: number, y: number): number => tileIndex(x, y, sim.world.size);

function colonist(sim: Sim, patch: Partial<Colonist> = {}): Colonist {
  const c = testColonist({ id: sim.nextId++, x: 6.5, y: 6.5, ...patch });
  sim.colonists.push(c);
  return c;
}

/** A flat world with the enclosure settled, so nobody is fleeing anything. */
function world(size = 20): Sim {
  const sim = flatSim(size);
  recomputeEnclosure(sim);
  return sim;
}

/** Run until `done`, or `limit` ticks, and say how many it took. */
function until(sim: Sim, limit: number, done: () => boolean): number {
  for (let t = 0; t < limit; t++) {
    if (done()) return t;
    advanceTick(sim);
  }
  return -1;
}

describe("the opening provisions", () => {
  it("give a fresh colony three loaves a head, lying in its clearing", () => {
    const sim = createSim(20260901);
    expect(countItems(sim, ItemType.Bread)).toBe(PROVISION_BREAD * STARTING_COLONISTS);
    const loaves = sim.items.filter((it) => it.type === ItemType.Bread);
    for (const loaf of loaves) {
      expect(loaf.loc).toBe(Loc.Ground);
      expect(loaf.reservedBy).toBe(-1);
    }
    // One pile on one tile, and **not** the middle of the clearing: a ground
    // item refuses a footprint, and the centre is where the first building goes.
    expect(new Set(loaves.map((l) => `${l.x},${l.y}`)).size).toBe(1);
    expect(loaves[0].x === 128 && loaves[0].y === 128).toBe(false);
  });

  it("run out after about three days, and then the colony is only slower", () => {
    // The runway, measured: three meals a head at one a game-day. What happens
    // at the end of it is the whole promise — a slower colony, not a dying one.
    const sim = createSim(20260901);
    for (let t = 0; t < MEAL_TICKS * 5; t++) advanceTick(sim);
    expect(countItems(sim, ItemType.Bread)).toBe(0);
    expect(sim.colonists).toHaveLength(STARTING_COLONISTS);
    expect(sim.colonists.some((c) => hungry(c))).toBe(true);
    // Nobody died, nothing was left carrying a phantom errand, and the work
    // queue is still being worked.
    for (const c of sim.colonists) expect(c.eating).toBe(0);
  });
});

describe("a meal", () => {
  it("is a loaf walked to and taken off the map", () => {
    const sim = world();
    const c = colonist(sim, { hunger: MEAL_TICKS });
    spawnItem(sim, ItemType.Bread, 12, 6);
    expect(mealDue(c)).toBe(true);

    const took = until(sim, 200, () => countItems(sim, ItemType.Bread) === 0);
    expect(took).toBeGreaterThan(0);
    // They walked: the loaf was six tiles away and a colonist covers two tiles
    // a second.
    expect(took).toBeGreaterThan(20);
    expect(c.hunger).toBe(0);
    expect(c.eating).toBe(0);
  });

  it("never takes a loaf something else has reserved", () => {
    // The reservation rule, which is what quietly makes stockpiles the canteen:
    // `generateHaulToStore` claims every loose loaf for tidying before anybody
    // is hungry, and an eaten reserved loaf would strand its haul task and a
    // unit of the destination's incoming capacity forever.
    const sim = world();
    const c = colonist(sim, { hunger: MEAL_TICKS });
    const pile = testBuilding({ x: 14, y: 14 });
    sim.buildings.push(pile);
    const loaf = spawnItem(sim, ItemType.Bread, 12, 6)!;
    for (let t = 0; t < 40; t++) advanceTick(sim);
    // A tidy-up haul owns it, so the hungry colonist walks past it.
    expect(loaf.reservedBy).toBeGreaterThanOrEqual(0);
    expect(c.eating).toBe(0);
    expect(c.hunger).toBeGreaterThan(MEAL_TICKS);

    // Delivered into the pile it is free again, and then it is lunch.
    const ate = until(sim, 400, () => c.hunger === 0);
    expect(ate).toBeGreaterThan(0);
    expect(countItems(sim, ItemType.Bread)).toBe(0);
  });

  it("can be taken out of a stockpile the colonist is standing beside", () => {
    const sim = world();
    const pile = testBuilding({ x: 10, y: 10 });
    sim.buildings.push(pile);
    const loaf = spawnItem(sim, ItemType.Bread, 16, 16)!;
    loaf.loc = Loc.Stored;
    loaf.holder = pile.id;
    loaf.x = -1;
    loaf.y = -1;
    const c = colonist(sim, { hunger: MEAL_TICKS });

    const ate = until(sim, 300, () => c.hunger === 0);
    expect(ate).toBeGreaterThan(0);
    expect(countItems(sim, ItemType.Bread)).toBe(0);
  });

  it("waits for the stint in hand — a claimed task is never dropped for lunch", () => {
    const sim = world();
    const c = colonist(sim);
    // A tree to fell, and bread on the far side of the map so the errand is
    // visibly the longer of the two.
    sim.world.treeMap[at(sim, 8, 6)] = 1;
    sim.chopMap[at(sim, 8, 6)] = 1;
    spawnItem(sim, ItemType.Bread, 17, 17);

    // Claimed first, and the clock comes due **mid-swing**: the meal check runs
    // before the pool worker's, so a colonist who is idle when it comes due
    // goes to eat straight away — what is being asked here is what happens to
    // one who is already holding something.
    expect(until(sim, 20, () => c.task >= 0)).toBeGreaterThanOrEqual(0);
    c.hunger = MEAL_TICKS;
    const felled = until(sim, 300, () => sim.world.treeMap[at(sim, 8, 6)] === 0);
    expect(felled).toBeGreaterThan(0);
    expect(c.hunger).toBeGreaterThan(MEAL_TICKS);
    // The tree came down first, and *then* they went to eat.
    expect(until(sim, 400, () => c.hunger === 0)).toBeGreaterThan(0);
  });

  it("takes a slot worker out through the door and puts them back", () => {
    const sim = world();
    const c = colonist(sim, { x: 10.5, y: 14.5 });
    applyCommands(sim, [{ kind: "place", building: BuildingKind.Mill, x: 10, y: 10 }]);
    const mill = sim.buildings[0];
    mill.state = BuildingState.Active;
    applyCommands(sim, [{ kind: "staff", building: mill.id }]);
    expect(until(sim, 200, () => c.inside === 1)).toBeGreaterThanOrEqual(0);

    spawnItem(sim, ItemType.Bread, 4, 4);
    c.hunger = MEAL_TICKS;
    // Out of the building and on the road, with the panel saying so rather
    // than reporting a stall — "waiting for grain" while the miller is at
    // lunch would be the panel lying.
    expect(until(sim, 40, () => c.eating === 1)).toBeGreaterThanOrEqual(0);
    expect(c.inside).toBe(0);
    const view = inspect(sim, mill.id)!;
    expect(view.worker).toBe("eating");
    expect(view.stall).toBe("none");

    // Fed, and back at the bench by itself: `stepSlotWorker` walks them home
    // with nothing about the meal knowing that it does.
    expect(until(sim, 400, () => c.hunger === 0)).toBeGreaterThan(0);
    expect(until(sim, 400, () => c.inside === 1)).toBeGreaterThanOrEqual(0);
    expect(inspect(sim, mill.id)?.worker).toBe("inside");
  });

  it("survives a save taken mid-walk, and finishes on the other side", () => {
    const sim = world();
    const c = colonist(sim, { hunger: MEAL_TICKS });
    spawnItem(sim, ItemType.Bread, 15, 6);
    expect(until(sim, 40, () => c.eating === 1)).toBeGreaterThanOrEqual(0);
    expect(c.path.length).toBeGreaterThan(c.step);

    // Through `structuredClone` rather than the codec — `assertSim` refuses a
    // hand-built 20-tile world, and the format's own coverage of these two
    // fields is `v8.castles`. What is asked here is that the errand is *state*:
    // the copy walks the same route to the same loaf on the same tick.
    const copy = structuredClone(sim);
    expect(hashSim(copy)).toBe(hashSim(sim));
    for (let t = 0; t < 200; t++) {
      advanceTick(sim);
      advanceTick(copy);
    }
    expect(hashSim(copy)).toBe(hashSim(sim));
    expect(countItems(sim, ItemType.Bread)).toBe(0);
  });
});

describe("hunger with no bread anywhere", () => {
  it("slows work to the factor, on a cadence of whole ticks", () => {
    // Never a fractional work float: every accumulator in the game is an
    // integer count against an integer target, and paying 0.6 of a tick would
    // put fractions in the store and therefore in the golden hash.
    const sim = world();
    const c = colonist(sim, { hunger: HUNGRY_TICKS });
    let worked = 0;
    for (let t = 0; t < 1000; t++) {
      sim.tick = t;
      if (worksThisTick(sim, c)) worked++;
    }
    expect(worked).toBe(Math.round(1000 * HUNGRY_FACTOR));

    // And a colonist short of `HUNGRY_TICKS` is not slowed at all: being *due*
    // a meal costs nothing, which is why the ribbon counts the slowed set.
    const fed = colonist(sim, { hunger: MEAL_TICKS });
    for (let t = 0; t < 50; t++) {
      sim.tick = t;
      expect(worksThisTick(sim, fed)).toBe(true);
    }
  });

  it("makes a chop take proportionally longer, and finish", () => {
    // Measured against a fed control on the identical world, because what is
    // being claimed is a *ratio* — and the walk to the tree is in both numbers.
    const fell = (hunger: number): number => {
      const sim = world();
      const c = colonist(sim, { hunger });
      sim.world.treeMap[at(sim, 7, 6)] = 1;
      sim.chopMap[at(sim, 7, 6)] = 1;
      const took = until(sim, 400, () => sim.world.treeMap[at(sim, 7, 6)] === 0);
      expect(c.hunger).toBeGreaterThanOrEqual(hunger);
      return took;
    };
    const fed = fell(0);
    const starved = fell(HUNGRY_TICKS);
    expect(fed).toBeGreaterThan(0);
    // The work still lands — a hungry colony is slower, not stopped — and it
    // costs about a chop's worth of extra ticks, never more than double.
    expect(starved).toBeGreaterThan(fed);
    expect(starved).toBeGreaterThanOrEqual(Math.floor(CHOP_TICKS / HUNGRY_FACTOR));
    expect(starved).toBeLessThan(fed * 2);
  });

  it("slows the walk, but never the run", () => {
    const sim = world();
    const c = colonist(sim, { hunger: HUNGRY_TICKS });
    expect(walkBudget(c)).toBeCloseTo(WALK_TILES_PER_TICK * HUNGRY_FACTOR);

    // Fleeing is exempt, and that is the load-bearing half: threat speed
    // against a fleeing worker is the game's central difficulty dial, so an
    // empty larder may cost the colony its output and may never quietly raise
    // its death rate. Measured on the ground rather than off the helper.
    sim.monsters.push(testMonster({ lairX: 4, lairY: 6 }));
    const from = c.x;
    advanceTick(sim);
    advanceTick(sim);
    expect(Math.abs(c.x - from) + Math.abs(c.y - 6.5)).toBeCloseTo(2 * WALK_TILES_PER_TICK, 5);
    // And the errand went with everything else they were carrying.
    expect(c.eating).toBe(0);
  });

  it("never kills, and never stops the colony working", () => {
    const sim = world();
    for (let i = 0; i < 3; i++) colonist(sim, { x: 6.5 + i, hunger: HUNGRY_TICKS * 2 });
    sim.world.treeMap[at(sim, 9, 6)] = 1;
    sim.chopMap[at(sim, 9, 6)] = 1;
    for (let t = 0; t < 600; t++) advanceTick(sim);
    expect(sim.colonists).toHaveLength(3);
    expect(sim.world.treeMap[at(sim, 9, 6)]).toBe(0);
    // Hunger is unbounded and nothing about it ever escalates.
    for (const c of sim.colonists) expect(c.hunger).toBeGreaterThan(HUNGRY_TICKS);
  });
});

describe("a wanderer", () => {
  it("neither eats nor hungers until they settle", () => {
    // Their clock starts at settling: a figure walking in from the coast is not
    // a mouth the colony is feeding yet, and the arrival gate counts the same
    // heads (`settled`).
    const sim = world();
    const home = testBuilding({ kind: BuildingKind.House, x: 10, y: 10 });
    sim.buildings.push(home);
    const walker = colonist(sim, { dest: home.id, x: 2.5, y: 2.5 });
    spawnItem(sim, ItemType.Bread, 6, 6);
    for (let t = 0; t < 200 && walker.dest >= 0; t++) advanceTick(sim);
    expect(walker.hunger).toBe(0);
    expect(countItems(sim, ItemType.Bread)).toBe(1);

    // Settled, the clock runs like anybody's.
    expect(walker.dest).toBe(-1);
    for (let t = 0; t < 30; t++) advanceTick(sim);
    expect(walker.hunger).toBeGreaterThan(0);
  });
});
