import type { Colonist, Sim } from "../store";
import { HUNGRY_FACTOR, HUNGRY_TICKS, MEAL_TICKS, WALK_TILES_PER_TICK } from "../tuning";

/**
 * Hunger: the clock, and the one penalty it ever produces.
 *
 * `Colonist.hunger` counts ticks since the last meal. At `MEAL_TICKS` a
 * colonist is **due** and goes looking for bread (`labour/colonists`); from
 * `HUNGRY_TICKS` with none found they work and walk at `HUNGRY_FACTOR` — and
 * that is the whole of it. Nobody dies, nobody stops, nothing alerts: a colony
 * with no bread is a *slower* colony, exactly as a starved workshop is a flat
 * one (docs/CONCEPT.md — supply failures plateau, they never spiral).
 *
 * The predicates live here rather than in `colonists.ts` because the penalty
 * reaches past it: `economy/workshop` slows a batch by its slot worker's
 * hunger, and the builder's hunger slows `Building.progress`. One rule, one
 * home, three callers.
 */

/** Due a meal — from here they will break off and go and find one. */
export function mealDue(c: Colonist): boolean {
  return c.hunger >= MEAL_TICKS;
}

/**
 * Hungry enough to be slowed, which is also the set the ribbon counts.
 *
 * Half a day past `MEAL_TICKS`, deliberately: counting everyone merely *due* a
 * meal would flicker "· 1 hungry" on the ribbon at every lunch walk, and the
 * readout exists to report the plateau rather than the routine.
 */
export function hungry(c: Colonist): boolean {
  return c.hunger >= HUNGRY_TICKS;
}

/**
 * Does this tick's work count for this colonist?
 *
 * The slowdown is a **cadence over whole ticks**, never a fractional work
 * float: every work accumulator in the game is an integer count against an
 * integer target, and paying them 0.6 of a tick would put fractions into the
 * store and therefore into the golden hash. So a hungry worker's tick is
 * either whole or skipped, and the skipped ones fall where a Bresenham line
 * puts them — exactly `HUNGRY_FACTOR` of them survive over any stretch.
 *
 * Offset by colonist id so a hungry colony does not stop and start in unison.
 */
export function worksThisTick(sim: Sim, c: Colonist): boolean {
  if (!hungry(c)) return true;
  const t = sim.tick + c.id;
  return Math.floor((t + 1) * HUNGRY_FACTOR) > Math.floor(t * HUNGRY_FACTOR);
}

/**
 * Tiles this colonist may cover this tick.
 *
 * **Fleeing is exempt and passes `WALK_TILES_PER_TICK` itself**: threat speed
 * against a fleeing worker is CONCEPT's central difficulty dial, and an empty
 * larder must never quietly raise the death rate. The plateau slows work, never
 * escape.
 */
export function walkBudget(c: Colonist): number {
  return hungry(c) ? WALK_TILES_PER_TICK * HUNGRY_FACTOR : WALK_TILES_PER_TICK;
}
