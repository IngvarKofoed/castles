import { describe, expect, it } from "vitest";
import { MonsterPhase, type Building, type Colonist, type Sim } from "../store";
import { flatSim, testBuilding, testColonist, testMonster } from "../test-sim";
import {
  FORECAST_HORIZON,
  THREAT_BUCKETS,
  WATCH_BUCKETS,
  WATCH_HORIZON,
  WATCH_RANGE,
} from "../tuning";
import { recomputeEnclosure } from "../walls/enclosure";
import { Terrain, tileIndex } from "../world/world";
import { boats, forecast, inspect, monsterAtTile, monsters, readout } from "./index";
import { spawnItem } from "../items";
import { BuildingKind, BuildingState, ItemType } from "../store";
import { HUNGRY_TICKS, MEAL_TICKS, STARTING_COLONISTS } from "../tuning";

/**
 * What the player is allowed to know about the Wilds.
 *
 * This is the one place in the game where truth and knowledge genuinely differ,
 * so it is worth pinning from both sides: that the forecast really is coarse and
 * really does go blank past a horizon (or watchtowers have nothing left to
 * sell), and that the exact clock never leaks out in a shape a consumer could
 * read (docs/ARCHITECTURE.md, "Truth and knowledge").
 */

const at = (sim: Sim, x: number, y: number): number => tileIndex(x, y, sim.world.size);

/** Where every tower in this file stands — far enough in that a `WATCH_RANGE`
 *  square and a stretch of coast past its edge both fit on the map. */
const TOWER = 30;

/**
 * Put a Watchtower at `TOWER` with a watcher inside it, and hand both back.
 *
 * The staffing is set up by hand rather than by running `staff`: these tests
 * are about the *gate* — slot set, worker bound, worker inside — so they have
 * to be able to break each of its three parts on its own.
 */
function towered(sim: Sim, staffed = true): { tower: Building; watcher: Colonist } {
  const tower = testBuilding({ id: 50, kind: BuildingKind.Watchtower, x: TOWER, y: TOWER, w: 1, h: 1 });
  sim.buildings.push(tower);
  const watcher = sim.colonists[0];
  if (staffed) {
    watcher.slot = tower.id;
    watcher.inside = 1;
    tower.worker = watcher.id;
  }
  return { tower, watcher };
}

/** Put the next storm's landing site `dx`, `dy` from the tower. The forecast's
 *  subject is a store field, so a test can simply say where it is. */
function landingAt(sim: Sim, dx: number, dy = 0): void {
  sim.stormLanding = tileIndex(TOWER + dx, TOWER + dy, sim.world.size);
}

function peopled(size = 24): Sim {
  const sim = flatSim(size);
  const c = testColonist({ id: sim.nextId++, x: 12.5, y: 12.5 });
  sim.colonists.push(c);
  recomputeEnclosure(sim);
  return sim;
}

describe("what the renderer may see of a monster", () => {
  it("carries position and kind, and exactly two states", () => {
    const sim = peopled();
    sim.monsters.push(testMonster({ x: 4.5, y: 4.5, id: 1 }));
    sim.monsters.push(testMonster({ x: 18.5, y: 4.5, id: 2, phase: MonsterPhase.Withdrawing }));

    const seen = monsters(sim);
    expect(seen.map((m) => m.doing)).toEqual(["ashore", "withdrawing"]);
    expect(seen[0].x).toBe(4.5);
  });

  it("hands the renderer nothing it could read a clock off", () => {
    const sim = peopled();
    sim.monsters.push(testMonster({ x: 4.5, y: 4.5, id: 1, phaseTicks: 137 }));
    const keys = Object.keys(monsters(sim)[0]).sort();
    // The storm's clock, the landing site and how far inland this one presses
    // all stay sim-internal: leaking any of them is how the watchtower mechanic
    // quietly stops being a mechanic, and it would leak as a *field*, not as a
    // decision.
    expect(keys).toEqual(["doing", "heading", "id", "kind", "px", "py", "x", "y"]);
  });

  it("resolves a click to the monster standing on that tile", () => {
    const sim = peopled();
    sim.monsters.push(testMonster({ x: 4.5, y: 4.5, id: 7 }));
    expect(monsterAtTile(sim, 4, 4)?.id).toBe(7);
    expect(monsterAtTile(sim, 5, 4)).toBeNull();
  });

  it("shows one boat per landing site, and none in peace", () => {
    const sim = peopled();
    expect(boats(sim)).toEqual([]);
    sim.monsters.push(testMonster({ x: 4.5, y: 4.5, id: 1, landX: 3, landY: 9 }));
    sim.monsters.push(testMonster({ x: 5.5, y: 4.5, id: 2, landX: 3, landY: 9 }));
    // One site however large the incursion: the direction is the whole product.
    expect(boats(sim)).toEqual([{ x: 3, y: 9 }]);
  });
});

describe("the forecast", () => {
  it("shows no bar at all past the horizon, and says so in words", () => {
    const sim = peopled();
    sim.stormTicks = FORECAST_HORIZON * 2;
    const f = forecast(sim);
    expect(f.lit).toBe(0);
    expect(f.buckets).toBe(THREAT_BUCKETS);
    expect(f.caption).toBe("a storm is far off");
    expect(f.watched).toBe(false);
  });

  it("fills toward the landing, in fifths and never sharper", () => {
    const sim = peopled();
    const buckets = new Set<number>();
    let last = 0;
    for (let left = FORECAST_HORIZON; left >= 0; left -= FORECAST_HORIZON / 40) {
      sim.stormTicks = Math.round(left);
      const f = forecast(sim);
      expect(f.buckets).toBe(THREAT_BUCKETS);
      expect(f.lit).toBeGreaterThanOrEqual(1);
      expect(f.lit).toBeLessThanOrEqual(THREAT_BUCKETS);
      expect(f.lit).toBeGreaterThanOrEqual(last);
      last = f.lit;
      buckets.add(f.lit);
    }
    // It does move — a bar that never changed would be honest about nothing.
    expect(buckets.size).toBe(THREAT_BUCKETS);
  });

  it("tells the time in words, off the same bucket the bar shows", () => {
    const sim = peopled();
    const said = new Set<string>();
    for (let left = FORECAST_HORIZON; left > 0; left -= 10) {
      sim.stormTicks = left;
      const caption = forecast(sim).caption;
      // Never a digit: a figure invites arithmetic the estimate is a fifth of a
      // horizon too coarse to support.
      expect(caption).not.toMatch(/\d/);
      said.add(caption);
    }
    expect(said.size).toBeGreaterThan(2);
    sim.stormTicks = 1;
    expect(forecast(sim).caption).toMatch(/any moment now$/);
    // The widest thing an unaided forecast can say is a day or two: its whole
    // horizon is a day and a half, so "in a few days" is a phrase only a
    // watcher's longer horizon can reach — one more way the tower is worth a
    // pair of hands.
    sim.stormTicks = FORECAST_HORIZON;
    expect(forecast(sim).caption).toMatch(/in a day or two$/);
  });

  it("names the coast the storm is coming in on", () => {
    const sim = peopled();
    sim.stormTicks = 100;
    // The colony stands at (12, 12); a landing due east of it reads as east,
    // and one due north as north — the grid's y grows south.
    sim.stormLanding = at(sim, 22, 12);
    expect(forecast(sim).caption).toMatch(/^storm from the east,/);
    sim.stormLanding = at(sim, 12, 2);
    expect(forecast(sim).caption).toMatch(/^storm from the north,/);
    // No coast picked yet: it still says a storm is coming, because it is.
    sim.stormLanding = -1;
    expect(forecast(sim).caption).toMatch(/^a storm,/);
  });

  it("stands full while anything is ashore, and says when they are leaving", () => {
    const sim = peopled();
    sim.stormTicks = 100;
    const m = testMonster({ x: 4.5, y: 4.5, id: 1 });
    sim.monsters.push(m);
    expect(forecast(sim).lit).toBe(THREAT_BUCKETS);
    expect(forecast(sim).caption).toBe("the wilds are ashore");

    m.phase = MonsterPhase.Withdrawing;
    expect(forecast(sim).caption).toBe("the wilds are leaving");
    expect(forecast(sim).lit).toBe(THREAT_BUCKETS);
  });
});

describe("a watchtower's coverage", () => {
  /**
   * The whole product in one assertion: a covered landing is forecast **sooner**
   * and **finer**. Both halves matter — tenths on the same horizon would only be
   * a prettier bar, and an earlier sighting in fifths would say no more than it
   * did before.
   */
  it("sights a covered landing earlier, and reads it in tenths", () => {
    const sim = peopled(70);
    landingAt(sim, 4);
    // Past the unaided horizon and inside the watched one: the difference a
    // pair of hands buys, measured at the one tick where it is visible.
    sim.stormTicks = FORECAST_HORIZON + 10;
    expect(forecast(sim).lit).toBe(0);
    expect(forecast(sim).buckets).toBe(THREAT_BUCKETS);

    towered(sim);
    const f = forecast(sim);
    expect(f.watched).toBe(true);
    expect(f.buckets).toBe(WATCH_BUCKETS);
    expect(f.lit).toBeGreaterThan(0);
    // Finer, never a digit — tenths in words and segments is the ceiling.
    expect(f.caption).not.toMatch(/\d/);
  });

  it("leaves an uncovered landing exactly as coarse as it was", () => {
    // The base game's coarseness has to keep meaning something, so the
    // comparison is against the same colony with no tower at all.
    const bare = peopled(70);
    landingAt(bare, WATCH_RANGE + 1);
    bare.stormTicks = 400;

    const sim = peopled(70);
    towered(sim);
    landingAt(sim, WATCH_RANGE + 1);
    sim.stormTicks = 400;

    // The bar and the bucket count, not the caption: `sim` has a tower standing
    // in it, so the compass word is measured from a different anchor.
    const { lit, buckets, watched } = forecast(sim);
    expect({ lit, buckets, watched }).toEqual({
      lit: forecast(bare).lit,
      buckets: THREAT_BUCKETS,
      watched: false,
    });
  });

  it("cuts off exactly at WATCH_RANGE, and measures Chebyshev", () => {
    const sim = peopled(70);
    towered(sim);
    sim.stormTicks = 400;
    // Straight out: 24 covered, 25 not. The edge is exact, so a landing one
    // tile past it is one the player has to guess at.
    landingAt(sim, WATCH_RANGE);
    expect(forecast(sim).watched).toBe(true);
    landingAt(sim, WATCH_RANGE + 1);
    expect(forecast(sim).watched).toBe(false);
    // And on the diagonal, which is where a *circle* of radius 24 would have
    // disagreed with the square the overlay draws.
    landingAt(sim, WATCH_RANGE, WATCH_RANGE);
    expect(forecast(sim).watched).toBe(true);
    landingAt(sim, WATCH_RANGE + 1, WATCH_RANGE);
    expect(forecast(sim).watched).toBe(false);
  });

  it("is rented with hands: no watcher inside, no sharpening", () => {
    const sim = peopled(70);
    const { tower, watcher } = towered(sim);
    landingAt(sim, 4);
    sim.stormTicks = 400;
    expect(forecast(sim).buckets).toBe(WATCH_BUCKETS);

    // Walking over: the slot is filled and the picture is still coarse. This
    // is also what makes the watcher's lunch coarsen it — an eater has left
    // the building, so `inside` is 0 for exactly the same reason.
    watcher.inside = 0;
    expect(forecast(sim).buckets).toBe(THREAT_BUCKETS);
    watcher.inside = 1;

    // Bound to some other building: the gate matches the slot, not just the id.
    watcher.slot = 999;
    expect(forecast(sim).buckets).toBe(THREAT_BUCKETS);
    watcher.slot = tower.id;

    // Unstaffed: back to fifths on the same read, with nothing remembered.
    tower.worker = -1;
    expect(forecast(sim).buckets).toBe(THREAT_BUCKETS);
    expect(forecast(sim).watched).toBe(false);

    // And an unfinished tower watches nothing however staffed the store says
    // it is — a blueprint is a plot with stakes in it.
    tower.worker = watcher.id;
    tower.state = BuildingState.Blueprint;
    expect(forecast(sim).watched).toBe(false);
  });

  it("keeps reading finely for as long as that storm is ashore", () => {
    // The subject does not move when the boats arrive: a tower watching the
    // coast a storm came in on is watching where it still is.
    const sim = peopled(70);
    towered(sim);
    landingAt(sim, 4);
    sim.monsters.push(testMonster({ x: TOWER + 4.5, y: TOWER + 0.5, id: 1 }));
    const f = forecast(sim);
    expect(f.watched).toBe(true);
    expect(f.buckets).toBe(WATCH_BUCKETS);
    expect(f.lit).toBe(WATCH_BUCKETS);
  });

  it("extends the horizon rather than only the bucket count", () => {
    const sim = peopled(70);
    towered(sim);
    landingAt(sim, 4);
    // Just inside the watched horizon and well past the unaided one.
    sim.stormTicks = WATCH_HORIZON - 1;
    expect(forecast(sim).lit).toBeGreaterThan(0);
    sim.stormTicks = WATCH_HORIZON + 1;
    expect(forecast(sim).lit).toBe(0);
    expect(forecast(sim).caption).toBe("a storm is far off");
  });
});

describe("a watchtower's panel", () => {
  it("counts the shore in reach whether or not anybody is watching", () => {
    // Staffing-blind on purpose: an unstaffed tower can then say what it
    // *would* watch, which is what makes siting one a decision rather than a
    // guess. `flatSim` is all grass, so a tower over dry land sees nothing.
    const sim = peopled(70);
    const { tower } = towered(sim, false);
    expect(inspect(sim, tower.id)?.watching).toBe(0);

    // A one-tile bay: sand beside water, inside the square.
    sim.world.tmap[at(sim, TOWER + 4, TOWER)] = Terrain.Sand;
    sim.world.tmap[at(sim, TOWER + 5, TOWER)] = Terrain.Water;
    // And the same pair well outside it, which must not be counted.
    sim.world.tmap[at(sim, TOWER + WATCH_RANGE + 2, TOWER)] = Terrain.Sand;
    sim.world.tmap[at(sim, TOWER + WATCH_RANGE + 3, TOWER)] = Terrain.Water;
    expect(inspect(sim, tower.id)?.watching).toBe(1);

    // Unchanged by staffing — the wording is what carries that difference.
    tower.worker = sim.colonists[0].id;
    sim.colonists[0].slot = tower.id;
    sim.colonists[0].inside = 1;
    expect(inspect(sim, tower.id)?.watching).toBe(1);
  });

  it("reports -1 for everything that is not a tower", () => {
    const sim = peopled(70);
    const pile = testBuilding({ id: 60, x: 4, y: 4 });
    sim.buildings.push(pile);
    expect(inspect(sim, pile.id)?.watching).toBe(-1);
    // And a tower has no recipe at all, which is what drops the chain chip and
    // the input/output rows from its panel.
    const { tower } = towered(sim, false);
    expect(inspect(sim, tower.id)?.chain).toBeNull();
    expect(inspect(sim, tower.id)?.outputType).toBe(-1);
    expect(inspect(sim, tower.id)?.hasSlot).toBe(true);
  });
});

describe("what the ribbon may know about hunger", () => {
  it("counts the slowed, not everyone who is merely due a meal", () => {
    // The distinction is the whole reason the readout is trustworthy: a colony
    // walking to lunch is not a colony in trouble, and a suffix that flickered
    // at every meal would be noise (docs/specs/2026-09-08-bread-economy.md).
    const sim = peopled();
    const c = sim.colonists[0];
    expect(readout(sim).hungry).toBe(0);

    c.hunger = MEAL_TICKS;
    expect(readout(sim).hungry).toBe(0);
    c.hunger = HUNGRY_TICKS;
    expect(readout(sim).hungry).toBe(1);

    // A wanderer is in none of the numbers, this one included: they do not
    // hunger at all until they settle.
    c.dest = 7;
    expect(readout(sim).hungry).toBe(0);
    expect(readout(sim).folk).toBe(0);
  });
});

describe("what the ribbon may know about idle hands", () => {
  it("counts hands the player could spend, so somebody at a meal is not idle", () => {
    // `idle` is how the player reads the pool's slack, so it has to mean
    // available for work: an eater holds no task and cannot take one either,
    // and counted the other way day two reads `5 idle` with every starting
    // hunger clock due at once
    // (docs/changelog/2026-09-09-idle-means-available.md).
    const sim = peopled();
    const c = sim.colonists[0];
    expect(readout(sim).idle).toBe(1);

    // Away at a meal: still a pool worker, no longer a spendable pair of hands.
    c.eating = 1;
    expect(readout(sim).idle).toBe(0);
    expect(readout(sim).pool).toBe(1);

    // A claimed task is the other way to stop being idle, unchanged.
    c.eating = 0;
    c.task = 3;
    expect(readout(sim).idle).toBe(0);
  });
});

describe("what a House says about the food gate", () => {
  it("reports the table as short only when bread, not the cap, is what holds arrivals", () => {
    const sim = peopled();
    const house = testBuilding({ id: 40, kind: BuildingKind.House, x: 4, y: 4 });
    sim.buildings.push(house);
    // One settled colonist, no bread, room under the cap: the gate is shut and
    // it is the larder that shuts it.
    expect(inspect(sim, house.id)?.tableShort).toBe(true);

    // A loaf per head plus the newcomer clears it.
    spawnItem(sim, ItemType.Bread, 8, 8);
    spawnItem(sim, ItemType.Bread, 8, 8);
    expect(inspect(sim, house.id)?.tableShort).toBe(false);

    // And the *cap* holding arrivals is not the table being short: a colony at
    // its cap with an empty larder says nothing, because bread is not what is
    // stopping anybody.
    for (const loaf of [...sim.items]) sim.items.splice(sim.items.indexOf(loaf), 1);
    while (sim.colonists.length < STARTING_COLONISTS + 2) {
      sim.colonists.push({ ...sim.colonists[0], id: sim.nextId++ });
    }
    expect(inspect(sim, house.id)?.tableShort).toBe(false);

    // Nothing but a House ever reports it, and neither does an unfinished one.
    const mill = testBuilding({ id: 41, kind: BuildingKind.Sawmill, x: 12, y: 4 });
    const site = testBuilding({ id: 42, kind: BuildingKind.House, x: 12, y: 12, state: BuildingState.Blueprint });
    sim.buildings.push(mill, site);
    expect(inspect(sim, mill.id)?.tableShort).toBe(false);
    expect(inspect(sim, site.id)?.tableShort).toBe(false);
  });
});
