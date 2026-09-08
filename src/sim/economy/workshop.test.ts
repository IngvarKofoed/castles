import { describe, expect, it } from "vitest";
import { BUILDING_DEFS, freeCapacity, outputFull, recipeOf } from "../buildings";
import { applyCommands } from "../commands";
import { GOOD_LIST } from "../goods";
import { spawnItem } from "../items";
import { generateTasks } from "../labour/tasks";
import { inspect } from "../know";
import { BuildingKind, BuildingState, ItemType, Loc, TaskKind, type Building, type Sim } from "../store";
import { flatSim } from "../test-sim";
import { advanceTick } from "../tick";
import { ROCK_PER_BLOCK, WORKSHOP_OUTPUT_CAP } from "../tuning";

/**
 * The mason, and with it the shape *both* workshops now share: a recipe, an
 * input buffer, an output buffer, and a slot worker who has to be inside.
 *
 * The point of these tests is that nothing about milling is sawmill-shaped any
 * more — the ratio, the goods and the timing all come off the recipe table, so
 * the mason needed no second copy of the machinery and a third workshop will
 * not either.
 */

function peopledSim(size = 20): Sim {
  const sim = flatSim(size);
  for (let i = 0; i < 3; i++) {
    sim.colonists.push({
      id: sim.nextId++,
      x: 2 + i + 0.5,
      y: 2.5,
      px: 2 + i + 0.5,
      py: 2.5,
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
    });
  }
  return sim;
}

/** A finished, staffed workshop with its worker already inside. */
function workshop(sim: Sim, kind: 1 | 2, x = 8, y = 8): Building {
  applyCommands(sim, [{ kind: "place", building: kind, x, y }]);
  const b = sim.buildings[sim.buildings.length - 1];
  b.state = BuildingState.Active;
  applyCommands(sim, [{ kind: "staff", building: b.id }]);
  for (let t = 0; t < 200 && !sim.colonists.some((c) => c.slot === b.id && c.inside); t++) advanceTick(sim);
  return b;
}

function stock(sim: Sim, b: Building, type: number, n: number): void {
  for (let i = 0; i < n; i++) {
    const item = spawnItem(sim, type, b.x + 5, b.y)!;
    item.loc = Loc.Stored;
    item.holder = b.id;
    item.x = -1;
    item.y = -1;
  }
}

describe("the mason", () => {
  it("is the sawmill's shape with a different recipe", () => {
    const mason = BUILDING_DEFS[BuildingKind.Mason];
    const mill = BUILDING_DEFS[BuildingKind.Sawmill];
    expect([mason.w, mason.h, mason.cost, mason.hasSlot]).toEqual([mill.w, mill.h, mill.cost, mill.hasSlot]);
    expect(mason.recipe).toMatchObject({ input: ItemType.Rock, output: ItemType.Block, per: ROCK_PER_BLOCK });
    expect(mill.recipe).toMatchObject({ input: ItemType.Log, output: ItemType.Plank, per: 1 });
    // A stockpile is not a workshop, and asking is how everything else tells.
    expect(BUILDING_DEFS[BuildingKind.Stockpile].recipe).toBeNull();
  });

  it("cuts two rock into one block", () => {
    const sim = peopledSim();
    const mason = workshop(sim, 2);
    stock(sim, mason, ItemType.Rock, ROCK_PER_BLOCK);

    for (let t = 0; t < 200 && !sim.items.some((it) => it.type === ItemType.Block); t++) advanceTick(sim);
    expect(sim.items.filter((it) => it.type === ItemType.Block)).toHaveLength(1);
    // The whole batch is consumed at the *start* of the cut, so the ratio is
    // never half-charged.
    expect(sim.items.filter((it) => it.type === ItemType.Rock)).toHaveLength(0);
  });

  it("will not start a batch it cannot finish", () => {
    const sim = peopledSim();
    const mason = workshop(sim, 2);
    // One rock, and the ratio is two: nothing is consumed and nothing starts,
    // rather than a rock vanishing into a batch that can never complete.
    stock(sim, mason, ItemType.Rock, 1);
    for (let t = 0; t < 100; t++) advanceTick(sim);
    expect(mason.millProgress).toBe(-1);
    expect(sim.items.filter((it) => it.type === ItemType.Rock)).toHaveLength(1);
    expect(inspect(sim, mason.id)?.stall).toBe("no-input");
  });

  it("stops at its output cap and says so in the panel's own words", () => {
    const sim = peopledSim();
    const mason = workshop(sim, 2);
    stock(sim, mason, ItemType.Block, WORKSHOP_OUTPUT_CAP);
    stock(sim, mason, ItemType.Rock, ROCK_PER_BLOCK);

    for (let t = 0; t < 100; t++) advanceTick(sim);
    expect(outputFull(sim, mason)).toBe(true);
    expect(sim.items.filter((it) => it.type === ItemType.Block)).toHaveLength(WORKSHOP_OUTPUT_CAP);
    const view = inspect(sim, mason.id)!;
    expect(view.stall).toBe("output-full");
    // Named from the recipe, so the panel says rock and blocks rather than
    // inheriting the sawmill's vocabulary.
    expect(view.chain).toEqual({ input: "Rock", output: "Block" });
    expect(view.inputCount).toBe(ROCK_PER_BLOCK);
  });

  it("takes rock in and refuses everything else", () => {
    const sim = peopledSim();
    const mason = workshop(sim, 2);
    expect(freeCapacity(sim, mason, ItemType.Rock)).toBeGreaterThan(0);
    for (const type of [ItemType.Log, ItemType.Plank, ItemType.Block]) {
      expect(freeCapacity(sim, mason, type)).toBe(0);
    }
    // And its own output may leave, which is what lets a hauler empty it.
    expect(recipeOf(mason)?.output).toBe(ItemType.Block);
  });

  it("has its rock hauled in and its blocks hauled out", () => {
    const sim = peopledSim();
    workshop(sim, 2);
    applyCommands(sim, [{ kind: "place", building: BuildingKind.Stockpile, x: 3, y: 8 }]);
    const pile = sim.buildings.find((b) => b.kind === BuildingKind.Stockpile)!;
    pile.state = BuildingState.Active;

    // Loose rock on the ground: the mason's input buffer outranks the
    // stockpile, so the rock goes to work rather than into storage.
    for (let i = 0; i < 2; i++) spawnItem(sim, ItemType.Rock, 6, 10);
    generateTasks(sim);
    expect(sim.tasks.filter((t) => t.kind === TaskKind.HaulToInput)).toHaveLength(2);

    for (let t = 0; t < 400 && !sim.items.some((it) => it.type === ItemType.Block && it.holder === pile.id); t++) {
      advanceTick(sim);
    }
    // A finished block found its way from the mason's output buffer into the
    // stockpile — through filtered storage, with no building handing anything
    // to another.
    expect(sim.items.some((it) => it.type === ItemType.Block && it.holder === pile.id)).toBe(true);
  });
});

describe("a stockpile's filters", () => {
  it("accept every good the game has by default", () => {
    const sim = peopledSim();
    applyCommands(sim, [{ kind: "place", building: BuildingKind.Stockpile, x: 8, y: 8 }]);
    const pile = sim.buildings[0];
    pile.state = BuildingState.Active;
    // Walked from the goods table rather than written out: every appended
    // `ItemType` has to arrive accepted, and a literal list here would quietly
    // stop covering the newest good.
    for (const good of GOOD_LIST) {
      expect(freeCapacity(sim, pile, good.type)).toBeGreaterThan(0);
    }
    expect(inspect(sim, pile.id)?.stored.map((s) => s.accepted)).toEqual(GOOD_LIST.map(() => true));
  });

  it("refuses a good whose filter is off, and keeps taking the rest", () => {
    const sim = peopledSim();
    applyCommands(sim, [{ kind: "place", building: BuildingKind.Stockpile, x: 8, y: 8 }]);
    const pile = sim.buildings[0];
    pile.state = BuildingState.Active;
    pile.acceptRock = 0;
    expect(freeCapacity(sim, pile, ItemType.Rock)).toBe(0);
    expect(freeCapacity(sim, pile, ItemType.Block)).toBeGreaterThan(0);

    spawnItem(sim, ItemType.Rock, 12, 12);
    for (let i = 0; i < 5; i++) generateTasks(sim);
    expect(sim.tasks.filter((t) => t.kind === TaskKind.HaulToStore)).toHaveLength(0);
  });
});
