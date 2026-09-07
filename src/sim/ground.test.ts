import { describe, expect, it } from "vitest";
import { applyCommands } from "./commands";
import { canMine, canTerraform, erodesTo } from "./ground";
import { spawnItem } from "./items";
import { generateTasks } from "./labour/tasks";
import { ItemType, TaskKind, createSim, type Sim } from "./store";
import { flatSim, testBuilding } from "./test-sim";
import { advanceTick } from "./tick";
import { MINE_ROCK } from "./tuning";
import { WallState } from "./walls";
import { Terrain, tileIndex } from "./world/world";

/**
 * Quarrying and levelling: the two jobs that change the ground itself.
 *
 * Both are worked on hand-built worlds rather than on a generated map, because
 * what has to be pinned is the height arithmetic and the eligibility rules —
 * and a generated island puts its nearest outcrop fifty tiles from the colony,
 * which makes for a slow test that proves less.
 */

const at = (sim: Sim, x: number, y: number): number => tileIndex(x, y, sim.world.size);

/** A flat world with folk in it, so the labour loop actually runs. */
function peopledSim(size = 20, height = 4): Sim {
  const sim = flatSim(size, height);
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
      path: [],
      step: 0,
    });
  }
  return sim;
}

/** Raise a tile into a rock outcrop, the way generation would. */
function outcrop(sim: Sim, x: number, y: number, height = 7): void {
  const i = at(sim, x, y);
  sim.world.hmap[i] = height;
  sim.world.tmap[i] = Terrain.Rock;
}

describe("what can be quarried", () => {
  it("takes rock with somewhere to stand, and nothing else", () => {
    const sim = flatSim(16);
    outcrop(sim, 5, 5);
    expect(canMine(sim, 5, 5)).toBe(true);
    // Grass, sand and water are not outcrops.
    expect(canMine(sim, 6, 5)).toBe(false);
    expect(canMine(sim, -1, 5)).toBe(false);
    expect(canMine(sim, 16, 5)).toBe(false);
  });

  it("refuses a sea stack, because nobody could ever work it", () => {
    // Rock with only water around it: no stand tile, and nowhere for its own
    // rubble to land. Refused at designation rather than left as a task that
    // retries on a cooldown for the rest of the game.
    const sim = flatSim(16);
    outcrop(sim, 8, 8);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      sim.world.tmap[at(sim, 8 + dx, 8 + dy)] = Terrain.Water;
      sim.world.hmap[at(sim, 8 + dx, 8 + dy)] = 1;
    }
    expect(canMine(sim, 8, 8)).toBe(false);

    // One land neighbour is enough.
    sim.world.tmap[at(sim, 9, 8)] = Terrain.Grass;
    sim.world.hmap[at(sim, 9, 8)] = 4;
    expect(canMine(sim, 8, 8)).toBe(true);
  });

  it("erodes to the lowest land neighbour, clamped to the workable band", () => {
    const sim = flatSim(16, 5);
    outcrop(sim, 5, 5);
    sim.world.hmap[at(sim, 4, 5)] = 3;
    sim.world.hmap[at(sim, 6, 5)] = 5;
    expect(erodesTo(sim, 5, 5)).toBe(3);

    // Water is not land, so a coastal outcrop takes its height from the ground.
    sim.world.tmap[at(sim, 4, 5)] = Terrain.Water;
    sim.world.hmap[at(sim, 4, 5)] = 1;
    expect(erodesTo(sim, 5, 5)).toBe(5);

    // The clamp is what guarantees worked ground never re-derives to rock: an
    // outcrop ringed by outcrops comes down to 6, never back to 7.
    const ringed = flatSim(16, 7);
    for (let y = 4; y <= 6; y++) for (let x = 4; x <= 6; x++) outcrop(ringed, x, y);
    expect(erodesTo(ringed, 5, 5)).toBe(6);
  });
});

describe("quarrying an outcrop", () => {
  it("cuts it from below, drops rock, and leaves buildable ground", () => {
    const sim = peopledSim();
    outcrop(sim, 8, 8);
    const i = at(sim, 8, 8);
    applyCommands(sim, [{ kind: "designateMine", tiles: [i] }]);
    expect(sim.mineMap[i]).toBe(1);

    for (let t = 0; t < 300 && sim.world.tmap[i] === Terrain.Rock; t++) {
      advanceTick(sim);
      // The work is done from a neighbouring tile: an outcrop is a cliff, and
      // nobody stands on the thing they are cutting out from under themselves.
      for (const c of sim.colonists) expect([Math.floor(c.x), Math.floor(c.y)]).not.toEqual([8, 8]);
    }

    // Stone, and a flat build site — the second reward is the point.
    expect(sim.world.hmap[i]).toBe(4);
    expect(sim.world.tmap[i]).toBe(Terrain.Grass);
    expect(sim.items.filter((it) => it.type === ItemType.Rock)).toHaveLength(MINE_ROCK);
    expect(sim.mineMap[i]).toBe(0);
    expect(canMine(sim, 8, 8)).toBe(false);
  });

  it("re-derives sand where it comes down to the waterline", () => {
    // A world flat at the sand line, so the outcrop erodes to 2 rather than to
    // grass — the ground it leaves is derived, never assumed.
    const sim = peopledSim(20, 2);
    outcrop(sim, 8, 8);
    applyCommands(sim, [{ kind: "designateMine", tiles: [at(sim, 8, 8)] }]);
    for (let t = 0; t < 300 && sim.world.tmap[at(sim, 8, 8)] === Terrain.Rock; t++) advanceTick(sim);
    expect(sim.world.hmap[at(sim, 8, 8)]).toBe(2);
    expect(sim.world.tmap[at(sim, 8, 8)]).toBe(Terrain.Sand);
  });

  it("only marks rock, and a second click takes the mark back", () => {
    const sim = peopledSim();
    outcrop(sim, 8, 8);
    applyCommands(sim, [{ kind: "designateMine", tiles: [at(sim, 8, 8), at(sim, 9, 9), -1, 99999] }]);
    expect(sim.mineMap[at(sim, 8, 8)]).toBe(1);
    expect(sim.mineMap[at(sim, 9, 9)]).toBe(0);

    generateTasks(sim);
    expect(sim.tasks.filter((t) => t.kind === TaskKind.Mine)).toHaveLength(1);
    applyCommands(sim, [{ kind: "cancelMine", x: 8, y: 8 }]);
    expect(sim.mineMap[at(sim, 8, 8)]).toBe(0);
    expect(sim.tasks.filter((t) => t.kind === TaskKind.Mine)).toHaveLength(0);
    expect(sim.world.tmap[at(sim, 8, 8)]).toBe(Terrain.Rock);
  });

  it("bumps the chunk version when an outcrop is marked, because the face is baked", () => {
    // A marked outcrop's top face bakes gold-shifted, so marking one is a
    // geometry change — the same rule a designated tree's canopy follows.
    const sim = createSim(20260901);
    const size = sim.world.size;
    const c = Math.floor(size / 2);
    outcrop(sim, c, c);
    const chunk = Math.floor(c / 16) * (size / 16) + Math.floor(c / 16);

    const before = sim.world.chunkVersion[chunk];
    applyCommands(sim, [{ kind: "designateMine", tiles: [c * size + c] }]);
    expect(sim.world.chunkVersion[chunk]).toBeGreaterThan(before);
    const marked = sim.world.chunkVersion[chunk];
    applyCommands(sim, [{ kind: "cancelMine", x: c, y: c }]);
    expect(sim.world.chunkVersion[chunk]).toBeGreaterThan(marked);
  });

  it("clears a mark left on a tile that stopped being rock", () => {
    const sim = peopledSim();
    outcrop(sim, 8, 8);
    applyCommands(sim, [{ kind: "designateMine", tiles: [at(sim, 8, 8)] }]);
    sim.world.tmap[at(sim, 8, 8)] = Terrain.Grass;
    generateTasks(sim);
    expect(sim.mineMap[at(sim, 8, 8)]).toBe(0);
    expect(sim.tasks.filter((t) => t.kind === TaskKind.Mine)).toHaveLength(0);
  });
});

describe("what can be levelled", () => {
  it("takes grass and sand, and never rock or water", () => {
    const sim = flatSim(16);
    expect(canTerraform(sim, 5, 5)).toBe(true);
    sim.world.tmap[at(sim, 6, 5)] = Terrain.Sand;
    expect(canTerraform(sim, 6, 5)).toBe(true);

    // Rock is mining's job and nothing else's: a careless marquee across an
    // outcrop must not demolish the colony's finite stone for zero yield.
    outcrop(sim, 7, 5);
    expect(canTerraform(sim, 7, 5)).toBe(false);
    sim.world.tmap[at(sim, 8, 5)] = Terrain.Water;
    expect(canTerraform(sim, 8, 5)).toBe(false);
  });

  it("refuses ground that is holding something up", () => {
    const sim = flatSim(16);
    sim.world.treeMap[at(sim, 5, 5)] = 1;
    sim.wallMap[at(sim, 6, 5)] = WallState.Stone;
    sim.wallMap[at(sim, 7, 5)] = WallState.PalisadeBp;
    sim.buildings.push(testBuilding({ x: 9, y: 5 }));
    spawnItem(sim, ItemType.Log, 12, 5);

    for (const x of [5, 6, 7, 9, 12]) expect(canTerraform(sim, x, 5)).toBe(false);
  });

  it("refuses ground already outside the workable band", () => {
    const sim = flatSim(16, 7);
    expect(canTerraform(sim, 5, 5)).toBe(false);
  });
});

describe("levelling ground", () => {
  it("works a tile one step at a time until it reaches the target", () => {
    const sim = peopledSim();
    const i = at(sim, 8, 8);
    sim.world.hmap[i] = 6;
    applyCommands(sim, [{ kind: "designateTerraform", tiles: [i], target: 4 }]);
    // Stored as target-plus-one, because 0 has to mean "no designation".
    expect(sim.terraformMap[i]).toBe(5);

    const heights: number[] = [];
    for (let t = 0; t < 400 && sim.terraformMap[i]; t++) {
      advanceTick(sim);
      if (heights[heights.length - 1] !== sim.world.hmap[i]) heights.push(sim.world.hmap[i]);
    }
    // Two steps down, one block at a time — never a jump.
    expect(heights).toEqual([6, 5, 4]);
    expect(sim.world.hmap[i]).toBe(4);
    expect(sim.terraformMap[i]).toBe(0);
    expect(sim.tasks.filter((t) => t.kind === TaskKind.Terraform)).toHaveLength(0);
    // Labour only: nothing was spent and nothing was produced.
    expect(sim.items).toHaveLength(0);
  });

  it("raises as well as lowers, and re-derives terrain on the way", () => {
    const sim = peopledSim();
    const i = at(sim, 8, 8);
    sim.world.hmap[i] = 2;
    sim.world.tmap[i] = Terrain.Sand;
    applyCommands(sim, [{ kind: "designateTerraform", tiles: [i], target: 4 }]);
    for (let t = 0; t < 400 && sim.terraformMap[i]; t++) advanceTick(sim);
    expect(sim.world.hmap[i]).toBe(4);
    expect(sim.world.tmap[i]).toBe(Terrain.Grass);
  });

  it("skips the tiles of an area it cannot level, and takes the rest", () => {
    const sim = peopledSim();
    sim.world.hmap[at(sim, 8, 8)] = 5;
    sim.world.hmap[at(sim, 9, 8)] = 5;
    outcrop(sim, 10, 8);
    applyCommands(sim, [
      { kind: "designateTerraform", tiles: [at(sim, 8, 8), at(sim, 9, 8), at(sim, 10, 8)], target: 4 },
    ]);
    expect(sim.terraformMap[at(sim, 8, 8)]).toBe(5);
    expect(sim.terraformMap[at(sim, 9, 8)]).toBe(5);
    expect(sim.terraformMap[at(sim, 10, 8)]).toBe(0);
  });

  it("refuses a target outside the band, and tiles already at it", () => {
    const sim = peopledSim();
    applyCommands(sim, [{ kind: "designateTerraform", tiles: [at(sim, 8, 8)], target: 9 }]);
    expect(sim.terraformMap[at(sim, 8, 8)]).toBe(0);
    // The world is flat at 4, so asking for 4 is asking for nothing.
    applyCommands(sim, [{ kind: "designateTerraform", tiles: [at(sim, 8, 8)], target: 4 }]);
    expect(sim.terraformMap[at(sim, 8, 8)]).toBe(0);
  });

  it("overwrites a stored target when the area is dragged again", () => {
    // A mis-pressed area is fixed by re-dragging, not by clearing tiles one at
    // a time — so the second drag wins, and the task working the old figure
    // goes with it.
    const sim = peopledSim();
    const i = at(sim, 8, 8);
    sim.world.hmap[i] = 6;
    applyCommands(sim, [{ kind: "designateTerraform", tiles: [i], target: 2 }]);
    generateTasks(sim);
    const first = sim.tasks.find((t) => t.kind === TaskKind.Terraform);
    expect(first).toBeDefined();

    applyCommands(sim, [{ kind: "designateTerraform", tiles: [i], target: 5 }]);
    expect(sim.terraformMap[i]).toBe(6);
    expect(sim.tasks.some((t) => t.id === first?.id)).toBe(false);

    for (let t = 0; t < 400 && sim.terraformMap[i]; t++) advanceTick(sim);
    expect(sim.world.hmap[i]).toBe(5);
  });

  it("a click on a designated tile clears it, and stops the work", () => {
    const sim = peopledSim();
    const i = at(sim, 8, 8);
    sim.world.hmap[i] = 6;
    applyCommands(sim, [{ kind: "designateTerraform", tiles: [i], target: 4 }]);
    generateTasks(sim);
    expect(sim.tasks.filter((t) => t.kind === TaskKind.Terraform)).toHaveLength(1);

    applyCommands(sim, [{ kind: "cancelTerraform", x: 8, y: 8 }]);
    expect(sim.terraformMap[i]).toBe(0);
    expect(sim.tasks.filter((t) => t.kind === TaskKind.Terraform)).toHaveLength(0);
    expect(sim.world.hmap[i]).toBe(6);
  });

  it("cancels itself when a wall goes up across the area", () => {
    const sim = peopledSim();
    const i = at(sim, 8, 8);
    sim.world.hmap[i] = 6;
    applyCommands(sim, [{ kind: "designateTerraform", tiles: [i], target: 4 }]);
    for (let t = 0; t < 20; t++) advanceTick(sim);
    sim.wallMap[i] = WallState.Stone;
    for (let t = 0; t < 40; t++) advanceTick(sim);
    expect(sim.terraformMap[i]).toBe(0);
    expect(sim.tasks.filter((t) => t.kind === TaskKind.Terraform)).toHaveLength(0);
    expect(sim.world.hmap[i]).toBe(6);
  });

  it("steps a bystander off the tile before the ground moves under them", () => {
    // A tile lowered under an idle colonist can leave them in a pit no path
    // leads out of, so the ground never moves while somebody is standing on it.
    const sim = peopledSim();
    const i = at(sim, 8, 8);
    // A knoll a colonist can actually get on to: 4 → 5 → 6 is two stairs.
    sim.world.hmap[i] = 6;
    for (const [x, y] of [[7, 8], [9, 8], [8, 7], [8, 9]]) sim.world.hmap[at(sim, x, y)] = 5;
    const bystander = sim.colonists[2];
    bystander.x = 8.5;
    bystander.y = 8.5;
    bystander.px = 8.5;
    bystander.py = 8.5;

    applyCommands(sim, [{ kind: "designateTerraform", tiles: [i], target: 2 }]);
    // The first height step is what starts them walking; they are clear before
    // the second one lands, which is what keeps them out of the pit the four
    // steps dig. (The eviction sets a route, and routes are walked on the
    // following tick — so "off it" is a tick or two later, not instant.)
    let cleared = -1;
    for (let t = 0; t < 400 && sim.terraformMap[i]; t++) {
      advanceTick(sim);
      const on = Math.floor(bystander.x) === 8 && Math.floor(bystander.y) === 8;
      if (!on && cleared < 0) cleared = sim.world.hmap[i];
      if (cleared >= 0) expect(on).toBe(false);
    }
    // Cleared while the knoll was still climbable, not after it had become a pit.
    expect(cleared).toBeGreaterThanOrEqual(4);
    expect(sim.world.hmap[i]).toBe(2);

    // And not stranded: wherever they ended up is a tile they can walk off.
    const escape = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ].some(([dx, dy]) => {
      const here = sim.world.hmap[at(sim, Math.floor(bystander.x), Math.floor(bystander.y))];
      const there = sim.world.hmap[at(sim, Math.floor(bystander.x) + dx, Math.floor(bystander.y) + dy)];
      return Math.abs(here - there) <= 1;
    });
    expect(escape).toBe(true);
  });

  it("keeps going when something is dropped on the tile mid-job", () => {
    // Items on a levelled tile ride the height change: they store only x and
    // y. Re-asking the *designation* test at every step made an arriving item
    // cancel the rest of the job — which the sim did to itself, since stepping
    // a carrying bystander off the tile drops their cargo on to it.
    const sim = peopledSim();
    const i = at(sim, 8, 8);
    sim.world.hmap[i] = 6;
    applyCommands(sim, [{ kind: "designateTerraform", tiles: [i], target: 2 }]);
    for (let t = 0; t < 130; t++) advanceTick(sim);
    expect(sim.world.hmap[i]).toBeLessThan(6);
    expect(sim.terraformMap[i]).toBe(3);

    const dropped = spawnItem(sim, ItemType.Log, 8, 8);
    expect([dropped?.x, dropped?.y]).toEqual([8, 8]);
    for (let t = 0; t < 400 && sim.terraformMap[i]; t++) advanceTick(sim);
    expect(sim.world.hmap[i]).toBe(2);
    expect(sim.terraformMap[i]).toBe(0);
  });

  it("never strands the bystander it stepped aside, even off a shelf", () => {
    // Every legal neighbour exactly one block up: lowering the tile the instant
    // the route is handed out turns all four into cliffs and the colonist is in
    // a pit for good. The ground has to wait for the tile to actually clear.
    const sim = peopledSim();
    const i = at(sim, 8, 8);
    for (const [x, y] of [[7, 8], [9, 8], [8, 7], [8, 9]]) sim.world.hmap[at(sim, x, y)] = 5;
    const bystander = sim.colonists[2];
    bystander.x = 8.5;
    bystander.y = 8.5;
    bystander.px = 8.5;
    bystander.py = 8.5;

    applyCommands(sim, [{ kind: "designateTerraform", tiles: [i], target: 2 }]);
    for (let t = 0; t < 600 && sim.terraformMap[i]; t++) advanceTick(sim);
    expect(sim.world.hmap[i]).toBe(2);
    expect(Math.floor(bystander.x) === 8 && Math.floor(bystander.y) === 8).toBe(false);
    const here = sim.world.hmap[at(sim, Math.floor(bystander.x), Math.floor(bystander.y))];
    expect(here).toBe(5);
  });
});

describe("a cliff forming across a planned route", () => {
  it("re-plans instead of climbing it", () => {
    // The walker's per-step gate checks the height rule as well as
    // passability: a route is planned once, and levelling can raise a cliff
    // across it while somebody is already walking. Without the check they walk
    // up a four-block wall of earth.
    const sim = flatSim(12);
    const c = peopledSim(12).colonists[0];
    c.x = 2.5;
    c.y = 5.5;
    c.px = c.x;
    c.py = c.y;
    c.path = [];
    for (let x = 3; x <= 10; x++) c.path.push(at(sim, x, 5));
    sim.colonists.push(c);

    // A ridge two blocks up across row 5, with a way round at y = 4.
    for (let y = 5; y < 12; y++) sim.world.hmap[at(sim, 6, y)] = 6;

    let climbed = false;
    for (let t = 0; t < 80; t++) {
      advanceTick(sim);
      if (sim.world.hmap[at(sim, Math.floor(c.x), Math.floor(c.y))] === 6) climbed = true;
      if (Math.floor(c.x) === 10 && Math.floor(c.y) === 5) break;
    }
    expect(climbed).toBe(false);
    expect([Math.floor(c.x), Math.floor(c.y)]).toEqual([10, 5]);
  });
});
