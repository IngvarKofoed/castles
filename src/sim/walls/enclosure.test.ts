import { describe, expect, it } from "vitest";
import { readout } from "../know";
import { flatSim } from "../test-sim";
import type { Sim } from "../store";
import { Terrain, tileIndex } from "../world/world";
import { WallState } from "./index";
import { enclosedLand, recomputeEnclosure, settleEnclosure } from "./enclosure";

/**
 * The enclosure semantics, pinned. Everything that will hang off "is this
 * ground safe?" — threats, buildable ground, the gap-in-the-wall failure —
 * reads `insideMap`, so these are the assertions that keep it honest.
 */

const at = (sim: Sim, x: number, y: number): number => tileIndex(x, y, sim.world.size);
const inside = (sim: Sim, x: number, y: number): number => sim.insideMap[at(sim, x, y)];

/** A closed square of wall, corners included, from (x0, y0) to (x1, y1). */
function ring(sim: Sim, x0: number, y0: number, x1: number, y1: number, state: number): void {
  for (let x = x0; x <= x1; x++) {
    sim.wallMap[at(sim, x, y0)] = state;
    sim.wallMap[at(sim, x, y1)] = state;
  }
  for (let y = y0; y <= y1; y++) {
    sim.wallMap[at(sim, x0, y)] = state;
    sim.wallMap[at(sim, x1, y)] = state;
  }
}

describe("the enclosure flood-fill", () => {
  it("encloses the interior of a closed ring, and nothing outside it", () => {
    const sim = flatSim(12);
    ring(sim, 3, 3, 8, 8, WallState.Palisade);
    recomputeEnclosure(sim);

    for (let y = 4; y <= 7; y++) for (let x = 4; x <= 7; x++) expect(inside(sim, x, y)).toBe(1);
    expect(inside(sim, 0, 0)).toBe(0);
    expect(inside(sim, 9, 9)).toBe(0);
    // The wall's own tiles are not enclosed ground: they are not buildable,
    // which is exactly what the readout is counting.
    expect(inside(sim, 3, 3)).toBe(0);
    expect(inside(sim, 5, 3)).toBe(0);
    expect(enclosedLand(sim)).toBe(16);
  });

  it("leaks through a one-tile gap", () => {
    const sim = flatSim(12);
    ring(sim, 3, 3, 8, 8, WallState.Palisade);
    sim.wallMap[at(sim, 5, 3)] = WallState.None;
    recomputeEnclosure(sim);
    expect(inside(sim, 5, 5)).toBe(0);
    expect(enclosedLand(sim)).toBe(0);
  });

  it("still encloses when the gap is a gate — a colony with a door is closed", () => {
    const sim = flatSim(12);
    ring(sim, 3, 3, 8, 8, WallState.Palisade);
    sim.wallMap[at(sim, 5, 3)] = WallState.Gate;
    recomputeEnclosure(sim);
    expect(inside(sim, 5, 5)).toBe(1);
    expect(enclosedLand(sim)).toBe(16);
  });

  it("encloses nothing while the ring is only drawn", () => {
    const sim = flatSim(12);
    ring(sim, 3, 3, 8, 8, WallState.PalisadeBp);
    recomputeEnclosure(sim);
    expect(inside(sim, 5, 5)).toBe(0);
    expect(enclosedLand(sim)).toBe(0);
  });

  it("reopens the moment a segment is razed", () => {
    const sim = flatSim(12);
    ring(sim, 3, 3, 8, 8, WallState.Palisade);
    recomputeEnclosure(sim);
    expect(enclosedLand(sim)).toBe(16);

    sim.wallMap[at(sim, 8, 6)] = WallState.None;
    recomputeEnclosure(sim);
    expect(enclosedLand(sim)).toBe(0);
  });

  it("counts an enclosed pond as inside but leaves it out of the readout", () => {
    const sim = flatSim(12);
    ring(sim, 3, 3, 8, 8, WallState.Palisade);
    sim.world.tmap[at(sim, 5, 5)] = Terrain.Water;
    sim.world.tmap[at(sim, 6, 5)] = Terrain.Water;
    recomputeEnclosure(sim);
    // Water does not block the fill and is not safety — the wall is the only
    // safety technology — so the pond is inside; it just is not ground.
    expect(inside(sim, 5, 5)).toBe(1);
    expect(enclosedLand(sim)).toBe(14);
  });

  it("treats a wall on the map edge as a wall, not as a seed", () => {
    // A ring with two of its sides sitting *on* the border. It only encloses
    // anything if an edge tile carrying wall is skipped as a seed — seed it
    // and the fill starts inside the ring and leaks the whole thing.
    const sim = flatSim(10);
    ring(sim, 0, 0, 3, 3, WallState.Palisade);
    recomputeEnclosure(sim);
    expect(inside(sim, 1, 1)).toBe(1);
    expect(inside(sim, 2, 2)).toBe(1);
    expect(inside(sim, 5, 5)).toBe(0);
    expect(enclosedLand(sim)).toBe(4);
  });

  it("never encloses ground that touches the map edge itself", () => {
    // The corollary, and the reason the world generator floods its border with
    // water: an L of wall against the corner encloses nothing, because the
    // open edge tiles inside it are themselves seeds.
    const sim = flatSim(10);
    for (let x = 0; x <= 3; x++) sim.wallMap[at(sim, x, 3)] = WallState.Palisade;
    for (let y = 0; y <= 3; y++) sim.wallMap[at(sim, 3, y)] = WallState.Palisade;
    recomputeEnclosure(sim);
    expect(enclosedLand(sim)).toBe(0);
  });

  it("batches to one recompute per tick, and skips a quiet one", () => {
    const sim = flatSim(12);
    ring(sim, 3, 3, 8, 8, WallState.Palisade);
    // Nothing flagged the change, so a quiet settle leaves the stale layer be
    // — which is what makes the flag load-bearing rather than decorative.
    settleEnclosure(sim);
    expect(enclosedLand(sim)).toBe(0);

    sim.enclosureDirty = 1;
    settleEnclosure(sim);
    expect(enclosedLand(sim)).toBe(16);
    expect(sim.enclosureDirty).toBe(0);
  });

  it("is what the ribbon reads", () => {
    const sim = flatSim(12);
    ring(sim, 3, 3, 8, 8, WallState.Palisade);
    recomputeEnclosure(sim);
    expect(readout(sim).enclosed).toBe(16);
  });
});
