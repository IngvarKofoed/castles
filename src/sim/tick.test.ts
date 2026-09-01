import { describe, expect, it } from "vitest";
import { BuildingKind, BuildingState, ItemType, Loc, TaskKind } from "./store";
import { createSim } from "./store";
import { advanceTick } from "./tick";
import type { Command } from "./commands";
import { hashSim } from "./hash";
import { readout } from "./know";
import { canPlace } from "./buildings";
import { tileIndex } from "./world/world";

const SEED = 20260901;

/**
 * The scripted run the determinism contract is pinned to: a seed, a command
 * log keyed to exact ticks, and a fixed number of ticks. Everything a session
 * changes about the labour loop shows up as a different hash here.
 */
type Store = ReturnType<typeof createSim>;

function scriptedRun(ticks: number): Store {
  const sim = createSim(SEED);
  for (let t = 0; t < ticks; t++) advanceTick(sim, script(sim));
  return sim;
}

/**
 * Designate a handful of trees, place a stockpile, place a sawmill, staff it.
 *
 * The log is keyed to exact ticks and every choice it makes is a pure function
 * of the store, so it is reproducible in the sense the contract needs — the
 * sawmill's id isn't hard-coded, it's whatever the identical run produced.
 */
function script(sim: Store): Command[] {
  switch (sim.tick) {
    // One command carrying sixteen tiles — the shape a drag-box produces, and
    // the reason a marquee over a whole wood stays one entry in the log.
    case 0:
      return [{ kind: "designateChop", tiles: tileList(sim, nearestTrees(sim, 16)) }];
    // A second box, overlapping the first: designation is additive, so the
    // repeats are no-ops and only the four new tiles take.
    case 60:
      return [{ kind: "designateChop", tiles: tileList(sim, nearestTrees(sim, 20)) }];
    // And one taken back by hand, so the single-tile toggle stays pinned too.
    case 90: {
      const [x, y] = nearestTrees(sim, 1)[0];
      return [{ kind: "cancelChop", x, y }];
    }
    case 5: {
      const [x, y] = nearestSite(sim, BuildingKind.Stockpile);
      return [{ kind: "place", building: BuildingKind.Stockpile, x, y }];
    }
    case 400: {
      const [x, y] = nearestSite(sim, BuildingKind.Sawmill, sim.buildings[0]);
      return [{ kind: "place", building: BuildingKind.Sawmill, x, y }];
    }
    // Staff, pull them back out, put them back in: the slot worker's whole
    // round trip — walk over, step inside, step out to the work tile, rejoin
    // the pool, walk back in — sits inside the determinism pin.
    case 1200:
    case 1380:
      return staffCommand(sim, "staff");
    case 1300:
      return staffCommand(sim, "unstaff");
    default:
      return [];
  }
}

const tileList = (sim: Store, tiles: [number, number][]): number[] =>
  tiles.map(([x, y]) => tileIndex(x, y, sim.world.size));

function staffCommand(sim: Store, kind: "staff" | "unstaff"): Command[] {
  const mill = sim.buildings.find((b) => b.kind === BuildingKind.Sawmill);
  return mill ? [{ kind, building: mill.id }] : [];
}

function nearestTrees(sim: Store, count: number): [number, number][] {
  const size = sim.world.size;
  const centre = Math.floor(size / 2);
  const out: [number, number][] = [];
  for (let r = 1; r < size && out.length < count; r++) {
    for (let dy = -r; dy <= r && out.length < count; dy++) {
      for (let dx = -r; dx <= r && out.length < count; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = centre + dx;
        const y = centre + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        if (sim.world.treeMap[tileIndex(x, y, size)]) out.push([x, y]);
      }
    }
  }
  return out;
}

function nearestSite(sim: Store, kind: 0 | 1, avoid?: { x: number; y: number }): [number, number] {
  const size = sim.world.size;
  const centre = Math.floor(size / 2);
  for (let r = 2; r < size; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = centre + dx;
        const y = centre + dy;
        if (avoid && Math.abs(x - avoid.x) < 4 && Math.abs(y - avoid.y) < 4) continue;
        if (canPlace(sim, kind, x, y)) return [x, y];
      }
    }
  }
  throw new Error("no placeable site");
}

describe("determinism", () => {
  it("replays a scripted command log to a byte-identical store", () => {
    const a = scriptedRun(1500);
    const b = scriptedRun(1500);
    expect(hashSim(a)).toBe(hashSim(b));
  });

  it("holds the golden hash", () => {
    // A hash change is a behaviour change: if this fails, say in the changelog
    // what about the labour loop moved and why.
    //
    // 93cf902e → aca92821 when slot workers gained `inside` and stepped into
    // their workshop (docs/changelog/2026-09-01-slot-workers-step-inside.md):
    // a new store field, the pinned position, and an unstaff/restaff round
    // trip added to the script above.
    //
    // aca92821 → fbe20cb9 when `designateChop` began carrying a tile list
    // (docs/changelog/2026-09-01-drag-box-designation.md): the script above
    // gained a second, overlapping box and a hand cancel, and designating now
    // bumps the tile's chunk version, which the hash covers.
    //
    // Every observable the other tests in this file assert is unchanged.
    expect(hashSim(scriptedRun(1500))).toBe("fbe20cb9");
  });

  it("survives structuredClone unchanged — the shape persistence will freeze", () => {
    const sim = scriptedRun(600);
    const copy = structuredClone(sim);
    expect(hashSim(copy)).toBe(hashSim(sim));
    // And keeps running identically from the copy.
    advanceTick(sim);
    advanceTick(copy);
    expect(hashSim(copy)).toBe(hashSim(sim));
  });

  it("never reaches for unseeded randomness", () => {
    // The lint rule catches a literal `Math.random` written in sim/; this
    // catches one reached indirectly, through a helper or a dependency. Same
    // guarantee, from the other side — which is why this file gets the one
    // sanctioned exemption from the rule it is enforcing.
    /* eslint-disable no-restricted-properties */
    const original = Math.random;
    try {
      Math.random = () => {
        throw new Error("sim reached for Math.random");
      };
      expect(hashSim(scriptedRun(300))).toBe(hashSim(scriptedRun(300)));
    } finally {
      Math.random = original;
    }
    /* eslint-enable no-restricted-properties */
  });
});

describe("the labour loop", () => {
  it("runs designate → chop → haul → build → mill → plank end to end", () => {
    const sim = scriptedRun(1500);
    const r = readout(sim);

    const stockpile = sim.buildings.find((b) => b.kind === BuildingKind.Stockpile);
    const sawmill = sim.buildings.find((b) => b.kind === BuildingKind.Sawmill);
    expect(stockpile?.state).toBe(BuildingState.Active);
    expect(sawmill?.state).toBe(BuildingState.Active);

    // Trees were felled into logs, and logs became planks.
    expect(r.logs).toBeGreaterThan(0);
    expect(r.planks).toBeGreaterThan(0);

    // The mill is staffed, so the pool is one pair of hands short.
    expect(sawmill?.worker).toBeGreaterThanOrEqual(0);
    expect(r.pool).toBe(r.folk - 1);
    expect(r.slots).toBe(1);

    // Goods ended up in storage rather than scattered on the ground.
    const stored = sim.items.filter((it) => it.loc === Loc.Stored && it.holder === stockpile?.id);
    expect(stored.length).toBeGreaterThan(0);
  });

  it("leaves no orphaned reservations when the queue drains", () => {
    const sim = scriptedRun(1500);
    for (const item of sim.items) {
      if (item.reservedBy < 0) continue;
      expect(sim.tasks.some((t) => t.id === item.reservedBy)).toBe(true);
    }
    for (const b of sim.buildings) {
      const incoming = sim.tasks.filter((t) => t.building === b.id && t.kind !== TaskKind.Build).length;
      expect(b.reservedIncoming).toBe(incoming);
    }
  });

  it("never sends two haulers for the same log", () => {
    const sim = createSim(SEED);
    for (let t = 0; t < 1500; t++) {
      advanceTick(sim, script(sim));
      const targeted = sim.tasks.filter((x) => x.item >= 0).map((x) => x.item);
      expect(new Set(targeted).size).toBe(targeted.length);
      const carried = sim.colonists.filter((c) => c.carrying >= 0).map((c) => c.carrying);
      expect(new Set(carried).size).toBe(carried.length);
    }
  });

  it("keeps every item somewhere legal", () => {
    const sim = scriptedRun(1500);
    for (const item of sim.items) {
      if (item.loc === Loc.Ground) {
        expect(item.holder).toBe(-1);
        expect(item.x).toBeGreaterThanOrEqual(0);
      } else if (item.loc === Loc.Carried) {
        expect(sim.colonists.some((c) => c.id === item.holder && c.carrying === item.id)).toBe(true);
      } else {
        expect(sim.buildings.some((b) => b.id === item.holder)).toBe(true);
      }
    }
  });

  it("only ever turns logs into planks inside a staffed mill", () => {
    const sim = scriptedRun(1500);
    const planks = sim.items.filter((it) => it.type === ItemType.Plank);
    expect(planks.length).toBeGreaterThan(0);
    // Nothing produced planks before the mill was staffed at tick 1200.
    const early = createSim(SEED);
    for (let t = 0; t < 1200; t++) advanceTick(early, script(early));
    expect(early.items.some((it) => it.type === ItemType.Plank)).toBe(false);
  });
});
