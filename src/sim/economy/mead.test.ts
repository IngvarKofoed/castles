import { describe, expect, it } from "vitest";
import { BUILDING_DEFS, consumes, footprintGap, recipeOf } from "../buildings";
import { applyCommands } from "../commands";
import { GOODS, GOOD_LIST, isFood } from "../goods";
import { countItems, spawnItem } from "../items";
import { inspect } from "../know";
import { cellarSet, populationCap, settled } from "../settlers";
import {
  BuildingKind,
  BuildingState,
  ItemType,
  Loc,
  type Building,
  type BuildingKindValue,
  type Colonist,
  type Sim,
} from "../store";
import { flatSim, testBuilding, testColonist } from "../test-sim";
import { advanceTick } from "../tick";
import { HIVE_FIELDS_MAX, HIVE_REACH, HIVE_TICKS_BY_FIELDS, UNLIMITED } from "../tuning";
import { recomputeEnclosure } from "../walls/enclosure";
import { batchTicks, fieldsInReach } from "./workshop";

/**
 * Hives, flower fields and mead (docs/specs/2026-09-14-hives-and-mead.md).
 *
 * Three def rows and no engine, as the cloth chain was — so what is worth
 * pinning here is the three things that are genuinely new: a batch length that
 * is **a fact about where a building stands**, a reach measured footprint to
 * footprint so the predicate and its picture agree at every edge, and a drink
 * whose whole payout is that people arrive sooner.
 */

/** A flat world with the enclosure settled, so nobody is fleeing anything. */
function world(size = 40): Sim {
  const sim = flatSim(size);
  recomputeEnclosure(sim);
  return sim;
}

function colonist(sim: Sim, patch: Partial<Colonist> = {}): Colonist {
  const c = testColonist({ id: sim.nextId++, x: 6.5, y: 6.5, ...patch });
  sim.colonists.push(c);
  return c;
}

/** An active building of `kind` at (x, y), staffed by nobody yet. */
function put(sim: Sim, kind: BuildingKindValue, x: number, y: number): Building {
  applyCommands(sim, [{ kind: "place", building: kind, x, y }]);
  const b = sim.buildings[sim.buildings.length - 1];
  expect(b.kind).toBe(kind);
  b.state = BuildingState.Active;
  return b;
}

/** A hive with its keeper inside and working. */
function staffedHive(sim: Sim, x = 6, y = 6): Building {
  const hive = put(sim, BuildingKind.Hive, x, y);
  colonist(sim, { x: x + 0.5, y: y + 3.5 });
  applyCommands(sim, [{ kind: "staff", building: hive.id }]);
  for (let t = 0; t < 200 && !sim.colonists.some((c) => c.slot === hive.id && c.inside); t++) advanceTick(sim);
  expect(sim.colonists.some((c) => c.slot === hive.id && c.inside)).toBe(true);
  return hive;
}

describe("the two goods and the three buildings", () => {
  it("come with every ritual the append conventions ask for", () => {
    const sim = world();
    const pile = testBuilding();
    for (const type of [ItemType.Honey, ItemType.Mead]) {
      const def = GOODS[type];
      expect(def.type).toBe(type);
      // The accept field exists on a real building — the ritual that keeps a
      // new good from being refused by every stockpile forever.
      expect(pile[def.accept]).toBe(1);
      expect(GOOD_LIST).toContain(def);
      expect(sim.limits[type]).toBe(UNLIMITED);
      // **Neither is a food.** `FOODS` is unchanged, so the meal errand never
      // seeks one and the arrival gate never counts one.
      expect(isFood(type)).toBe(false);
    }
    // Sized off the enum rather than a literal, so a missed `limits` slot is a
    // load refusal rather than a silent unlimited.
    expect(sim.limits).toHaveLength(GOOD_LIST.length);
  });

  it("gives the Hive the Farm's no-input recipe and the Meadery an ordinary one", () => {
    const hive = BUILDING_DEFS[BuildingKind.Hive];
    expect(hive.hasSlot).toBe(true);
    expect(consumes(hive.recipe!)).toBe(false);
    expect(hive.recipe!.inputCap).toBe(0);
    expect(hive.recipe!.output).toBe(ItemType.Honey);

    const meadery = BUILDING_DEFS[BuildingKind.Meadery];
    expect(meadery.recipe).toMatchObject({ input: ItemType.Honey, per: 1, output: ItemType.Mead });

    // Flowers are the first building in the game with **no worker and no
    // recipe** — nothing to staff, nothing to stall, nothing to haul.
    const flowers = BUILDING_DEFS[BuildingKind.Flowers];
    expect(flowers.hasSlot).toBe(false);
    expect(flowers.recipe).toBeNull();
    expect(flowers.beds).toBe(0);
  });
});

describe("a hive's reach", () => {
  /**
   * The gap is measured **footprint to footprint**, and the rectangle it
   * describes is exactly the one the overlay draws: a field counts when any
   * tile of its plot lies inside the hive's plot grown by `HIVE_REACH`.
   */
  it("measures rectangle to rectangle, not origin to origin", () => {
    const hive = { x: 10, y: 10, w: 2, h: 2 };
    // Overlapping is zero, and adjacent is one — `besideFootprint`'s scale,
    // which this generalises from a point to a rectangle. Symmetric either way
    // round, so "which is the hive" never changes the answer.
    expect(footprintGap(hive, { x: 11, y: 11, w: 3, h: 3 })).toBe(0);
    expect(footprintGap(hive, { x: 12, y: 10, w: 3, h: 3 })).toBe(1);
    expect(footprintGap({ x: 12, y: 10, w: 3, h: 3 }, hive)).toBe(1);
    // Overlapping on one axis and apart on the other: the larger of the two.
    expect(footprintGap(hive, { x: 10, y: 15, w: 3, h: 3 })).toBe(4);
    // Diagonal: Chebyshev, so the diagonal neighbour is as near as the
    // orthogonal one.
    expect(footprintGap(hive, { x: 15, y: 15, w: 3, h: 3 })).toBe(4);
    // Origin to origin would have said 5 for both of those, which is the whole
    // reason this is not that.
  });

  it("counts a field whose nearest edge is exactly at the reach, and not one past it", () => {
    const sim = world();
    const hive = put(sim, BuildingKind.Hive, 10, 10);
    // The hive's plot is (10,10)-(11,11); grown by 6 that is (4,4)-(17,17). A
    // 3×3 field whose own nearest tile lands on 17 counts; one tile further out
    // does not. This is the edge the drawn rectangle promises.
    const inside = put(sim, BuildingKind.Flowers, 17, 10);
    expect(fieldsInReach(sim, hive)).toBe(1);
    inside.x = 18;
    expect(fieldsInReach(sim, hive)).toBe(0);
    // And the same on the near side, where a rectangle's far edge is what
    // matters: a field ending at 4 counts, one ending at 3 does not.
    inside.x = 2;
    expect(fieldsInReach(sim, hive)).toBe(1);
    inside.x = 1;
    expect(fieldsInReach(sim, hive)).toBe(0);
  });

  it("counts only finished fields, and never more than the cap", () => {
    const sim = world();
    const hive = put(sim, BuildingKind.Hive, 10, 10);
    const site = put(sim, BuildingKind.Flowers, 14, 10);
    site.state = BuildingState.Blueprint;
    expect(fieldsInReach(sim, hive)).toBe(0);
    site.state = BuildingState.Active;
    expect(fieldsInReach(sim, hive)).toBe(1);

    for (const [x, y] of [
      [14, 14],
      [6, 14],
      [6, 6],
    ] as const) {
      put(sim, BuildingKind.Flowers, x, y);
    }
    // Four fields stand in reach; the count and the table both stop at three.
    expect(fieldsInReach(sim, hive)).toBe(HIVE_FIELDS_MAX);
    expect(batchTicks(sim, hive, recipeOf(hive)!)).toBe(HIVE_TICKS_BY_FIELDS[HIVE_FIELDS_MAX]);
  });

  it("is a hive's business alone — every other workshop keeps its recipe's ticks", () => {
    const sim = world();
    put(sim, BuildingKind.Flowers, 14, 10);
    const mill = put(sim, BuildingKind.Mill, 10, 10);
    expect(mill.kind).toBe(BuildingKind.Mill);
    expect(batchTicks(sim, mill, recipeOf(mill)!)).toBe(recipeOf(mill)!.ticks);
    expect(inspect(sim, mill.id)?.fields).toBe(-1);
  });
});

describe("the boost", () => {
  it("makes honey slowly alone and about three times faster among fields", () => {
    // Measured as **time to one batch** rather than as a count over a window:
    // a hive with nowhere to send its honey fills its two-slot output buffer
    // and stops, so a count would be measuring `WORKSHOP_OUTPUT_CAP`.
    const sim = world();
    const hive = staffedHive(sim);
    expect(batchOf(sim, hive)).toBe(HIVE_TICKS_BY_FIELDS[0]);

    const fast = world();
    const boosted = staffedHive(fast);
    for (const [x, y] of [
      [12, 6],
      [12, 12],
      [6, 12],
    ] as const) {
      put(fast, BuildingKind.Flowers, x, y);
    }
    expect(fieldsInReach(fast, boosted)).toBe(3);
    expect(batchOf(fast, boosted)).toBe(HIVE_TICKS_BY_FIELDS[HIVE_FIELDS_MAX]);
  });

  it("speeds the batch already under way when a field finishes mid-batch", () => {
    const sim = world();
    const hive = staffedHive(sim);
    hive.millProgress = 0;
    // Let the batch run most of the way at the lone-hive rate, then plant.
    for (let t = 0; t < HIVE_TICKS_BY_FIELDS[3] + 5; t++) advanceTick(sim);
    expect(countItems(sim, ItemType.Honey)).toBe(0);
    expect(hive.millProgress).toBeGreaterThanOrEqual(HIVE_TICKS_BY_FIELDS[3]);

    for (const [x, y] of [
      [12, 6],
      [12, 12],
      [6, 12],
    ] as const) {
      put(sim, BuildingKind.Flowers, x, y);
    }
    // The completion compare is read every tick, so the batch already past the
    // three-field length finishes on the very next one. Lengthening a batch is
    // the direction that cannot happen: buildings are never razed.
    advanceTick(sim);
    expect(countItems(sim, ItemType.Honey)).toBe(1);
  });

  it("says how many fields it has, and says so when it has none", () => {
    const sim = world();
    const hive = put(sim, BuildingKind.Hive, 10, 10);
    expect(inspect(sim, hive.id)?.fields).toBe(0);
    put(sim, BuildingKind.Flowers, 14, 10);
    expect(inspect(sim, hive.id)?.fields).toBe(1);
  });
});

/** Ticks one batch takes, from a batch restarted at zero with the buffer clear. */
function batchOf(sim: Sim, hive: Building): number {
  for (const it of [...sim.items]) {
    if (it.type === ItemType.Honey) sim.items.splice(sim.items.indexOf(it), 1);
  }
  hive.millProgress = 0;
  for (let t = 1; t <= 2000; t++) {
    advanceTick(sim);
    if (countItems(sim, ItemType.Honey) > 0) return t;
  }
  return -1;
}

describe("the cellar", () => {
  /** A colony of `n` settled folk with `mead` cups in it. */
  function cellar(n: number, mead: number): Sim {
    const sim = world();
    for (let i = 0; i < n; i++) colonist(sim, { x: 6.5 + i, y: 6.5 });
    for (let i = 0; i < mead; i++) spawnItem(sim, ItemType.Mead, 3 + i, 3);
    return sim;
  }

  it("wants a cup a head and one for the newcomer", () => {
    expect(cellarSet(cellar(3, 3))).toBe(false);
    expect(cellarSet(cellar(3, 4))).toBe(true);
  });

  it("has no empty-colony exemption, unlike the table", () => {
    // `tableSet` exempts a wiped colony so recovery stays possible; there is
    // nothing to recover here, and with nobody home there is nobody to hurry.
    const sim = cellar(0, 0);
    expect(settled(sim)).toBe(0);
    expect(cellarSet(sim)).toBe(false);
  });

  it("counts a cup wherever it is, so the bar cannot flicker as haulers walk", () => {
    const sim = cellar(1, 0);
    const pile = put(sim, BuildingKind.Stockpile, 12, 12);
    const stored = spawnItem(sim, ItemType.Mead, 3, 3)!;
    stored.loc = Loc.Stored;
    stored.holder = pile.id;
    stored.x = -1;
    stored.y = -1;
    const carried = spawnItem(sim, ItemType.Mead, 4, 3)!;
    carried.loc = Loc.Carried;
    carried.holder = sim.colonists[0].id;
    expect(cellarSet(sim)).toBe(true);
  });
});

describe("what mead buys", () => {
  /** A colony with a House standing, beds free, and bread on the table. */
  function growing(mead: number): Sim {
    const sim = world();
    for (let i = 0; i < 2; i++) colonist(sim, { x: 6.5 + i, y: 6.5 });
    put(sim, BuildingKind.House, 20, 20);
    for (let i = 0; i < 6; i++) spawnItem(sim, ItemType.Bread, 3 + i, 3);
    for (let i = 0; i < mead; i++) spawnItem(sim, ItemType.Mead, 3 + i, 5);
    expect(settled(sim)).toBeLessThan(populationCap(sim));
    return sim;
  }

  it("runs the wanderer countdown at double speed while the cellar is stocked", () => {
    const dry = growing(0);
    const wet = growing(3);
    expect(cellarSet(wet)).toBe(true);
    const before = wet.wandererTimer;
    expect(dry.wandererTimer).toBe(before);
    for (let t = 0; t < 10; t++) {
      advanceTick(dry);
      advanceTick(wet);
    }
    expect(before - dry.wandererTimer).toBe(10);
    expect(before - wet.wandererTimer).toBe(20);
  });

  it("goes back to one a tick the moment the cellar falls short", () => {
    // Mid-countdown, and reversible: the decrement reads the stock every tick
    // rather than being folded into the interval drawn at restart.
    const sim = growing(3);
    for (let t = 0; t < 5; t++) advanceTick(sim);
    const mid = sim.wandererTimer;
    for (const it of [...sim.items]) {
      if (it.type === ItemType.Mead) {
        sim.items.splice(sim.items.indexOf(it), 1);
        break;
      }
    }
    expect(cellarSet(sim)).toBe(false);
    for (let t = 0; t < 5; t++) advanceTick(sim);
    expect(mid - sim.wandererTimer).toBe(5);
  });

  it("never gates: an empty cellar grows at exactly the old rate", () => {
    const sim = growing(0);
    const before = sim.wandererTimer;
    for (let t = 0; t < 12; t++) advanceTick(sim);
    expect(before - sim.wandererTimer).toBe(12);
  });

  it("tells the House panel when the cellar is what is helping", () => {
    const stocked = growing(3);
    const house = stocked.buildings.find((b) => b.kind === BuildingKind.House)!;
    expect(inspect(stocked, house.id)?.cellarStocked).toBe(true);
    expect(inspect(stocked, house.id)?.tableShort).toBe(false);

    // A short table wins: nobody is coming either way, so "folk come sooner"
    // would be the panel contradicting the line above it.
    const hungry = growing(3);
    for (const it of [...hungry.items]) {
      if (it.type === ItemType.Bread) hungry.items.splice(hungry.items.indexOf(it), 1);
    }
    const h2 = hungry.buildings.find((b) => b.kind === BuildingKind.House)!;
    expect(inspect(hungry, h2.id)?.tableShort).toBe(true);
    expect(inspect(hungry, h2.id)?.cellarStocked).toBe(false);
  });
});

describe("the cup a wanderer drinks", () => {
  /** A colony whose wanderer is one tick from settling. */
  function arriving(): { sim: Sim; walker: Colonist } {
    const sim = world();
    const house = put(sim, BuildingKind.House, 20, 20);
    colonist(sim, { x: 6.5, y: 6.5 });
    // Standing beside the House's footprint with its id as a destination: the
    // arrival rule, set up by hand rather than walked.
    const walker = colonist(sim, { x: 19.5, y: 21.5, dest: house.id });
    return { sim, walker };
  }

  it("takes the lowest-id free cup, stored or on the ground", () => {
    const { sim, walker } = arriving();
    const first = spawnItem(sim, ItemType.Mead, 3, 3)!;
    const second = spawnItem(sim, ItemType.Mead, 4, 3)!;
    advanceTick(sim);
    expect(walker.dest).toBe(-1);
    expect(sim.items.some((it) => it.id === first.id)).toBe(false);
    expect(sim.items.some((it) => it.id === second.id)).toBe(true);
  });

  it("never takes a carried or a reserved cup", () => {
    const { sim, walker } = arriving();
    const carried = spawnItem(sim, ItemType.Mead, 3, 3)!;
    carried.loc = Loc.Carried;
    carried.holder = sim.colonists[0].id;
    const reserved = spawnItem(sim, ItemType.Mead, 4, 3)!;
    reserved.reservedBy = 4242;
    const free = spawnItem(sim, ItemType.Mead, 5, 3)!;
    advanceTick(sim);
    expect(walker.dest).toBe(-1);
    // Removing either of the first two would orphan a haul mid-flight.
    expect(sim.items.some((it) => it.id === carried.id)).toBe(true);
    expect(sim.items.some((it) => it.id === reserved.id)).toBe(true);
    expect(sim.items.some((it) => it.id === free.id)).toBe(false);
  });

  it("settles anyway into an empty cellar", () => {
    const { sim, walker } = arriving();
    const before = sim.colonists.length;
    advanceTick(sim);
    expect(walker.dest).toBe(-1);
    expect(sim.colonists).toHaveLength(before);
    expect(countItems(sim, ItemType.Mead)).toBe(0);
  });
});

describe("a hive's reach in the panel", () => {
  it("names the cap the batch table is indexed by", () => {
    expect(HIVE_TICKS_BY_FIELDS).toHaveLength(HIVE_FIELDS_MAX + 1);
    // Strictly faster with every field, which is the promise the panel's row
    // and the overlay's rectangle are both making.
    for (let i = 1; i < HIVE_TICKS_BY_FIELDS.length; i++) {
      expect(HIVE_TICKS_BY_FIELDS[i]).toBeLessThan(HIVE_TICKS_BY_FIELDS[i - 1]);
    }
    expect(HIVE_REACH).toBeGreaterThan(0);
  });
});
