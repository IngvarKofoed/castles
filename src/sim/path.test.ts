import { describe, expect, it } from "vitest";
import { adjacentToBuilding, escapePath, findPath, occupancy, passable, reachTile } from "./path";
import { BuildingState, type Sim } from "./store";
import { flatSim, testBuilding } from "./test-sim";
import { WallState } from "./walls";
import { Terrain, tileIndex } from "./world/world";

const at = (sim: Sim, x: number, y: number): number => tileIndex(x, y, sim.world.size);

/** `passable`, with this sim's layers — the shape every call site uses. */
const walkable = (sim: Sim, x: number, y: number): boolean =>
  passable(sim.world, sim.wallMap, occupancy(sim), x, y);

describe("passability", () => {
  it("refuses water, trees and building footprints", () => {
    const sim = flatSim();
    sim.world.tmap[at(sim, 1, 1)] = Terrain.Water;
    sim.world.treeMap[at(sim, 2, 1)] = 1;
    sim.buildings.push(testBuilding({ id: 1, x: 3, y: 1 }));
    expect(walkable(sim, 0, 0)).toBe(true);
    expect(walkable(sim, 1, 1)).toBe(false);
    expect(walkable(sim, 2, 1)).toBe(false);
    expect(walkable(sim, 3, 1)).toBe(false);
    expect(walkable(sim, 4, 2)).toBe(false);
    expect(walkable(sim, 5, 1)).toBe(true);
    expect(walkable(sim, -1, 0)).toBe(false);
  });

  it("refuses a raised palisade but lets folk through a gate or a blueprint", () => {
    // The table `passable` states once: only a standing palisade stops anyone.
    // A gate being walkable while the enclosure fill treats it as wall is the
    // whole point of gates (docs/CONCEPT.md).
    const sim = flatSim();
    sim.wallMap[at(sim, 6, 6)] = WallState.Palisade;
    sim.wallMap[at(sim, 6, 7)] = WallState.Gate;
    sim.wallMap[at(sim, 6, 8)] = WallState.PalisadeBp;
    sim.wallMap[at(sim, 6, 9)] = WallState.GateBp;
    expect(walkable(sim, 6, 6)).toBe(false);
    expect(walkable(sim, 6, 7)).toBe(true);
    expect(walkable(sim, 6, 8)).toBe(true);
    expect(walkable(sim, 6, 9)).toBe(true);
  });

  it("routes through a gate rather than around the wall it sits in", () => {
    const sim = flatSim();
    for (let y = 0; y < sim.world.size; y++) sim.wallMap[at(sim, 6, y)] = WallState.Palisade;
    expect(findPath(sim, occupancy(sim), 2, 5, new Set([at(sim, 9, 5)]))).toBeNull();

    sim.wallMap[at(sim, 6, 5)] = WallState.Gate;
    const path = findPath(sim, occupancy(sim), 2, 5, new Set([at(sim, 9, 5)]));
    expect(path).not.toBeNull();
    expect(path).toContain(at(sim, 6, 5));
  });

  it("climbs a one-block step but not a two-block cliff", () => {
    const sim = flatSim();
    for (let y = 0; y < sim.world.size; y++) sim.world.hmap[at(sim, 5, y)] = 5;
    const occ = occupancy(sim);
    expect(findPath(sim, occ, 0, 0, new Set([at(sim, 8, 0)]))).not.toBeNull();

    for (let y = 0; y < sim.world.size; y++) sim.world.hmap[at(sim, 5, y)] = 6;
    expect(findPath(sim, occ, 0, 0, new Set([at(sim, 8, 0)]))).toBeNull();
  });
});

describe("findPath", () => {
  it("returns the shortest 4-neighbour route, start excluded", () => {
    const sim = flatSim();
    const path = findPath(sim, occupancy(sim), 0, 0, new Set([at(sim, 3, 0)]));
    expect(path).toEqual([at(sim, 1, 0), at(sim, 2, 0), at(sim, 3, 0)]);
  });

  it("returns an empty route when the start is already a goal", () => {
    const sim = flatSim();
    expect(findPath(sim, occupancy(sim), 2, 2, new Set([at(sim, 2, 2)]))).toEqual([]);
  });

  it("routes around an obstacle rather than through it", () => {
    const sim = flatSim();
    for (let y = 0; y < 5; y++) sim.world.treeMap[at(sim, 2, y)] = 1;
    const path = findPath(sim, occupancy(sim), 0, 0, new Set([at(sim, 4, 0)]));
    expect(path).not.toBeNull();
    for (const tile of path!) expect(sim.world.treeMap[tile]).toBe(0);
  });

  it("gives up on a walled-off goal", () => {
    const sim = flatSim();
    for (let y = 0; y < sim.world.size; y++) sim.world.treeMap[at(sim, 6, y)] = 1;
    expect(findPath(sim, occupancy(sim), 0, 0, new Set([at(sim, 8, 0)]))).toBeNull();
  });

  it("is deterministic — the same query gives the identical route", () => {
    const sim = flatSim(20);
    const goals = new Set([at(sim, 15, 15)]);
    const a = findPath(sim, occupancy(sim), 1, 1, goals);
    const b = findPath(sim, occupancy(sim), 1, 1, goals);
    expect(a).toEqual(b);
  });
});

describe("reaching things", () => {
  it("targets an impassable tile by its neighbours", () => {
    const sim = flatSim();
    sim.world.treeMap[at(sim, 4, 4)] = 1;
    const goals = reachTile(sim, occupancy(sim), 4, 4);
    expect(goals.has(at(sim, 4, 4))).toBe(false);
    expect(goals).toEqual(new Set([at(sim, 4, 3), at(sim, 3, 4), at(sim, 5, 4), at(sim, 4, 5)]));
  });

  it("rings a footprint without including it", () => {
    const sim = flatSim();
    const b = { x: 4, y: 4, w: 2, h: 2 };
    sim.buildings.push(testBuilding({ id: 1, ...b }));
    const goals = adjacentToBuilding(sim, occupancy(sim), b);
    expect(goals.size).toBe(8);
    expect(goals.has(at(sim, 4, 4))).toBe(false);
    expect(goals.has(at(sim, 4, 3))).toBe(true);
    expect(goals.has(at(sim, 3, 3))).toBe(false); // diagonals are not neighbours
  });
});

describe("escapePath", () => {
  it("walks someone out of a footprint dropped on top of them", () => {
    const sim = flatSim();
    sim.buildings.push(testBuilding({ id: 1, x: 4, y: 4, state: BuildingState.Blueprint }));
    const out = escapePath(sim, occupancy(sim), 4, 4);
    expect(out).not.toBeNull();
    expect(out!.length).toBe(1);
    expect(walkable(sim, out![0] % sim.world.size, Math.floor(out![0] / sim.world.size))).toBe(true);
  });

  it("stays put when the tile is already free", () => {
    const sim = flatSim();
    expect(escapePath(sim, occupancy(sim), 4, 4)).toEqual([]);
  });
});
