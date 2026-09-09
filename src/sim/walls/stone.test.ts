import { describe, expect, it } from "vitest";
import { applyCommands } from "../commands";
import { spawnItem } from "../items";
import { generateTasks } from "../labour/tasks";
import { ItemType, Loc, TaskKind, type Sim } from "../store";
import { flatSim, testColonist } from "../test-sim";
import { advanceTick } from "../tick";
import { STONE_BUILD_TICKS, WALL_BUILD_TICKS } from "../tuning";
import { tileIndex } from "../world/world";
import {
  WallState,
  blueprintFor,
  builtForm,
  isBlocking,
  isBlueprint,
  isBuilt,
  isGateway,
  isStoneWall,
  isWalkable,
  wallBuildTicks,
  wallItem,
  wallMaterial,
} from "./index";

/**
 * The stone tier: the permanent wall, and the expansion loop it completes.
 *
 * The predicate table comes first, because everything else in the game reads
 * the wall layer through it — four states were appended and not one consumer
 * was edited, which only stays true while every row below is right.
 */

const at = (sim: Sim, x: number, y: number): number => tileIndex(x, y, sim.world.size);

function peopledSim(size = 24): Sim {
  const sim = flatSim(size);
  for (let i = 0; i < 4; i++) {
    sim.colonists.push(testColonist({ id: sim.nextId++, x: 2 + i + 0.5, y: 2.5 }));
  }
  return sim;
}

describe("the wall state table", () => {
  it("blocks and walks stone exactly as it does timber", () => {
    // Stone wall stops the flood-fill and cannot be stood on; a stone gate
    // does both at once, which is the whole reason the two predicates are not
    // complements.
    expect(isBlocking(WallState.Stone)).toBe(true);
    expect(isWalkable(WallState.Stone)).toBe(false);
    expect(isBlocking(WallState.StoneGate)).toBe(true);
    expect(isWalkable(WallState.StoneGate)).toBe(true);

    // Blueprints of either material stay open ground, so a drawn run can never
    // wall its own builders off half way through.
    for (const state of [WallState.StoneBp, WallState.StoneGateBp]) {
      expect(isBlocking(state)).toBe(false);
      expect(isWalkable(state)).toBe(true);
      expect(isBlueprint(state)).toBe(true);
      expect(isBuilt(state)).toBe(false);
    }
    expect(isBuilt(WallState.Stone)).toBe(true);
    expect(isBuilt(WallState.StoneGate)).toBe(true);
    expect(isBuilt(WallState.None)).toBe(false);
  });

  it("knows what each state is made of, becomes, and costs", () => {
    expect(builtForm(WallState.StoneBp)).toBe(WallState.Stone);
    expect(builtForm(WallState.StoneGateBp)).toBe(WallState.StoneGate);

    expect(wallMaterial(WallState.Stone)).toBe("stone");
    expect(wallMaterial(WallState.Palisade)).toBe("timber");
    expect(wallItem("stone")).toBe(ItemType.Block);
    expect(wallItem("timber")).toBe(ItemType.Log);

    expect(isStoneWall(WallState.StoneGate)).toBe(true);
    expect(isStoneWall(WallState.Gate)).toBe(false);
    expect(isStoneWall(WallState.None)).toBe(false);
    expect(isGateway(WallState.StoneGateBp)).toBe(true);
    expect(isGateway(WallState.StoneBp)).toBe(false);

    // Stone is twice the labour of timber, which is what keeps the palisade
    // worth throwing up first.
    expect(wallBuildTicks(WallState.StoneBp)).toBe(2 * wallBuildTicks(WallState.PalisadeBp));
    expect(wallBuildTicks(WallState.StoneGateBp)).toBe(2 * wallBuildTicks(WallState.GateBp));
    expect(blueprintFor("stone", false)).toBe(WallState.StoneBp);
    expect(blueprintFor("stone", true)).toBe(WallState.StoneGateBp);
    expect(blueprintFor("timber", false)).toBe(WallState.PalisadeBp);
  });
});

describe("raising a stone segment", () => {
  it("hires nobody until a block exists — a log will not do", () => {
    const sim = peopledSim();
    applyCommands(sim, [{ kind: "placeWall", tiles: [at(sim, 8, 8)], material: "stone" }]);
    expect(sim.wallMap[at(sim, 8, 8)]).toBe(WallState.StoneBp);

    // Logs everywhere and the line still waits: the material is per segment,
    // so a stone line drawn before the mason runs is a line of frames.
    for (let i = 0; i < 4; i++) spawnItem(sim, ItemType.Log, 5 + i, 8);
    for (let i = 0; i < 5; i++) generateTasks(sim);
    expect(sim.tasks.filter((t) => t.kind === TaskKind.BuildWall)).toHaveLength(0);

    spawnItem(sim, ItemType.Block, 6, 9);
    generateTasks(sim);
    const walling = sim.tasks.filter((t) => t.kind === TaskKind.BuildWall);
    expect(walling).toHaveLength(1);
    expect(sim.items.find((it) => it.id === walling[0].item)?.type).toBe(ItemType.Block);
  });

  it("carries the block to the segment and consumes it at the completion instant", () => {
    const sim = peopledSim();
    spawnItem(sim, ItemType.Block, 6, 8);
    applyCommands(sim, [{ kind: "placeWall", tiles: [at(sim, 8, 8)], material: "stone" }]);

    let carried = false;
    for (let t = 0; t < 400 && sim.wallMap[at(sim, 8, 8)] !== WallState.Stone; t++) {
      advanceTick(sim);
      if (sim.colonists.some((c) => c.carrying >= 0)) carried = true;
    }
    // The 3a rule, unchanged for stone: carried until the wall flips, so every
    // interruption path refunds for free and no delivery ledger exists.
    expect(carried).toBe(true);
    expect(sim.wallMap[at(sim, 8, 8)]).toBe(WallState.Stone);
    expect(sim.items).toHaveLength(0);
  });

  it("takes twice the work a palisade does", () => {
    const build = (material: "timber" | "stone", item: number): number => {
      const sim = peopledSim();
      spawnItem(sim, item, 8, 6);
      applyCommands(sim, [{ kind: "placeWall", tiles: [at(sim, 8, 8)], material }]);
      // From the first tick of work to the tick it finishes, inclusive — so
      // the walk to fetch the material does not contaminate the comparison,
      // and neither does the completing tick clearing `work` back to zero.
      let began = -1;
      let done = -1;
      for (let t = 0; t < 600 && done < 0; t++) {
        advanceTick(sim);
        if (began < 0 && sim.colonists.some((c) => c.work > 0)) began = t;
        if (isBuilt(sim.wallMap[at(sim, 8, 8)])) done = t;
      }
      return done - began + 1;
    };
    expect(build("timber", ItemType.Log)).toBe(WALL_BUILD_TICKS);
    expect(build("stone", ItemType.Block)).toBe(STONE_BUILD_TICKS);
  });

  it("builds a stone gate, and it stays walkable once standing", () => {
    const sim = peopledSim();
    spawnItem(sim, ItemType.Block, 6, 8);
    applyCommands(sim, [{ kind: "placeGate", tiles: [at(sim, 8, 8)], material: "stone" }]);
    expect(sim.wallMap[at(sim, 8, 8)]).toBe(WallState.StoneGateBp);
    for (let t = 0; t < 600 && sim.wallMap[at(sim, 8, 8)] !== WallState.StoneGate; t++) advanceTick(sim);
    expect(sim.wallMap[at(sim, 8, 8)]).toBe(WallState.StoneGate);
    expect(isWalkable(sim.wallMap[at(sim, 8, 8)])).toBe(true);
  });

  it("gives a block back when it comes down", () => {
    const sim = peopledSim();
    sim.wallMap[at(sim, 8, 8)] = WallState.Stone;
    applyCommands(sim, [{ kind: "designateRaze", tiles: [at(sim, 8, 8)] }]);
    for (let t = 0; t < 300 && sim.wallMap[at(sim, 8, 8)] !== WallState.None; t++) advanceTick(sim);
    // A segment refunds its own material, whatever the tool that ordered it —
    // razing needs no material of its own.
    expect(sim.items).toHaveLength(1);
    expect(sim.items[0].type).toBe(ItemType.Block);
    expect(sim.items[0].loc).toBe(Loc.Ground);
    expect([sim.items[0].x, sim.items[0].y]).toEqual([8, 8]);
  });
});

describe("the expansion loop, end to end", () => {
  /**
   * CONCEPT's loop, which is what the whole tier exists for: a palisade ring
   * claims the ground, a stone ring goes up *behind* it, and the old timber
   * line comes down — leaving a permanent wall around a colony that was never
   * open to the wilds for a moment.
   *
   * The number that has to hold is the enclosed count: it **dips** as the strip
   * between the two lines is given up, and it never collapses to zero, because
   * at no point is there a gap in both rings at once.
   */
  it("raises stone behind a palisade, razes the timber, and never breaks the ring", () => {
    const sim = peopledSim(28);
    const ring = (r: number): number[] => {
      const tiles: number[] = [];
      for (let d = 0; d <= 2 * r; d++) {
        tiles.push(at(sim, 10 - r + d, 10 - r), at(sim, 10 - r + d, 10 + r));
        tiles.push(at(sim, 10 - r, 10 - r + d), at(sim, 10 + r, 10 - r + d));
      }
      return [...new Set(tiles)];
    };
    const enclosed = (): number => [...sim.insideMap].reduce((n, v) => n + v, 0);

    // **Both rings get a gate, in the middle of an edge**, and neither point
    // is decoration. A ring with no way through traps whoever is inside it,
    // and a trapped colonist keeps claiming and failing the very build task
    // the free ones could do — the claim-cooldown starvation
    // `2026-09-01-tick-and-labour` records. And the gate cannot sit on a
    // *corner*: movement is 4-neighbour, so a corner tile's only inward
    // neighbours are the two wall runs meeting there, and a corner gate
    // therefore encloses without connecting anything. (Which is a property of
    // the grid, not of this tier — worth knowing before drawing one in the
    // hand.)
    const gateOf = (r: number): number => at(sim, 10, 10 - r);
    const timber = ring(3);
    const stone = ring(5);
    const timberGate = gateOf(3);
    const stoneGate = gateOf(5);

    // Materials for both rings, well clear of either line.
    for (let i = 0; i < 40; i++) spawnItem(sim, ItemType.Log, 2 + (i % 5), 20 + Math.floor(i / 5));
    applyCommands(sim, [
      { kind: "placeWall", tiles: timber.filter((i) => i !== timberGate), material: "timber" },
      { kind: "placeGate", tiles: [timberGate], material: "timber" },
    ]);
    for (let t = 0; t < 4000 && sim.wallMap.some((v) => isBlueprint(v)); t++) advanceTick(sim);
    const claimed = enclosed();
    expect(claimed).toBe(5 * 5);

    // The stone line goes up *outside* the timber one — the palisade claims,
    // the stone holds, and the old line only comes down once it is standing.
    for (let i = 0; i < 40; i++) spawnItem(sim, ItemType.Block, 2 + (i % 5), 24 + Math.floor(i / 5));
    applyCommands(sim, [
      { kind: "placeWall", tiles: stone.filter((i) => i !== stoneGate), material: "stone" },
      { kind: "placeGate", tiles: [stoneGate], material: "stone" },
    ]);
    let lowest = claimed;
    for (let t = 0; t < 8000 && sim.wallMap.some((v) => isBlueprint(v)); t++) {
      advanceTick(sim);
      lowest = Math.min(lowest, enclosed());
    }
    expect(stone.filter((i) => !isBuilt(sim.wallMap[i]))).toEqual([]);
    expect(sim.wallMap[stoneGate]).toBe(WallState.StoneGate);

    // Now the old line: mark the whole palisade and let it come down.
    applyCommands(sim, [{ kind: "designateRaze", tiles: timber }]);
    for (let t = 0; t < 8000 && sim.razeMap.some((v) => v); t++) {
      advanceTick(sim);
      lowest = Math.min(lowest, enclosed());
    }
    expect(timber.every((i) => sim.wallMap[i] === WallState.None)).toBe(true);
    expect([...sim.wallMap].every((v) => v === WallState.None || wallMaterial(v) === "stone")).toBe(true);

    // The count dipped while the strip between the lines was still wall
    // ground, and it never collapsed: at no moment was there a gap in both
    // rings at once, which is pillar 1 holding through an expansion.
    expect(lowest).toBeGreaterThan(0);
    expect(lowest).toBeLessThan(9 * 9);
    expect(enclosed()).toBe(9 * 9);
  });
});
