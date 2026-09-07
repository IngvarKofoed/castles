import { abandonTask } from "../labour/tasks";
import { occupancy } from "../path";
import { TaskKind, type Sim } from "../store";
import { WallState, damageTier, isBlueprint, isDamageable, wallMaxDamage } from "../walls";
import { markEnclosureStale } from "../walls/enclosure";
import { markChunkDirty, tileIndex } from "../world/world";

/**
 * What a bite does to a wall, and what labour undoes.
 *
 * `sim.wallDamageMap` stores **damage**, not hit points: 0 is pristine, so a
 * segment is born sound without anybody writing to the layer, and the max-HP
 * numbers stay tunables rather than being frozen into every save file the
 * moment they were first chosen.
 *
 * Two shapes of damage, and they are deliberately different. A **standing**
 * segment accumulates until it reaches its maximum and then falls — the hole is
 * real, the enclosure shrinks, and danger pours through it. A **blueprint** is
 * sticks: one bite erases it, whatever the numbers say. Nothing is lost with it
 * but the sticks, because a build-wall task carries its log right up to the
 * completion instant, so killing the task drops the material where the builder
 * stands (docs/changelog/2026-09-02-palisade-walls.md).
 */

/**
 * Land `amount` of bite damage on tile `i`. Returns true if the segment came
 * down — the caller's cue to stop biting it.
 *
 * A segment that falls leaves **no refund**: the material went into something a
 * monster ate. That is the honest price of a breach, and the reason a contested
 * push is a decision rather than a free retry.
 */
export function biteWall(sim: Sim, i: number, amount: number): boolean {
  const state = sim.wallMap[i];
  if (!isDamageable(state)) return true;
  const size = sim.world.size;
  const x = i % size;
  const y = (i - x) / size;

  if (isBlueprint(state)) {
    clearWall(sim, i, x, y);
    // The live build-wall task goes through the standard abandon: its item
    // reservation is released and the log lands where the builder is standing,
    // which is the same path a razed blueprint already takes.
    const occ = occupancy(sim);
    for (const task of [...sim.tasks]) {
      if (task.kind === TaskKind.BuildWall && task.x === x && task.y === y) abandonTask(sim, occ, task);
    }
    return true;
  }

  const max = wallMaxDamage(state);
  const before = sim.wallDamageMap[i];
  const after = Math.min(max, before + amount);
  sim.wallDamageMap[i] = after;
  if (after >= max) {
    clearWall(sim, i, x, y);
    return true;
  }
  // Only a crossed third rebakes: 40 bites per palisade would otherwise mean 40
  // chunk rebuilds for a change nobody can see.
  if (damageTier(state, after) !== damageTier(state, before)) markChunkDirty(sim.world, x, y);
  return false;
}

/**
 * Work damage back out at `amount` points, and clean up when the segment is
 * sound again. Returns true when nothing is left to repair.
 */
export function repairWall(sim: Sim, i: number, amount: number): boolean {
  const state = sim.wallMap[i];
  const before = sim.wallDamageMap[i];
  if (before === 0) return true;
  const after = Math.max(0, before - amount);
  sim.wallDamageMap[i] = after;
  if (damageTier(state, after) !== damageTier(state, before)) {
    const size = sim.world.size;
    markChunkDirty(sim.world, i % size, (i - (i % size)) / size);
  }
  return after === 0;
}

/** Take a segment off the map: the tile clears, its damage resets so the next
 *  wall built here is born sound, and the enclosure is stale. */
function clearWall(sim: Sim, i: number, x: number, y: number): void {
  sim.wallMap[i] = WallState.None;
  sim.wallDamageMap[i] = 0;
  sim.razeMap[i] = 0;
  markChunkDirty(sim.world, x, y);
  markEnclosureStale(sim);
}

/**
 * The nearest damageable segment within `range` of (x, y), Chebyshev, as a tile
 * index — or -1.
 *
 * Used twice, for opposite reasons: a prowling monster looking for something to
 * attack, and a monster with nowhere to walk taking its frustration out on
 * whatever is in the way. Ties break by tile index, so the choice never depends
 * on scan order changing.
 */
export function nearestDamageable(sim: Sim, x: number, y: number, range: number): number {
  const size = sim.world.size;
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  let best = -1;
  let bestD = Infinity;
  for (let ty = Math.max(0, cy - range); ty <= Math.min(size - 1, cy + range); ty++) {
    for (let tx = Math.max(0, cx - range); tx <= Math.min(size - 1, cx + range); tx++) {
      const i = tileIndex(tx, ty, size);
      if (!isDamageable(sim.wallMap[i])) continue;
      const d = Math.max(Math.abs(tx + 0.5 - x), Math.abs(ty + 0.5 - y));
      // The box is built from a *floored* position, so it reaches up to a tile
      // further than `range` on whichever axis the monster is standing short of
      // a tile centre. Without this a wall outside the notice radius is
      // noticeable, which the colonist branch of `acquire` already refuses —
      // the two have to agree or the same monster notices a wall further away
      // than it notices a person.
      if (d > range) continue;
      if (d < bestD) {
        best = i;
        bestD = d;
      }
    }
  }
  return best;
}

/**
 * Clear a tile's damage without repairing it — for a segment leaving the map by
 * some route other than a bite. Razing is the one such route: without this a
 * dismantled palisade would leave its damage lying on the tile and the next
 * segment raised there would be born half-eaten.
 */
export function clearDamage(sim: Sim, i: number): void {
  sim.wallDamageMap[i] = 0;
}
