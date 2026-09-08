import { describe, expect, it } from "vitest";
import { freeCapacity } from "../buildings";
import { applyCommands } from "../commands";
import { GOOD_LIST } from "../goods";
import { countItems, spawnItem } from "../items";
import { generateTasks } from "../labour/tasks";
import { inspect } from "../know";
import { BuildingKind, BuildingState, ItemType, Loc, TaskKind, type Building, type Sim } from "../store";
import { flatSim } from "../test-sim";
import { advanceTick } from "../tick";
import { LIMIT_MAX, LIMIT_STEP, MILL_TICKS, UNLIMITED, WORKSHOP_INPUT_CAP, WORKSHOP_OUTPUT_CAP } from "../tuning";
import { atLimit, clampLimit, stepLimit } from "./limits";

/**
 * Production ceilings (docs/specs/2026-09-07-production-control.md): the brake
 * on a workshop, and the one thing that stops a staffed sawmill converting
 * every log on the island.
 *
 * What these pin: the ceiling gates the two places new work *starts* — the
 * haul that feeds the input buffer and the batch the workshop begins — and
 * nothing else. A batch under way finishes, a haul on its way delivers, and
 * `-1` is exactly the colony as it was before ceilings existed.
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

/** A finished stockpile. */
function stockpile(sim: Sim, x = 3, y = 8): Building {
  applyCommands(sim, [{ kind: "place", building: BuildingKind.Stockpile, x, y }]);
  const b = sim.buildings[sim.buildings.length - 1];
  b.state = BuildingState.Active;
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

const planks = (sim: Sim): number => countItems(sim, ItemType.Plank);
const inputHauls = (sim: Sim, b: Building): number =>
  sim.tasks.filter((t) => t.kind === TaskKind.HaulToInput && t.building === b.id).length;

describe("a production ceiling", () => {
  it("is unlimited by default, and unlimited is the colony as it was", () => {
    const sim = peopledSim();
    expect(sim.limits).toEqual(GOOD_LIST.map(() => UNLIMITED));
    const mill = workshop(sim, 1);
    stock(sim, mill, ItemType.Log, WORKSHOP_INPUT_CAP);
    for (let t = 0; t < MILL_TICKS * 3; t++) advanceTick(sim);
    // Two logs, two planks, no brake anywhere: exactly what the mill did before
    // ceilings existed, which is what "old saves migrate untouched" rests on.
    expect(planks(sim)).toBe(2);
    expect(atLimit(sim, ItemType.Plank)).toBe(false);
  });

  it("stops the haul that feeds the workshop at the threshold, and restarts it below", () => {
    const sim = peopledSim();
    const mill = workshop(sim, 1);
    const pile = stockpile(sim);
    stock(sim, pile, ItemType.Log, 6);
    applyCommands(sim, [{ kind: "setLimit", type: ItemType.Plank, value: 2 }]);

    // Two planks anywhere — on the ground, far from any building — and the
    // colony is at its ceiling: the mill orders no logs however empty it is.
    spawnItem(sim, ItemType.Plank, 15, 15);
    spawnItem(sim, ItemType.Plank, 16, 15);
    generateTasks(sim);
    expect(atLimit(sim, ItemType.Plank)).toBe(true);
    expect(inputHauls(sim, mill)).toBe(0);

    // One plank spent — and the very next generation orders logs again, with
    // no band to climb back through.
    sim.items.splice(sim.items.findIndex((it) => it.type === ItemType.Plank), 1);
    generateTasks(sim);
    expect(atLimit(sim, ItemType.Plank)).toBe(false);
    expect(inputHauls(sim, mill)).toBe(WORKSHOP_INPUT_CAP);
  });

  it("lets a batch already under way finish, then starts no other", () => {
    const sim = peopledSim();
    const mill = workshop(sim, 1);
    stock(sim, mill, ItemType.Log, WORKSHOP_INPUT_CAP);
    // Run until the first log has been eaten and the cut is under way.
    for (let t = 0; t < 50 && mill.millProgress < 0; t++) advanceTick(sim);
    expect(mill.millProgress).toBeGreaterThanOrEqual(0);

    // A ceiling of zero — "make none" — lowered mid-cut.
    applyCommands(sim, [{ kind: "setLimit", type: ItemType.Plank, value: 0 }]);
    for (let t = 0; t < MILL_TICKS * 3; t++) advanceTick(sim);

    // The cut finished and delivered — nothing half-made, nothing dropped — and
    // the second log is still a log, sitting in the buffer for when the ceiling
    // lifts. That parked log is the spec's accepted quirk: inputs are never
    // taken back out.
    expect(planks(sim)).toBe(1);
    expect(mill.millProgress).toBe(-1);
    expect(sim.items.filter((it) => it.type === ItemType.Log && it.holder === mill.id)).toHaveLength(1);
    expect(inspect(sim, mill.id)?.stall).toBe("at-limit");
  });

  it("below the current count means stop, and the count drifting down means go", () => {
    const sim = peopledSim();
    const mill = workshop(sim, 1);
    stock(sim, mill, ItemType.Log, WORKSHOP_INPUT_CAP);
    for (let i = 0; i < 4; i++) spawnItem(sim, ItemType.Plank, 15, 15 + i);
    applyCommands(sim, [{ kind: "setLimit", type: ItemType.Plank, value: 2 }]);

    for (let t = 0; t < MILL_TICKS; t++) advanceTick(sim);
    expect(mill.millProgress).toBe(-1);
    expect(planks(sim)).toBe(4);

    // Three planks spent: 1 < 2, and the mill picks up where it stood.
    for (let i = 0; i < 3; i++) sim.items.splice(sim.items.findIndex((it) => it.type === ItemType.Plank), 1);
    for (let t = 0; t < MILL_TICKS + 2; t++) advanceTick(sim);
    expect(planks(sim)).toBe(2);
  });

  it("is read off the recipe, so the mason's blocks obey a block ceiling and ignore the plank one", () => {
    const sim = peopledSim();
    const mason = workshop(sim, 2);
    stock(sim, mason, ItemType.Rock, 2);
    applyCommands(sim, [{ kind: "setLimit", type: ItemType.Plank, value: 0 }]);
    generateTasks(sim);
    expect(inspect(sim, mason.id)?.stall).not.toBe("at-limit");

    applyCommands(sim, [{ kind: "setLimit", type: ItemType.Block, value: 0 }]);
    for (let t = 0; t < 100; t++) advanceTick(sim);
    expect(countItems(sim, ItemType.Block)).toBe(0);
    expect(inspect(sim, mason.id)?.stall).toBe("at-limit");
  });

  it("is what the panel reads: the output good, the colony-wide count and the ceiling", () => {
    const sim = peopledSim();
    const mill = workshop(sim, 1);
    spawnItem(sim, ItemType.Plank, 15, 15);
    stock(sim, mill, ItemType.Plank, WORKSHOP_OUTPUT_CAP);
    const view = inspect(sim, mill.id)!;
    expect(view.outputType).toBe(ItemType.Plank);
    expect(view.limit).toBe(UNLIMITED);
    // The loose plank counts too: "in colony" means everywhere.
    expect(view.colonyCount).toBe(WORKSHOP_OUTPUT_CAP + 1);
    expect(view.stall).toBe("output-full");

    // At the ceiling *and* output-full: the ceiling is the player's own setting,
    // so it is the reason the panel gives.
    applyCommands(sim, [{ kind: "setLimit", type: ItemType.Plank, value: 3 }]);
    expect(inspect(sim, mill.id)).toMatchObject({ limit: 3, colonyCount: 3, stall: "at-limit" });

    // A building that produces nothing has no ceiling to report.
    const pile = stockpile(sim);
    expect(inspect(sim, pile.id)).toMatchObject({ outputType: -1, limit: UNLIMITED, colonyCount: 0 });
  });
});

describe("the setLimit command", () => {
  it("clamps to unlimited or the settable range, and refuses nonsense", () => {
    const sim = peopledSim();
    const set = (value: number): void => applyCommands(sim, [{ kind: "setLimit", type: ItemType.Plank, value }]);
    set(7);
    expect(sim.limits[ItemType.Plank]).toBe(7);
    set(-5);
    expect(sim.limits[ItemType.Plank]).toBe(UNLIMITED);
    set(LIMIT_MAX + 50);
    expect(sim.limits[ItemType.Plank]).toBe(LIMIT_MAX);
    set(3.7);
    expect(sim.limits[ItemType.Plank]).toBe(3);
    set(Number.NaN);
    expect(sim.limits[ItemType.Plank]).toBe(3);
    // A good the store has no slot for is refused rather than growing the array.
    applyCommands(sim, [{ kind: "setLimit", type: 99, value: 4 }]);
    expect(sim.limits).toHaveLength(GOOD_LIST.length);
    expect(clampLimit(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("the stepLimit command", () => {
  it("lands where one press of a live panel would, whatever the panel showed when pressed", () => {
    const sim = peopledSim();
    applyCommands(sim, [{ kind: "setLimit", type: ItemType.Plank, value: 50 }]);
    // Two presses inside one tick — `−` then `+` — both queued from a panel
    // reading 50. Absolute targets would have sent 45 then 55; press by press
    // they cancel out, which is what the player did.
    applyCommands(sim, [
      { kind: "stepLimit", type: ItemType.Plank, dir: -1 },
      { kind: "stepLimit", type: ItemType.Plank, dir: 1 },
    ]);
    expect(sim.limits[ItemType.Plank]).toBe(50);

    // Three presses queued while paused, released by one tick: three steps,
    // the first landing on the count rounded up as a live panel's would.
    applyCommands(sim, [{ kind: "setLimit", type: ItemType.Plank, value: UNLIMITED }]);
    for (let i = 0; i < 14; i++) spawnItem(sim, ItemType.Plank, 10 + i, 15);
    applyCommands(sim, [
      { kind: "stepLimit", type: ItemType.Plank, dir: -1 },
      { kind: "stepLimit", type: ItemType.Plank, dir: -1 },
      { kind: "stepLimit", type: ItemType.Plank, dir: -1 },
    ]);
    expect(sim.limits[ItemType.Plank]).toBe(15 - 2 * LIMIT_STEP);
  });

  it("refuses a direction that is not a press, and a good with no slot", () => {
    const sim = peopledSim();
    applyCommands(sim, [{ kind: "stepLimit", type: ItemType.Plank, dir: 3 as unknown as 1 }]);
    applyCommands(sim, [{ kind: "stepLimit", type: 99, dir: -1 }]);
    expect(sim.limits).toEqual(GOOD_LIST.map(() => UNLIMITED));
  });
});

describe("the toggleFilter command", () => {
  it("flips one accept flag on a stockpile and nothing else", () => {
    const sim = peopledSim();
    const pile = stockpile(sim);
    applyCommands(sim, [{ kind: "toggleFilter", building: pile.id, type: ItemType.Plank }]);
    expect([pile.acceptLog, pile.acceptPlank, pile.acceptRock, pile.acceptBlock]).toEqual([1, 0, 1, 1]);
    expect(freeCapacity(sim, pile, ItemType.Plank)).toBe(0);
    expect(freeCapacity(sim, pile, ItemType.Log)).toBeGreaterThan(0);
    applyCommands(sim, [{ kind: "toggleFilter", building: pile.id, type: ItemType.Plank }]);
    expect(pile.acceptPlank).toBe(1);
  });

  it("is refused for anything that is not a stockpile, and for a good that does not exist", () => {
    const sim = peopledSim();
    const mill = workshop(sim, 1);
    const pile = stockpile(sim);
    applyCommands(sim, [{ kind: "toggleFilter", building: mill.id, type: ItemType.Log }]);
    expect(mill.acceptLog).toBe(1);
    applyCommands(sim, [{ kind: "toggleFilter", building: pile.id, type: 9 }]);
    applyCommands(sim, [{ kind: "toggleFilter", building: 999, type: ItemType.Log }]);
    expect([pile.acceptLog, pile.acceptPlank, pile.acceptRock, pile.acceptBlock]).toEqual([1, 1, 1, 1]);
  });

  it("routes rather than brakes: a log-only pile still feeds the mill, and takes no planks", () => {
    const sim = peopledSim();
    const mill = workshop(sim, 1);
    const pile = stockpile(sim);
    stock(sim, pile, ItemType.Log, 4);
    for (const type of [ItemType.Plank, ItemType.Rock, ItemType.Block]) {
      applyCommands(sim, [{ kind: "toggleFilter", building: pile.id, type }]);
    }
    // A finished plank in the mill's output buffer, wanting a home.
    stock(sim, mill, ItemType.Plank, 1);
    generateTasks(sim);

    // The mill's input hauls draw on the pile's logs — outflow is untouched by
    // any filter — while the plank has nowhere to go and stays where it is.
    const hauls = sim.tasks.filter((t) => t.kind === TaskKind.HaulToInput && t.building === mill.id);
    expect(hauls).toHaveLength(WORKSHOP_INPUT_CAP);
    for (const h of hauls) expect(sim.items.find((it) => it.id === h.item)?.holder).toBe(pile.id);
    expect(sim.tasks.some((t) => t.kind === TaskKind.HaulToStore)).toBe(false);
  });

  it("grandfathers what the pile already holds", () => {
    const sim = peopledSim();
    const pile = stockpile(sim);
    stock(sim, pile, ItemType.Plank, 3);
    applyCommands(sim, [{ kind: "toggleFilter", building: pile.id, type: ItemType.Plank }]);
    for (let t = 0; t < 30; t++) advanceTick(sim);
    // Stored items are not loose, so nothing re-homes them: still three planks
    // in a pile that now refuses planks, visible in its per-type count.
    expect(sim.items.filter((it) => it.type === ItemType.Plank && it.holder === pile.id)).toHaveLength(3);
    expect(inspect(sim, pile.id)?.stored.find((s) => s.type === ItemType.Plank)).toMatchObject({
      count: 3,
      accepted: false,
    });
  });
});

describe("the stepper's landings", () => {
  it("from unlimited, one press down lands on the count rounded up to the step", () => {
    expect(stepLimit(UNLIMITED, 14, -1)).toBe(15);
    expect(stepLimit(UNLIMITED, 15, -1)).toBe(15);
    expect(stepLimit(UNLIMITED, 0, -1)).toBe(0);
    // A colony holding more than the range tops out at the range: still "stop".
    expect(stepLimit(UNLIMITED, LIMIT_MAX + 37, -1)).toBe(LIMIT_MAX);
    // Unlimited is the top: up from it goes nowhere.
    expect(stepLimit(UNLIMITED, 14, 1)).toBe(UNLIMITED);
  });

  it("then moves by fives, back to unlimited past the top and no lower than zero", () => {
    expect(stepLimit(15, 14, 1)).toBe(15 + LIMIT_STEP);
    expect(stepLimit(15, 14, -1)).toBe(15 - LIMIT_STEP);
    expect(stepLimit(LIMIT_MAX, 14, 1)).toBe(UNLIMITED);
    expect(stepLimit(LIMIT_MAX - LIMIT_STEP, 14, 1)).toBe(LIMIT_MAX);
    expect(stepLimit(0, 14, -1)).toBe(0);
    expect(stepLimit(LIMIT_STEP, 14, -1)).toBe(0);
    // An off-step ceiling snaps to the grid in the direction pressed.
    expect(stepLimit(17, 14, 1)).toBe(20);
    expect(stepLimit(17, 14, -1)).toBe(15);
  });
});
