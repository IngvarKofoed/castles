import { describe, expect, it } from "vitest";
import { BuildingKind, BuildingState, type Sim } from "../sim/know";
import { flatSim, testBuilding, testMonster } from "../sim/test-sim";
import { Terrain, tileIndex } from "../sim/world/world";
import { Fauna, FaunaKind, type Herd } from "./fauna";

/** A world big enough for a deer herd's home derivation to have room in it. */
function wilds(size = 160): Sim {
  return flatSim(size);
}

function withPasture(sim: Sim, x: number, y: number): Sim {
  sim.buildings.push(
    testBuilding({
      id: 7,
      kind: BuildingKind.Pasture,
      x,
      y,
      w: 3,
      h: 3,
      state: BuildingState.Active,
    }),
  );
  return sim;
}

/** Run a herd for `seconds` of game time at 20 frames a second. */
function run(fauna: Fauna, sim: Sim, seconds: number, fx: number, fz: number): readonly Herd[] {
  let herds: readonly Herd[] = [];
  for (let i = 0; i < seconds * 20; i++) {
    herds = fauna.step(0.05, fx, fz, 80, sim.world.size / 2, sim.world.size / 2);
  }
  return herds;
}

const flock = (herds: readonly Herd[]): Herd | undefined => herds.find((h) => h.kind === FaunaKind.Sheep);
const wild = (herds: readonly Herd[]): Herd[] => herds.filter((h) => h.kind === FaunaKind.Deer);

describe("the Pasture's flock", () => {
  it("stands three sheep in an Active pasture and none in a blueprint", () => {
    const sim = withPasture(wilds(), 40, 40);
    const active = flock(new Fauna(sim).step(0, 41, 41, 80, 80, 80));
    expect(active?.creatures.length).toBe(3);

    const site = withPasture(wilds(), 40, 40);
    site.buildings[0].state = BuildingState.Blueprint;
    expect(flock(new Fauna(site).step(0, 41, 41, 80, 80, 80))).toBeUndefined();
  });

  it("never lets a sheep cross the fence, however long it wanders", () => {
    // The whole promise of the pasture is its fence, so this is the bound the
    // boundedness rule comes down to for sheep — the deer's is re-homing.
    const sim = withPasture(wilds(), 40, 40);
    const fauna = new Fauna(sim);
    // The rails run one fifth of a tile inside the plot; a sheep's own body is
    // half a tile long, so this is the fence with the animal's width taken off.
    const rail = 0.18;
    const half = 0.25;
    for (let s = 0; s < 60; s++) {
      const herd = flock(run(fauna, sim, 1, 41, 41));
      for (const c of herd!.creatures) {
        expect(c.x).toBeGreaterThan(40 + rail + half);
        expect(c.x).toBeLessThan(43 - rail - half);
        expect(c.z).toBeGreaterThan(40 + rail + half);
        expect(c.z).toBeLessThan(43 - rail - half);
      }
    }
  });

  it("keeps them clear of the shepherd's hut", () => {
    // The baked flock this replaced was placed by hand "clear of the hut's
    // corner". A wander with no such rule walks sheep through the roof, which
    // is the one way a pasture full of animals looks worse than three glued to
    // the turf.
    const sim = withPasture(wilds(), 40, 40);
    const fauna = new Fauna(sim);
    const hut = { x: 42.25, z: 42.25 };
    for (let s = 0; s < 40; s++) {
      const herd = flock(run(fauna, sim, 1, 41, 41));
      for (const c of herd!.creatures) {
        expect(Math.abs(c.x - hut.x) > 0.58 || Math.abs(c.z - hut.z) > 0.58).toBe(true);
      }
    }
  });
});

describe("the deer of the wilds", () => {
  it("derives the same herds from the same seed, with nothing stored", () => {
    const sim = wilds();
    const a = wild(new Fauna(sim).step(0, 80, 80, 80, 80, 80)).map((h) => [h.hx, h.hz]);
    const b = wild(new Fauna(sim).step(0, 80, 80, 80, 80, 80)).map((h) => [h.hx, h.hz]);
    expect(a.length).toBeGreaterThan(0);
    expect(b).toEqual(a);
  });

  it("homes them on grass, clear of the map edge", () => {
    const sim = wilds();
    // A band of water across the middle: no home may land in it.
    for (let y = 70; y < 90; y++) {
      for (let x = 0; x < sim.world.size; x++) sim.world.tmap[tileIndex(x, y, sim.world.size)] = Terrain.Water;
    }
    for (const h of wild(new Fauna(sim).step(0, 80, 80, 80, 80, 80))) {
      const i = tileIndex(Math.floor(h.hx), Math.floor(h.hz), sim.world.size);
      expect(sim.world.tmap[i]).toBe(Terrain.Grass);
      expect(h.hx).toBeGreaterThan(7);
      expect(h.hz).toBeGreaterThan(7);
    }
  });

  it("re-homes outward when a wall closes round it, rather than freezing", () => {
    // ARCHITECTURE's Gotcha 8 is this exact machine: the mockup's deer rejected
    // every roam target and froze on their home tiles for the rest of the game.
    // Refusing enclosed ground without re-homing is that bug with the serial
    // numbers filed off, which is why it is pinned here rather than reasoned.
    const sim = wilds();
    const fauna = new Fauna(sim);
    const before = wild(fauna.step(0, 80, 80, 80, 80, 80))[0];
    const home = { x: before.hx, z: before.hz };
    const centre = sim.world.size / 2;
    const away = Math.hypot(home.x - centre, home.z - centre);

    // Enclose everything within twelve tiles of the herd — a colony that grew
    // out to meet it, which is reachable by ordinary play since homes are
    // derived once and enclosure grows wherever the player builds.
    for (let y = 0; y < sim.world.size; y++) {
      for (let x = 0; x < sim.world.size; x++) {
        if (Math.hypot(x - home.x, y - home.z) < 12) sim.insideMap[tileIndex(x, y, sim.world.size)] = 1;
      }
    }

    const after = wild(run(fauna, sim, 90, before.hx, before.hz))[0];
    // It moved, it moved *outward*, and it landed somewhere it can actually
    // graze — the three things "re-homes outward" has to mean.
    expect(Math.hypot(after.hx - home.x, after.hz - home.z)).toBeGreaterThan(0);
    expect(Math.hypot(after.hx - centre, after.hz - centre)).toBeGreaterThan(away);
    expect(sim.insideMap[tileIndex(Math.floor(after.hx), Math.floor(after.hz), sim.world.size)]).toBe(0);
  });
});

describe("fauna and the Wilds", () => {
  it("do not notice a monster standing among them", () => {
    // Deliberate, and recorded so it is not added later as obvious polish: a
    // deer that scattered is early warning nobody paid a pair of hands for,
    // and watchtowers are the only thing in this game that sells knowledge.
    const calm = wilds();
    const calmHerd = wild(run(new Fauna(calm), calm, 20, 80, 80))[0];

    const prowled = wilds();
    const herd = wild(new Fauna(prowled).step(0, 80, 80, 80, 80, 80))[0];
    prowled.monsters.push(testMonster({ x: herd.hx, y: herd.hz }));
    const prowledHerd = wild(run(new Fauna(prowled), prowled, 20, 80, 80))[0];

    // The wander itself is random, so what is pinned is that the herd is still
    // grazing its own home rather than having fled it.
    expect(prowledHerd.hx).toBe(calmHerd.hx);
    expect(prowledHerd.hz).toBe(calmHerd.hz);
    for (const c of prowledHerd.creatures) {
      expect(Math.hypot(c.x - prowledHerd.hx, c.z - prowledHerd.hz)).toBeLessThan(prowledHerd.radius + 0.5);
    }
  });
});
