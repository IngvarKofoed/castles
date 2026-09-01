import { describe, expect, it } from "vitest";
import { adjacentToBuilding, escapePath, findPath, occupancy, passable, reachTile } from "./path";
import { BuildingState, type Sim } from "./store";
import { Terrain, tileIndex } from "./world/world";

/** A tiny flat world with nothing on it, so each test blocks exactly what it means to. */
function flatSim(size = 12, height = 4): Sim {
  const n = size * size;
  return {
    world: {
      size,
      seed: 1,
      hmap: new Uint8Array(n).fill(height),
      tmap: new Uint8Array(n).fill(Terrain.Grass),
      treeMap: new Uint8Array(n),
      chunkVersion: new Uint32Array(1).fill(1),
    },
    tick: 0,
    rngState: 1,
    nextId: 1,
    colonists: [],
    items: [],
    buildings: [],
    tasks: [],
    chopMap: new Uint8Array(n),
  };
}

const at = (sim: Sim, x: number, y: number): number => tileIndex(x, y, sim.world.size);

describe("passability", () => {
  it("refuses water, trees and building footprints", () => {
    const sim = flatSim();
    sim.world.tmap[at(sim, 1, 1)] = Terrain.Water;
    sim.world.treeMap[at(sim, 2, 1)] = 1;
    sim.buildings.push({
      id: 1,
      kind: 0,
      x: 3,
      y: 1,
      w: 2,
      h: 2,
      state: BuildingState.Active,
      progress: 0,
      reservedIncoming: 0,
      acceptLog: 1,
      acceptPlank: 1,
      worker: -1,
      millProgress: -1,
    });
    const occ = occupancy(sim);
    expect(passable(sim.world, occ, 0, 0)).toBe(true);
    expect(passable(sim.world, occ, 1, 1)).toBe(false);
    expect(passable(sim.world, occ, 2, 1)).toBe(false);
    expect(passable(sim.world, occ, 3, 1)).toBe(false);
    expect(passable(sim.world, occ, 4, 2)).toBe(false);
    expect(passable(sim.world, occ, 5, 1)).toBe(true);
    expect(passable(sim.world, occ, -1, 0)).toBe(false);
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
    sim.buildings.push({
      id: 1,
      kind: 0,
      ...b,
      state: BuildingState.Active,
      progress: 0,
      reservedIncoming: 0,
      acceptLog: 1,
      acceptPlank: 1,
      worker: -1,
      millProgress: -1,
    });
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
    sim.buildings.push({
      id: 1,
      kind: 0,
      x: 4,
      y: 4,
      w: 2,
      h: 2,
      state: BuildingState.Blueprint,
      progress: 0,
      reservedIncoming: 0,
      acceptLog: 1,
      acceptPlank: 1,
      worker: -1,
      millProgress: -1,
    });
    const occ = occupancy(sim);
    const out = escapePath(sim, occ, 4, 4);
    expect(out).not.toBeNull();
    expect(out!.length).toBe(1);
    expect(passable(sim.world, occ, out![0] % sim.world.size, Math.floor(out![0] / sim.world.size))).toBe(true);
  });

  it("stays put when the tile is already free", () => {
    const sim = flatSim();
    expect(escapePath(sim, occupancy(sim), 4, 4)).toEqual([]);
  });
});
