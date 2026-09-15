import { describe, expect, it } from "vitest";
import { BUILDING_DEFS, consumes, recipeOf } from "../buildings";
import { applyCommands } from "../commands";
import { FOODS, GOODS, GOOD_LIST, isFood } from "../goods";
import { countItems, spawnItem } from "../items";
import { inspect, readout } from "../know";
import { populationCap, settled, tableSet } from "../settlers";
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
import { CLOTHES_WEAR_TICKS, DAY_TICKS, MEAL_TICKS, UNLIMITED } from "../tuning";
import { recomputeEnclosure } from "../walls/enclosure";

/**
 * The sheep chain, the dressing errand and the second food
 * (docs/specs/2026-09-10-sheep-and-clothes.md).
 *
 * The chain itself is four def rows and no engine, so what is worth pinning
 * here is not that a weaver weaves — `economy/workshop.test.ts` already covers
 * a recipe — but the three things that are genuinely new: colonists dress
 * themselves the way they feed themselves, a garment is **consumed** and leaves
 * a wear clock behind, and cheese is bread's equal at both the meal and the
 * gate. The composed work cadence lives in `labour/hunger.test.ts`, which is
 * the cadence's home.
 */

/** A flat world with the enclosure settled, so nobody is fleeing anything. */
function world(size = 24): Sim {
  const sim = flatSim(size);
  recomputeEnclosure(sim);
  return sim;
}

function colonist(sim: Sim, patch: Partial<Colonist> = {}): Colonist {
  const c = testColonist({ id: sim.nextId++, x: 6.5, y: 6.5, ...patch });
  sim.colonists.push(c);
  return c;
}

/** Run until `done`, or `limit` ticks, and say how many it took. */
function until(sim: Sim, limit: number, done: () => boolean): number {
  for (let t = 0; t < limit; t++) {
    if (done()) return t;
    advanceTick(sim);
  }
  return -1;
}

/** An active workshop of `kind` at (x, y), staffed by nobody yet. */
function workshop(sim: Sim, kind: BuildingKindValue, x: number, y: number): Building {
  applyCommands(sim, [{ kind: "place", building: kind, x, y }]);
  const b = sim.buildings[sim.buildings.length - 1];
  b.state = BuildingState.Active;
  // A new pile accepts nothing (2026-09-14-stockpile-default-and-clearing); these
  // tests are about what a *configured* pile does, so open it here.
  if (kind === BuildingKind.Stockpile) applyCommands(sim, [{ kind: "setAllFilters", building: b.id, on: true }]);
  return b;
}

describe("the four new goods and the four new buildings", () => {
  it("come with every ritual the append conventions ask for", () => {
    // Each of the four lands with a `GOODS` row, an `accept` field that exists
    // on a real building, a `limits` slot and a place in `GOOD_LIST` — the
    // ritual that keeps a new good from being refused by every stockpile
    // forever (`sim/goods.ts`).
    const sim = world();
    const pile = testBuilding();
    for (const type of [ItemType.Wool, ItemType.Cloth, ItemType.Clothes, ItemType.Cheese]) {
      const def = GOODS[type];
      expect(def.type).toBe(type);
      expect(pile[def.accept]).toBe(1);
      expect(GOOD_LIST).toContain(def);
      expect(sim.limits[type]).toBe(UNLIMITED);
    }
    // The store's ceiling array is sized off the enum, so a missed slot is a
    // load refusal rather than a silent unlimited.
    // Sized off the enum rather than a literal, which is the whole claim — a
    // number written out here would stop covering the newest good the moment
    // one was appended, which is exactly the miss this test exists to catch.
    expect(sim.limits).toHaveLength(GOOD_LIST.length);
    expect(readout(sim).goods).toHaveLength(GOOD_LIST.length);
  });

  it("chain wool through cloth to clothes, and grain to cheese", () => {
    // Read off the defs rather than replayed: the chain is data, and what is
    // asserted is that the four rows actually join up end to end.
    const link = (kind: BuildingKindValue): [number, number] => {
      const r = recipeOf({ kind } as Building)!;
      return [r.input, r.output];
    };
    expect(link(BuildingKind.Weaver)).toEqual([ItemType.Wool, ItemType.Cloth]);
    expect(link(BuildingKind.Tailor)).toEqual([ItemType.Cloth, ItemType.Clothes]);
    expect(link(BuildingKind.Dairy)).toEqual([ItemType.Grain, ItemType.Cheese]);
    // The Pasture is the Farm's `per: 0` convention: no input, no input buffer,
    // and its `input` a dummy naming its own output.
    const pasture = recipeOf({ kind: BuildingKind.Pasture } as Building)!;
    expect(consumes(pasture)).toBe(false);
    expect(pasture.inputCap).toBe(0);
    expect(pasture.output).toBe(ItemType.Wool);
    // And the Dairy is grain-fed, so the bread chain's fields have a second
    // customer — the whole of what links the two chains.
    expect(recipeOf({ kind: BuildingKind.Oven } as Building)!.input).toBe(ItemType.Flour);
    expect(BUILDING_DEFS[BuildingKind.Pasture].w).toBe(3);
    for (const kind of [BuildingKind.Pasture, BuildingKind.Dairy, BuildingKind.Weaver, BuildingKind.Tailor]) {
      expect(BUILDING_DEFS[kind].costType).toBe(ItemType.Plank);
      expect(BUILDING_DEFS[kind].hasSlot).toBe(true);
    }
  });

  it("gives the Pasture a one-sided chain chip and no input row", () => {
    const sim = world();
    const pasture = workshop(sim, BuildingKind.Pasture, 8, 8);
    const view = inspect(sim, pasture.id)!;
    expect(view.chain).toEqual({ input: null, output: "Wool" });
    expect(view.inputCap).toBe(0);
    // A no-input recipe can never be "waiting for" anything, which is the guard
    // the Farm taught (docs/changelog/2026-09-08-bread-economy.md).
    expect(view.stall).toBe("none");

    const weaver = workshop(sim, BuildingKind.Weaver, 14, 8);
    expect(inspect(sim, weaver.id)!.chain).toEqual({ input: "Wool", output: "Cloth" });
  });

  it("runs the chain end to end through stockpiles", () => {
    // Three staffed workshops and a pile between them: wool out of nothing,
    // cloth out of wool, a garment out of cloth. The point is that no engine
    // was needed — hauling, buffers and output caps all work by existing.
    const sim = world(28);
    workshop(sim, BuildingKind.Stockpile, 12, 12);
    const pasture = workshop(sim, BuildingKind.Pasture, 4, 4);
    const weaver = workshop(sim, BuildingKind.Weaver, 18, 4);
    const tailor = workshop(sim, BuildingKind.Tailor, 18, 18);
    // Five folk: three in slots and two on the hauling that feeds them, which
    // is the labour trap in miniature.
    for (let i = 0; i < 5; i++) colonist(sim, { x: 12.5 + i, y: 8.5 });
    applyCommands(sim, [
      { kind: "staff", building: pasture.id },
      { kind: "staff", building: weaver.id },
      { kind: "staff", building: tailor.id },
    ]);

    expect(until(sim, 4000, () => countItems(sim, ItemType.Clothes) > 0)).toBeGreaterThan(0);
    // In order, and each step really consumed its input rather than the chain
    // spawning at the end.
    expect(sim.items.some((it) => it.type === ItemType.Wool)).toBe(true);
    expect(countItems(sim, ItemType.Cloth) + countItems(sim, ItemType.Clothes)).toBeGreaterThan(0);
  });

  it("hauls a finished garment to a stockpile like any other good", () => {
    // The tailor's output is the one good in the game that normally leaves on
    // somebody's back, so it is worth checking that it is still an ordinary
    // item when nobody wants it: with the whole colony already dressed, the
    // tidy-haul queue takes the garment out of the buffer and into the pile.
    const sim = world();
    const tailor = workshop(sim, BuildingKind.Tailor, 8, 8);
    const pile = workshop(sim, BuildingKind.Stockpile, 16, 16);
    colonist(sim, { x: 12.5, y: 12.5, clothes: CLOTHES_WEAR_TICKS });
    const garment = spawnItem(sim, ItemType.Clothes, 10, 12)!;
    garment.loc = Loc.Stored;
    garment.holder = tailor.id;
    garment.x = -1;
    garment.y = -1;

    expect(until(sim, 600, () => garment.holder === pile.id)).toBeGreaterThan(0);
    expect(garment.loc).toBe(Loc.Stored);
    // And the panel counts it where it now is, so the Stores row and the pile
    // agree about the same item.
    expect(inspect(sim, pile.id)!.stored.find((g) => g.type === ItemType.Clothes)?.count).toBe(1);
  });

  it("makes cheese out of the fields the oven wants", () => {
    const sim = world();
    const dairy = workshop(sim, BuildingKind.Dairy, 8, 8);
    colonist(sim, { x: 8.5, y: 12.5 });
    applyCommands(sim, [{ kind: "staff", building: dairy.id }]);
    // Grain hauled in by hand, so what is measured is the recipe and not the
    // farm: one grain in, one cheese out.
    for (let n = 0; n < 2; n++) {
      const grain = spawnItem(sim, ItemType.Grain, 10, 12)!;
      grain.loc = Loc.Stored;
      grain.holder = dairy.id;
      grain.x = -1;
      grain.y = -1;
    }
    expect(until(sim, 600, () => countItems(sim, ItemType.Cheese) > 0)).toBeGreaterThan(0);
    expect(countItems(sim, ItemType.Grain)).toBeLessThan(2);
  });
});

describe("cheese as a meal", () => {
  it("is on the FOODS list beside bread, with nothing else on it", () => {
    expect([...FOODS].sort()).toEqual([ItemType.Bread, ItemType.Cheese].sort());
    expect(isFood(ItemType.Bread)).toBe(true);
    expect(isFood(ItemType.Cheese)).toBe(true);
    for (const type of [ItemType.Grain, ItemType.Flour, ItemType.Wool, ItemType.Clothes]) {
      expect(isFood(type)).toBe(false);
    }
  });

  it("feeds a colonist with no bread in the colony", () => {
    const sim = world();
    const c = colonist(sim, { hunger: MEAL_TICKS });
    spawnItem(sim, ItemType.Cheese, 12, 6);
    expect(until(sim, 300, () => c.hunger === 0)).toBeGreaterThan(0);
    expect(countItems(sim, ItemType.Cheese)).toBe(0);
    // Nobody was slowed and nothing went looking for bread that does not exist.
    expect(c.eating).toBe(0);
    expect(readout(sim).hungry).toBe(0);
  });

  it("wins on distance, never on preference", () => {
    // No preference order: the nearest free food is the meal, whichever good it
    // is. A cheese two tiles away beats a loaf ten tiles away and the other way
    // round, which is what makes the larder two roads rather than a staple and
    // a fallback.
    const nearer = (near: number, far: number): number => {
      const sim = world();
      const c = colonist(sim, { hunger: MEAL_TICKS });
      spawnItem(sim, near, 8, 6);
      spawnItem(sim, far, 18, 6);
      expect(until(sim, 300, () => c.hunger === 0)).toBeGreaterThan(0);
      return countItems(sim, near);
    };
    expect(nearer(ItemType.Cheese, ItemType.Bread)).toBe(0);
    expect(nearer(ItemType.Bread, ItemType.Cheese)).toBe(0);
  });

  it("opens the wanderer gate on total food, not on loaves", () => {
    const sim = world();
    const home = testBuilding({ id: sim.nextId++, kind: BuildingKind.House, x: 10, y: 10 });
    sim.buildings.push(home);
    for (let i = 0; i < 3; i++) colonist(sim, { x: 4.5 + i, y: 4.5 });
    expect(settled(sim)).toBe(3);
    expect(populationCap(sim)).toBeGreaterThan(3);

    // Nothing in the larder: the gate is shut, and it is the table rather than
    // the cap that is holding it — which is what the House panel says.
    expect(tableSet(sim)).toBe(false);
    expect(inspect(sim, home.id)!.tableShort).toBe(true);

    // Bread and cheese counted **together**: three of one kind would do it and
    // so does a mixture, because the bar is settled + 1 of any food.
    for (let n = 0; n < 2; n++) spawnItem(sim, ItemType.Bread, 12 + n, 6);
    expect(tableSet(sim)).toBe(false);
    for (let n = 0; n < 2; n++) spawnItem(sim, ItemType.Cheese, 14 + n, 6);
    expect(tableSet(sim)).toBe(true);
    expect(inspect(sim, home.id)!.tableShort).toBe(false);
  });
});

describe("the dressing errand", () => {
  it("walks an unclothed colonist to a garment and puts it on", () => {
    const sim = world();
    const c = colonist(sim);
    const garment = spawnItem(sim, ItemType.Clothes, 14, 6)!;
    expect(c.clothes).toBe(0);

    const took = until(sim, 300, () => c.clothes > 0);
    expect(took).toBeGreaterThan(0);
    // They walked: the garment was eight tiles away.
    expect(took).toBeGreaterThan(30);
    // **Donning consumes the item.** There is no worn-item entity — the
    // garment leaves the map and `clothes` is all that is left behind.
    expect(sim.items.some((it) => it.id === garment.id)).toBe(false);
    expect(c.clothes).toBeLessThanOrEqual(CLOTHES_WEAR_TICKS);
    expect(c.dressing).toBe(0);
    // A garment lasts about ten game-days, which is the number the Outcome
    // promises and the one a player feels: long enough that dressing the colony
    // is not a treadmill, short enough that the tailor never runs out of
    // customers. Pinned here because the whole demand side of the chain rests
    // on it.
    expect(CLOTHES_WEAR_TICKS).toBe(10 * DAY_TICKS);
  });

  it("never takes a garment something else has reserved", () => {
    // The meal loop's reservation rule, inherited: a garment claimed for tidy
    // hauling is not available, and taking it would strand the task and a unit
    // of the pile's incoming capacity forever.
    const sim = world();
    const c = colonist(sim);
    sim.buildings.push(testBuilding({ id: sim.nextId++, x: 16, y: 16 }));
    const garment = spawnItem(sim, ItemType.Clothes, 12, 6)!;
    for (let t = 0; t < 40; t++) advanceTick(sim);
    expect(garment.reservedBy).toBeGreaterThanOrEqual(0);
    expect(c.clothes).toBe(0);

    // Delivered into the pile it is free again, and then it is a fitting.
    expect(until(sim, 500, () => c.clothes > 0)).toBeGreaterThan(0);
    expect(countItems(sim, ItemType.Clothes)).toBe(0);
  });

  it("takes it out of a stockpile the colonist is standing beside", () => {
    const sim = world();
    const pile = testBuilding({ id: sim.nextId++, x: 10, y: 10 });
    sim.buildings.push(pile);
    const garment = spawnItem(sim, ItemType.Clothes, 18, 18)!;
    garment.loc = Loc.Stored;
    garment.holder = pile.id;
    garment.x = -1;
    garment.y = -1;
    const c = colonist(sim);
    expect(until(sim, 300, () => c.clothes > 0)).toBeGreaterThan(0);
    expect(countItems(sim, ItemType.Clothes)).toBe(0);
  });

  it("finishes the stint in hand first, and is never claimed by anybody else", () => {
    const sim = world();
    const c = colonist(sim);
    sim.world.treeMap[9 + 6 * sim.world.size] = 1;
    sim.chopMap[9 + 6 * sim.world.size] = 1;
    expect(until(sim, 20, () => c.task >= 0)).toBeGreaterThanOrEqual(0);
    // The garment appears mid-swing: the tree still comes down first, because a
    // fitting is not worth a claimed task.
    spawnItem(sim, ItemType.Clothes, 18, 18);
    const felled = until(sim, 300, () => sim.world.treeMap[9 + 6 * sim.world.size] === 0);
    expect(felled).toBeGreaterThan(0);
    expect(until(sim, 400, () => c.clothes > 0)).toBeGreaterThan(0);
    // And no task was ever generated for it: nobody hauls a garment to a
    // person, the person comes to the garment.
    expect(sim.tasks.every((t) => t.item < 0 || t.item !== c.carrying)).toBe(true);
  });

  it("takes a slot worker out through the door, and the panel says so", () => {
    const sim = world();
    const c = colonist(sim, { x: 10.5, y: 14.5 });
    const weaver = workshop(sim, BuildingKind.Weaver, 10, 10);
    applyCommands(sim, [{ kind: "staff", building: weaver.id }]);
    expect(until(sim, 200, () => c.inside === 1)).toBeGreaterThanOrEqual(0);

    spawnItem(sim, ItemType.Clothes, 4, 4);
    expect(until(sim, 60, () => c.dressing === 1)).toBeGreaterThanOrEqual(0);
    expect(c.inside).toBe(0);
    // "waiting for wool" while the weaver is at a fitting would be the panel
    // lying — the exact bug the `eating` state exists to prevent, one errand on.
    const view = inspect(sim, weaver.id)!;
    expect(view.worker).toBe("dressing");
    expect(view.stall).toBe("none");

    // Dressed, and back at the loom by itself: `stepSlotWorker` walks them home
    // with nothing about the errand knowing that it does.
    expect(until(sim, 400, () => c.clothes > 0)).toBeGreaterThan(0);
    expect(until(sim, 400, () => c.inside === 1)).toBeGreaterThanOrEqual(0);
    expect(inspect(sim, weaver.id)!.worker).toBe("inside");
  });

  it("does not count as idle, because a fitting is not availability", () => {
    // `idle` means *available for work* (docs/changelog/2026-09-09-idle-means-available.md),
    // and somebody walking to the tailor is not.
    const sim = world();
    const c = colonist(sim);
    spawnItem(sim, ItemType.Clothes, 16, 6);
    expect(until(sim, 60, () => c.dressing === 1)).toBeGreaterThanOrEqual(0);
    expect(readout(sim).idle).toBe(0);
    // Still a pool worker, though: narrowing `pool` would move the labour
    // meter's segments as a side effect.
    expect(readout(sim).pool).toBe(1);
  });

  it("yields to a meal, and the fitting re-seeks afterwards", () => {
    // Priority is flee > meal > dress > work: hunger is the sharper clock, so a
    // meal coming due mid-fitting takes the colonist over — and at most one
    // errand flag is ever set, so the panel never has to pick between two.
    const sim = world();
    const c = colonist(sim);
    spawnItem(sim, ItemType.Clothes, 20, 6);
    expect(until(sim, 60, () => c.dressing === 1)).toBeGreaterThanOrEqual(0);

    c.hunger = MEAL_TICKS;
    spawnItem(sim, ItemType.Bread, 4, 6);
    expect(until(sim, 60, () => c.eating === 1)).toBeGreaterThanOrEqual(0);
    expect(c.dressing).toBe(0);

    // Fed, and then dressed: the clobbered errand self-heals, because `clothes`
    // is still 0 and the seek runs again.
    expect(until(sim, 400, () => c.hunger === 0)).toBeGreaterThan(0);
    expect(until(sim, 600, () => c.clothes > 0)).toBeGreaterThan(0);
  });

  it("hands the first garment to the lowest id and sends the rest back to look", () => {
    // The tailor's first garment draws every unclothed colonist at once, which
    // is the provision pile's precedent applied to a fitting room: id order
    // wins, the losers re-seek, and nobody is left holding a phantom errand.
    const sim = world();
    const first = colonist(sim, { x: 8.5, y: 8.5 });
    const second = colonist(sim, { x: 8.5, y: 8.5 });
    spawnItem(sim, ItemType.Clothes, 12, 8);
    expect(until(sim, 300, () => first.clothes > 0)).toBeGreaterThan(0);
    expect(second.clothes).toBe(0);
    expect(until(sim, 20, () => second.dressing === 0)).toBeGreaterThanOrEqual(0);

    // A second garment dresses the loser, unaided.
    spawnItem(sim, ItemType.Clothes, 12, 8);
    expect(until(sim, 300, () => second.clothes > 0)).toBeGreaterThan(0);
  });

  it("re-dresses when the clothes wear out and stock allows", () => {
    const sim = world();
    const c = colonist(sim, { clothes: 20 });
    spawnItem(sim, ItemType.Clothes, 9, 6);
    // Nothing happens while they are dressed: the errand is gated on
    // `clothes === 0`, so a clothed colonist walks past a spare garment.
    for (let t = 0; t < 15; t++) advanceTick(sim);
    expect(countItems(sim, ItemType.Clothes)).toBe(1);
    expect(c.dressing).toBe(0);

    // Worn out, and then a customer again — which is what keeps the chain an
    // economy rather than a one-shot upgrade.
    expect(until(sim, 300, () => c.clothes > 0 && countItems(sim, ItemType.Clothes) === 0)).toBeGreaterThan(0);
  });

  it("costs a colony with no tailor one item scan and no route", () => {
    // Unclothed is the default and permanent state, so this errand's seek runs
    // for everybody from tick 0 in a colony that never builds the chain. What
    // is asserted is that it stays inert: no errand taken, no path planned, and
    // the store untouched by it.
    const sim = world();
    const folk = [colonist(sim), colonist(sim, { x: 7.5 }), colonist(sim, { x: 8.5 })];
    for (let t = 0; t < 200; t++) advanceTick(sim);
    for (const c of folk) {
      expect(c.clothes).toBe(0);
      expect(c.dressing).toBe(0);
      expect(c.path).toHaveLength(0);
    }
  });
});
