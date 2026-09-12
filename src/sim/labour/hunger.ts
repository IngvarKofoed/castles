import type { Colonist, Sim } from "../store";
import { CLOTHED_FACTOR, HUNGRY_FACTOR, HUNGRY_TICKS, MEAL_TICKS, WALK_TILES_PER_TICK } from "../tuning";

/**
 * The work cadence: hunger's one penalty, and clothes' one reward.
 *
 * `Colonist.hunger` counts ticks since the last meal. At `MEAL_TICKS` a
 * colonist is **due** and goes looking for food (`labour/colonists`); from
 * `HUNGRY_TICKS` with none found they work and walk at `HUNGRY_FACTOR` — and
 * that is the whole of it. Nobody dies, nobody stops, nothing alerts: a colony
 * with no food is a *slower* colony, exactly as a starved workshop is a flat
 * one (docs/CONCEPT.md — supply failures plateau, they never spiral).
 *
 * `Colonist.clothes` is the inverse, arriving by the same mechanism: a clothed
 * colonist works at `CLOTHED_FACTOR` for as long as the garment lasts
 * (docs/specs/2026-09-10-sheep-and-clothes.md). Walk speed is untouched by it —
 * that is shoes, and shoes are not built.
 *
 * The predicates live here rather than in `colonists.ts` because they reach
 * past it: `economy/workshop` paces a batch by its slot worker, and a
 * builder's own cadence paces `Building.progress`. One rule, one home, and now
 * eight callers.
 */

/** Wearing clothes, and so working faster. */
export function clothed(c: Colonist): boolean {
  return c.clothes > 0;
}

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
 * **How many** work ticks this tick is worth to this colonist: 0, 1 or 2.
 *
 * Both modifiers are **cadences over whole ticks**, never fractional work
 * floats: every work accumulator in the game is an integer count against an
 * integer target, and paying 0.6 or 1.25 of a tick would put fractions into the
 * store and therefore into the golden hash. So a tick is skipped, paid, or paid
 * twice, and which one falls where a Bresenham line puts it — the surviving
 * fraction is exactly the factor over any stretch.
 *
 * **The composition is pinned, because the two readings ship different
 * numbers** (docs/specs/2026-09-10-sheep-and-clothes.md). The extra tick is
 * granted **only on a tick the hunger gate already lets through**, so:
 *
 * - clothed and fed → ×1.25 (one extra every fourth tick)
 * - hungry and unclothed → ×0.6 (three ticks in five)
 * - hungry **and** clothed → exactly ×0.75
 *
 * That last number is the one worth not rediscovering: the two periods are 4
 * and 5, which are coprime, so over any twenty consecutive ticks the bonus
 * lands on a hunger-passed tick exactly three times whatever the phase offset —
 * 0.6 + 3/20. Granting the bonus *unconditionally* instead would ship ×0.85
 * while still matching the words "one extra tick every fourth".
 *
 * Offset by colonist id, so neither a hungry colony nor a dressed one moves in
 * unison.
 */
export function workTicks(sim: Sim, c: Colonist): number {
  const t = sim.tick + c.id;
  if (hungry(c) && !gate(t, HUNGRY_FACTOR)) return 0;
  return clothed(c) && gate(t, CLOTHED_FACTOR - 1) ? 2 : 1;
}

/**
 * The Bresenham gate: does the line at `rate` cross an integer between t and
 * t + 1? True for exactly `rate` of all ticks, evenly spread.
 *
 * Used at two rates and they mean different things: `HUNGRY_FACTOR` is the
 * share of ticks that *survive*, and `CLOTHED_FACTOR - 1` is the share that get
 * a *second* helping — which is why the clothed rate is the factor's excess over
 * one rather than the factor itself.
 */
function gate(t: number, rate: number): boolean {
  return Math.floor((t + 1) * rate) > Math.floor(t * rate);
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
