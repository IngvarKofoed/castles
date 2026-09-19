import { canStepTo, inBounds, passable, type Occupancy, type StepGate } from "../path";
import { MonsterKind, type Monster, type MonsterKindValue, type Sim } from "../store";
import {
  CATCH_RANGE,
  ORC_BITE,
  ORC_BITE_TICKS,
  ORC_NOTICE,
  ORC_SPEED,
  TROLL_BITE,
  TROLL_BITE_TICKS,
  TROLL_NOTICE,
  TROLL_SPEED,
} from "../tuning";
import { isBuilt, isGateway } from "../walls";
import { tileIndex } from "../world/world";

/**
 * The Wilds: what a monster kind *is*, and the movement rules the whole folder
 * reads through.
 *
 * The orc/troll split lives entirely in the table below — CONCEPT records it as
 * emergent from numbers, and nothing in `monsters.ts` asks which kind it is
 * holding. Orcs are fast and bite light, which makes them the threat to people;
 * trolls are slow and bite hard, which makes them the threat to the race to
 * close a wall. Neither has a rule the other lacks.
 */

export interface MonsterDef {
  readonly kind: MonsterKindValue;
  readonly name: string;
  /** Tiles per tick. */
  readonly speed: number;
  /** How far it notices, Chebyshev, while prowling. */
  readonly notice: number;
  /** Damage per bite, and the ticks between bites. */
  readonly bite: number;
  readonly biteTicks: number;
}

export const MONSTER_DEFS: Record<MonsterKindValue, MonsterDef> = {
  [MonsterKind.Orc]: {
    kind: MonsterKind.Orc,
    name: "Orc",
    speed: ORC_SPEED,
    notice: ORC_NOTICE,
    bite: ORC_BITE,
    biteTicks: ORC_BITE_TICKS,
  },
  [MonsterKind.Troll]: {
    kind: MonsterKind.Troll,
    name: "Troll",
    speed: TROLL_SPEED,
    notice: TROLL_NOTICE,
    bite: TROLL_BITE,
    biteTicks: TROLL_BITE_TICKS,
  },
};

/** An unknown kind reads as an orc rather than throwing — a save from a future
 *  build is refused by the codec, not here. */
export function defOfMonster(kind: number): MonsterDef {
  return MONSTER_DEFS[kind as MonsterKindValue] ?? MONSTER_DEFS[MonsterKind.Orc];
}

/**
 * Ground a monster may walk, which is **colonist ground minus every standing
 * gateway**. That is the one movement difference the two have: a gate is
 * traffic for the colony and wall to the world, so it must let folk through and
 * never a monster (docs/CONCEPT.md, pillar 1 — a closed gate counts as wall).
 *
 * A gate *blueprint* is not a gate: blueprints are open ground to everyone, and
 * a monster walks over a drawn line harmlessly rather than being stopped by
 * sticks. Nothing else is special-cased — cliffs are natural walls for a
 * monster exactly as they are for a colonist, which is a quiet reward for
 * keeping an outcrop.
 */
export function monsterStep(sim: Sim, occ: Occupancy): StepGate {
  const world = sim.world;
  const wall = sim.wallMap;
  return (x, y, fromH) => {
    if (!canStepTo(world, wall, occ, x, y, fromH)) return false;
    const w = wall[tileIndex(x, y, world.size)];
    return !(isGateway(w) && isBuilt(w));
  };
}

/** The same rule without the height step, for goal sets and single tiles. */
export function monsterPassable(sim: Sim, occ: Occupancy, x: number, y: number): boolean {
  if (!passable(sim.world, sim.wallMap, occ, x, y)) return false;
  const w = sim.wallMap[tileIndex(x, y, sim.world.size)];
  return !(isGateway(w) && isBuilt(w));
}

/** Goal set: every tile a monster may stand on orthogonally beside (x, y). */
export function monsterNeighbours(sim: Sim, occ: Occupancy, x: number, y: number): Set<number> {
  const goals = new Set<number>();
  for (const [dx, dy] of [
    [0, -1],
    [-1, 0],
    [1, 0],
    [0, 1],
  ] as const) {
    const nx = x + dx;
    const ny = y + dy;
    if (!inBounds(sim.world, nx, ny)) continue;
    if (!monsterPassable(sim, occ, nx, ny)) continue;
    goals.add(tileIndex(nx, ny, sim.world.size));
  }
  return goals;
}

/** Chebyshev distance between a monster and a point, in tiles — how *far*, for
 *  notice and flee ranges, where a fraction of a tile is meaningful. */
export function reach(m: Monster, x: number, y: number): number {
  return Math.max(Math.abs(m.x - x), Math.abs(m.y - y));
}

/**
 * Adjacent, in the tile sense: standing on that tile or on one of the eight
 * touching it.
 *
 * Deliberately **not** `reach(...) <= 1`. Positions are fractional, so a
 * monster halfway across the tile next door measures 1.3 from the neighbouring
 * tile's centre and would never be adjacent to anything it was standing beside
 * — a wall it had walked all the way up to could not be bitten, and it would
 * stand there for the whole prowl. "Adjacent" is a fact about tiles.
 */
export function adjacentTo(m: Monster, tx: number, ty: number): boolean {
  return Math.max(Math.abs(Math.floor(m.x) - tx), Math.abs(Math.floor(m.y) - ty)) <= CATCH_RANGE;
}

/** The monster standing on this tile, or null. Defined in `store.ts`, because
 *  `buildings.ts` has to ask it and cannot import this folder without closing a
 *  cycle; re-exported here so the rest of the sim keeps one front door onto the
 *  Wilds. */
export { monsterAt } from "../store";
