import { describe, expect, it } from "vitest";
import { BUILDING_DEFS, canPlace, freeCapacity, outputFull, recipeOf } from "../buildings";
import { applyCommands, type Command } from "../commands";
import { GOOD_LIST } from "../goods";
import { canMine } from "../ground";
import { countItems, spawnItem } from "../items";
import { generateTasks } from "../labour/tasks";
import { hashSim } from "../hash";
import { inspect } from "../know";
import {
  BuildingKind,
  BuildingState,
  ItemType,
  Loc,
  TaskKind,
  createSim,
  type Building,
  type Sim,
} from "../store";
import { flatSim, testColonist } from "../test-sim";
import { advanceTick } from "../tick";
import { FARM_TICKS, MILL_TICKS_5B, OVEN_TICKS, WORKSHOP_OUTPUT_CAP } from "../tuning";
import { tileIndex } from "../world/world";

/**
 * The first deep chain: Farm → grain, Mill → flour, Oven → bread
 * (docs/specs/2026-09-08-bread-economy.md).
 *
 * Two halves, for the two things worth proving. The **scripted run** is a third
 * golden run on a selected seed — 20260931, whose nearest outcrop is five tiles
 * from the colony and whose nearest den is ninety-one — because the Oven costs
 * *blocks*, and on the labour pin's own seed the stone is fifty tiles out
 * (which is exactly why `tick.test.ts` pins the quarry order and the walk while
 * `walls/stone.test.ts` pins the chain that comes off it). Found by seed
 * selection rather than by rigging a world, as every run in this repo is.
 *
 * The **unit half** is the `per: 0` recipe: the Farm consumes nothing, and what
 * has to be pinned is that every consumer of `Recipe` stays inert about it
 * rather than inventing an input buffer, ordering a haul, or telling the player
 * it is waiting for grain.
 */

const SEED = 20260931;
const CENTRE = 128;
const SIZE = 256;
/** Long enough for the first loaf out of the oven (t1922) and for the colony to
 *  start eating its own bread, and no longer: the run is the cost of the file. */
const TICKS = 2400;

/** The pinned hash of the run. Named so a move history can cite it. */
const PINNED = "bc976ea5";

function trees(sim: Sim, count: number): number[] {
  const out: number[] = [];
  for (let r = 1; r < 40 && out.length < count; r++) {
    for (let dy = -r; dy <= r && out.length < count; dy++) {
      for (let dx = -r; dx <= r && out.length < count; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const i = tileIndex(CENTRE + dx, CENTRE + dy, SIZE);
        if (sim.world.treeMap[i]) out.push(i);
      }
    }
  }
  return out;
}

function rocks(sim: Sim, count: number): number[] {
  const out: number[] = [];
  for (let r = 1; r < 40 && out.length < count; r++) {
    for (let dy = -r; dy <= r && out.length < count; dy++) {
      for (let dx = -r; dx <= r && out.length < count; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        if (canMine(sim, CENTRE + dx, CENTRE + dy)) out.push(tileIndex(CENTRE + dx, CENTRE + dy, SIZE));
      }
    }
  }
  return out;
}

/** The nearest site this kind fits, kept clear of what is already built — a
 *  pure function of the store, like every choice the scripts here make. */
function site(sim: Sim, kind: 0 | 2 | 4 | 5 | 6): [number, number] | null {
  for (let r = 2; r < 30; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = CENTRE + dx;
        const y = CENTRE + dy;
        if (sim.buildings.some((b) => Math.abs(x - b.x) < 5 && Math.abs(y - b.y) < 5)) continue;
        if (canPlace(sim, kind, x, y)) return [x, y];
      }
    }
  }
  return null;
}

const put = (sim: Sim, kind: 0 | 2 | 4 | 5 | 6): Command[] => {
  const at = site(sim, kind);
  return at ? [{ kind: "place", building: kind, x: at[0], y: at[1] }] : [];
};

const hire = (sim: Sim, kind: number): Command[] => {
  const b = sim.buildings.find((x) => x.kind === kind && x.state === BuildingState.Active);
  return b ? [{ kind: "staff", building: b.id }] : [];
};

/**
 * The shortest honest road to a loaf: chop, a stockpile, a mason and three
 * outcrops for the Oven's blocks, then the three workshops and their slot
 * workers — with the mason released at the end, because four slots against five
 * colonists leaves one pair of hands to feed all of them, which is CONCEPT's
 * labour trap arriving on its own without anything staging it.
 */
function script(sim: Sim): Command[] {
  switch (sim.tick) {
    case 0:
      return [{ kind: "designateChop", tiles: trees(sim, 30) }];
    case 5:
      return put(sim, BuildingKind.Stockpile);
    // A new pile accepts nothing (2026-09-14-stockpile-default-and-clearing), so the
    // chain's every good would sit on the ground. Opened the tick after
    // placement, while the pile is still a blueprint and nothing reads its
    // filters, so the run below is the one this file has always pinned.
    case 6: {
      const pile = sim.buildings.find((b) => b.kind === BuildingKind.Stockpile);
      return pile ? [{ kind: "setAllFilters", building: pile.id, on: true }] : [];
    }
    case 150:
      return put(sim, BuildingKind.Mason);
    case 400:
      return hire(sim, BuildingKind.Mason);
    case 420:
      return [{ kind: "designateMine", tiles: rocks(sim, 3) }];
    case 600:
      return put(sim, BuildingKind.Farm);
    case 650:
      return put(sim, BuildingKind.Mill);
    // Placed once blocks are coming out of the mason, so the site is fed rather
    // than standing as a frame — the stone tier's own lesson.
    case 900:
      return put(sim, BuildingKind.Oven);
    case 1300:
      return hire(sim, BuildingKind.Farm);
    case 1500:
      return hire(sim, BuildingKind.Mill);
    case 1800: {
      const mason = sim.buildings.find((b) => b.kind === BuildingKind.Mason);
      return [
        ...hire(sim, BuildingKind.Oven),
        ...(mason ? [{ kind: "unstaff" as const, building: mason.id }] : []),
      ];
    }
    default:
      return [];
  }
}

/** What the run *did*, watched as it happened: the interesting facts are all
 *  transient — a loaf is baked and eaten inside a game-day. */
interface Trace {
  sim: Sim;
  /** When the colony's bread count first *rose*, which can only be an oven. */
  bakedAt: number;
  /** When it first fell, which can only be somebody eating. */
  ateAt: number;
}

function chainRun(ticks: number): Trace {
  const sim = createSim(SEED);
  const out: Trace = { sim, bakedAt: -1, ateAt: -1 };
  let held = countItems(sim, ItemType.Bread);
  for (let t = 0; t < ticks; t++) {
    advanceTick(sim, script(sim));
    const now = countItems(sim, ItemType.Bread);
    if (now > held && out.bakedAt < 0) out.bakedAt = t;
    if (now < held && out.ateAt < 0) out.ateAt = t;
    held = now;
  }
  return out;
}

/** Computed once and shared by every assertion that only reads it — the run is
 *  the whole cost of this file, and this suite has hit its timeout before. */
let done: Trace | null = null;
const watched = (): Trace => (done ??= chainRun(TICKS));
const colony = (): Sim => watched().sim;
const of = (sim: Sim, kind: number): Building | undefined => sim.buildings.find((b) => b.kind === kind);

describe("the scripted bread chain", () => {
  it("replays byte-identically", () => {
    expect(hashSim(colony())).toBe(hashSim(chainRun(TICKS).sim));
  });

  it("holds its golden hash", () => {
    // A hash change here is a change to the food chain or to the meal loop. If
    // this fails, say in the changelog what moved and why — the assertions
    // below are what tell you whether it moved for a reason.
    //
    // dacffdb6 → 077aabf8 with the sheep chain (SAVE_VERSION 10,
    // docs/changelog/2026-09-11-sheep-and-clothes.md). **Shape only**, and
    // proved rather than argued: strip the two new colonist fields and the four
    // new `limits` slots back out and this run hashes to dacffdb6 exactly. It could
    // not be otherwise — no script here builds a Tailor, so no garment exists,
    // so the composed `workTicks` pays every tick what the old boolean gate
    // paid, and every assertion in this file is unchanged and still passes.
    // 077aabf8 → PINNED with the drink chain (SAVE_VERSION 11,
    // docs/changelog/2026-09-14-hives-and-mead.md). **Shape only**, and proved
    // rather than argued: strip the two new `Building` accept flags and the two
    // new `limits` slots back out and this run hashes to 077aabf8 exactly. It could
    // not be otherwise — no script here builds a Hive, a Flowers or a Meadery,
    // so no mead exists, so `cellarSet` is false on every tick and the
    // countdown decrements by one as it always did, `batchTicks` answers
    // `recipe.ticks` for every kind present, and `drinkCup` finds nothing.
    //
    // 2e74c71c → PINNED with incursions (SAVE_VERSION 12,
    // docs/specs/2026-09-17-incursions-from-the-sea.md). **Shape and ids, and
    // the run is still wholly peaceful**: the opening grace outlasts it, so
    // nothing lands. `createSim` no longer mints two dozen monsters before the
    // opening five, so every entity here is numbered lower, and the store
    // gained three forecast fields — one of which (`stormLanding`) resolves to
    // a real tile on the first tick, off a bearing derived from the world seed.
    expect(hashSim(colony())).toBe(PINNED);
  });

  it("grows grain, grinds flour and bakes bread — every step through storage", () => {
    const sim = colony();
    for (const kind of [BuildingKind.Farm, BuildingKind.Mill, BuildingKind.Oven]) {
      expect(of(sim, kind)?.state).toBe(BuildingState.Active);
      expect(of(sim, kind)?.worker).toBeGreaterThanOrEqual(0);
    }
    // All three goods exist, which can only have happened in order: the mill
    // has no input but the farm's grain, and the oven none but the mill's flour.
    expect(countItems(sim, ItemType.Grain)).toBeGreaterThan(0);
    expect(countItems(sim, ItemType.Flour)).toBeGreaterThan(0);
    expect(countItems(sim, ItemType.Bread)).toBeGreaterThan(0);

    // And it flowed through **filtered storage** rather than building to
    // building: the pile holds goods it never produced, which is the only way
    // they could have reached the workshop that consumed them.
    const pile = of(sim, BuildingKind.Stockpile)!;
    const stored = sim.items.filter((it) => it.loc === Loc.Stored && it.holder === pile.id);
    expect(stored.some((it) => it.type === ItemType.Grain || it.type === ItemType.Flour)).toBe(true);
  });

  it("bakes before anybody eats what it baked, and the loaf count moves both ways", () => {
    const { bakedAt, ateAt } = watched();
    // A meal is a loaf off the map — the count falls, on the second game-day,
    // long before the oven exists.
    expect(ateAt).toBeGreaterThan(0);
    expect(ateAt).toBeLessThan(bakedAt);
    // And an oven's loaf is the count *rising*, which nothing else in the game
    // can do.
    expect(bakedAt).toBeGreaterThan(0);
  });

  it("keeps the colony fed on its own bread, with nobody slowed", () => {
    const sim = colony();
    expect(sim.colonists).toHaveLength(5);
    // Nobody past `HUNGRY_TICKS`: the chain is feeding them, which is the whole
    // point of building it. The provisions ran out on day four — the run is
    // longer than that — so these are loaves the oven baked.
    for (const c of sim.colonists) expect(c.hunger).toBeLessThan(900);
  });

  it("puts four of five colonists in slots, and the pool feels it", () => {
    // The labour trap at full depth: with the mason released the colony still
    // has three workshops staffed out of five pairs of hands, and everything
    // those three eat has to be carried by the two that are left.
    const sim = colony();
    const slotted = sim.colonists.filter((c) => c.slot >= 0);
    expect(slotted).toHaveLength(3);
    expect(of(sim, BuildingKind.Mason)?.worker).toBe(-1);
  });
});

// -------------------------------------------------------------------- units

/** A flat world with three colonists standing on it. */
function peopledSim(size = 24): Sim {
  const sim = flatSim(size);
  for (let i = 0; i < 3; i++) {
    sim.colonists.push(testColonist({ id: sim.nextId++, x: 2 + i + 0.5, y: 2.5 }));
  }
  return sim;
}

/** A finished, staffed workshop with its worker already inside. */
function workshop(sim: Sim, kind: 4 | 5 | 6, x = 10, y = 10): Building {
  applyCommands(sim, [{ kind: "place", building: kind, x, y }]);
  const b = sim.buildings[sim.buildings.length - 1];
  b.state = BuildingState.Active;
  applyCommands(sim, [{ kind: "staff", building: b.id }]);
  for (let t = 0; t < 200 && !sim.colonists.some((c) => c.slot === b.id && c.inside); t++) advanceTick(sim);
  return b;
}

function stock(sim: Sim, b: Building, type: number, n: number): void {
  for (let i = 0; i < n; i++) {
    const item = spawnItem(sim, type, b.x + 6, b.y)!;
    item.loc = Loc.Stored;
    item.holder = b.id;
    item.x = -1;
    item.y = -1;
  }
}

describe("the three defs", () => {
  it("are the Mason move repeated, plus one recipe that eats nothing", () => {
    const farm = BUILDING_DEFS[BuildingKind.Farm];
    const mill = BUILDING_DEFS[BuildingKind.Mill];
    const oven = BUILDING_DEFS[BuildingKind.Oven];

    // The Farm is the biggest footprint in the game, deliberately: land
    // pressure is what the food chain is for.
    expect([farm.w, farm.h]).toEqual([3, 3]);
    expect(farm.recipe).toMatchObject({ per: 0, inputCap: 0, output: ItemType.Grain, ticks: FARM_TICKS });
    // The dummy input names the output good rather than being nullable — the
    // pinned representation, so two readers cannot diverge.
    expect(farm.recipe?.input).toBe(ItemType.Grain);

    expect(mill.recipe).toMatchObject({ input: ItemType.Grain, per: 1, output: ItemType.Flour, ticks: MILL_TICKS_5B });
    expect(oven.recipe).toMatchObject({ input: ItemType.Flour, per: 1, output: ItemType.Bread, ticks: OVEN_TICKS });

    // The Oven is the first building in the game priced in blocks, which is the
    // chain's real outward pull: stone wants outcrops.
    expect(oven.costType).toBe(ItemType.Block);
    expect(farm.costType).toBe(ItemType.Log);
    expect(mill.costType).toBe(ItemType.Log);
    for (const def of [farm, mill, oven]) expect(def.hasSlot).toBe(true);
  });
});

describe("the Farm's no-input recipe", () => {
  it("takes nothing in, of any good, and is never sent a haul", () => {
    const sim = peopledSim();
    const farm = workshop(sim, BuildingKind.Farm);
    // Not even its own dummy input good: `inputCap` is 0, so there is no
    // buffer to fill and `freeCapacity` says so for everything.
    for (const good of GOOD_LIST) expect(freeCapacity(sim, farm, good.type)).toBe(0);

    // Grain lying on the ground goes to a stockpile, never back into the farm
    // that grew it.
    applyCommands(sim, [{ kind: "place", building: BuildingKind.Stockpile, x: 4, y: 10 }]);
    const pile = sim.buildings[sim.buildings.length - 1];
    pile.state = BuildingState.Active;
    applyCommands(sim, [{ kind: "setAllFilters", building: pile.id, on: true }]);
    spawnItem(sim, ItemType.Grain, 8, 14);
    generateTasks(sim);
    expect(sim.tasks.filter((t) => t.kind === TaskKind.HaulToInput)).toHaveLength(0);
    expect(sim.tasks.filter((t) => t.kind === TaskKind.HaulToStore)).toHaveLength(1);
  });

  it("grows grain out of an empty building, and stops at its output cap", () => {
    const sim = peopledSim();
    const farm = workshop(sim, BuildingKind.Farm);
    for (let t = 0; t < FARM_TICKS + 20 && countItems(sim, ItemType.Grain) === 0; t++) advanceTick(sim);
    expect(countItems(sim, ItemType.Grain)).toBe(1);
    // Nothing was consumed, because there is nothing to consume: the batch
    // gathering takes an empty slice and passes.
    expect(sim.items.every((it) => it.type === ItemType.Grain || it.type === ItemType.Bread)).toBe(true);

    // With no hauler to empty it the buffer fills and the farm stops — the
    // ordinary output cap, on a workshop with no input.
    for (let t = 0; t < FARM_TICKS * 4; t++) advanceTick(sim);
    expect(outputFull(sim, farm)).toBe(true);
    expect(countItems(sim, ItemType.Grain)).toBe(WORKSHOP_OUTPUT_CAP);
    expect(inspect(sim, farm.id)?.stall).toBe("output-full");
  });

  it("answers to a ceiling like any other workshop", () => {
    // Production control promised "any workshop with a recipe", and grain never
    // needed the raw-good exclusion because it is grown by a recipe.
    const sim = peopledSim();
    // The ceiling goes on **before** the farmer is inside, so nothing is ever
    // in flight: a batch already under way finishes whatever the ceiling says,
    // which is production control's own rule and not what is being asked here.
    applyCommands(sim, [{ kind: "setLimit", type: ItemType.Grain, value: 0 }]);
    const farm = workshop(sim, BuildingKind.Farm);
    for (let t = 0; t < FARM_TICKS * 3; t++) advanceTick(sim);
    expect(countItems(sim, ItemType.Grain)).toBe(0);
    expect(inspect(sim, farm.id)?.stall).toBe("at-limit");

    applyCommands(sim, [{ kind: "setLimit", type: ItemType.Grain, value: -1 }]);
    for (let t = 0; t < FARM_TICKS + 20 && countItems(sim, ItemType.Grain) === 0; t++) advanceTick(sim);
    expect(countItems(sim, ItemType.Grain)).toBe(1);
  });

  it("never tells the player it is waiting for something to arrive", () => {
    // The panel is the only place the game explains a stall, so "waiting for
    // grain" on a building that grows grain would be the one thing it may
    // never do. Its chain chip is one-sided for the same reason.
    const sim = peopledSim();
    const farm = workshop(sim, BuildingKind.Farm);
    const view = inspect(sim, farm.id)!;
    expect(view.chain).toEqual({ input: null, output: "Grain" });
    expect(view.inputCap).toBe(0);
    expect(view.stall).not.toBe("no-input");

    // And with the ceiling and the buffer both clear it is simply working —
    // there is no state in which this workshop has nothing and waits.
    applyCommands(sim, [{ kind: "setLimit", type: ItemType.Grain, value: 0 }]);
    for (let t = 0; t < FARM_TICKS * 3; t++) advanceTick(sim);
    stock(sim, farm, ItemType.Grain, WORKSHOP_OUTPUT_CAP);
    applyCommands(sim, [{ kind: "setLimit", type: ItemType.Grain, value: -1 }]);
    advanceTick(sim);
    expect(inspect(sim, farm.id)?.stall).toBe("output-full");
  });
});

describe("the Mill and the Oven", () => {
  it("grind and bake one for one, through their own buffers", () => {
    const sim = peopledSim();
    const mill = workshop(sim, BuildingKind.Mill, 10, 10);
    stock(sim, mill, ItemType.Grain, 2);
    for (let t = 0; t < MILL_TICKS_5B * 3 && countItems(sim, ItemType.Flour) < 2; t++) advanceTick(sim);
    expect(countItems(sim, ItemType.Flour)).toBe(2);
    expect(countItems(sim, ItemType.Grain)).toBe(0);

    const oven = workshop(sim, BuildingKind.Oven, 16, 16);
    stock(sim, oven, ItemType.Flour, 1);
    const before = countItems(sim, ItemType.Bread);
    for (let t = 0; t < OVEN_TICKS * 3 && countItems(sim, ItemType.Bread) === before; t++) advanceTick(sim);
    expect(countItems(sim, ItemType.Bread)).toBe(before + 1);
    expect(recipeOf(oven)?.output).toBe(ItemType.Bread);
  });
});
