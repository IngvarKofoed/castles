import { countItems } from "../items";
import type { Sim } from "../store";
import { LIMIT_MAX, LIMIT_STEP, UNLIMITED } from "../tuning";

/**
 * Production ceilings: the brake on a workshop
 * (docs/specs/2026-09-07-production-control.md).
 *
 * A ceiling is one number per good in `sim.limits`, `UNLIMITED` by default:
 * "make this until N exist". It gates the two places new work *starts* — the
 * haul that feeds a workshop's input buffer (`generateHaulToInput`) and the
 * batch a workshop begins (`stepWorkshop`) — and nothing else. A batch already
 * milling finishes and delivers; a haul already walking arrives; nothing is
 * cancelled and nothing is dropped, so lowering a ceiling mid-flight settles
 * within one delivery rather than scattering goods on the ground.
 *
 * **Counted over every item of the type, wherever it is** — stored, on the
 * ground, carried. The player's question is "how many planks exist", and a
 * count that skipped carried items would flicker on and off as haulers walked.
 * The count drifting back below the ceiling restarts production with no
 * hysteresis band: generation is idempotent and a batch is fifty ticks, so
 * there is nothing to oscillate.
 *
 * Filters are the other half of production control and deliberately **not**
 * a brake: a stockpile's accept flags choose what it takes in, and a workshop
 * pulls its input from any stockpile regardless. To stop a good being made,
 * set its ceiling; to route it, set the filter.
 */

/** The ceiling on a good, or `UNLIMITED`. An unknown type has none. */
export function limitOf(sim: Sim, type: number): number {
  const limit = sim.limits[type];
  return typeof limit === "number" ? limit : UNLIMITED;
}

/**
 * The predicate itself, over numbers a caller already holds. Separate from
 * `atLimit` because counting is a walk of every item in the colony, and the
 * panel asks for the count and the verdict in the same breath — one walk, not
 * two.
 */
export function overLimit(limit: number, count: number): boolean {
  return limit !== UNLIMITED && count >= limit;
}

/** Is this good at or over its ceiling — so nothing new should start making it? */
export function atLimit(sim: Sim, type: number): boolean {
  return overLimit(limitOf(sim, type), countItems(sim, type));
}

/**
 * What the `setLimit` command will actually store: `UNLIMITED` for anything
 * negative, else a whole number in `0 .. LIMIT_MAX`. A non-number is refused
 * (`null`), so a malformed command changes nothing rather than writing `NaN`
 * into a save.
 */
export function clampLimit(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  if (value < 0) return UNLIMITED;
  return Math.min(LIMIT_MAX, Math.floor(value));
}

/**
 * Where one press of the panel's `−` (`dir` -1) or `+` (`dir` +1) lands, given
 * the current ceiling and how many of the good the colony holds.
 *
 * The landings are the whole of the control's feel, so they are pinned here
 * rather than left to the HUD: from unlimited, the first `−` lands on the
 * **current count rounded up to the step** — so "stop making this" is one
 * press, which is what makes a ceiling the same lever as a pause — and every
 * press after that moves by `LIMIT_STEP`; `+` past `LIMIT_MAX` returns to
 * unlimited, the top of the range; `−` stops at 0 and `+` at unlimited, both
 * returning the value they were given so the caller can disable the button.
 */
export function stepLimit(current: number, count: number, dir: -1 | 1): number {
  if (current === UNLIMITED) {
    if (dir > 0) return UNLIMITED;
    return Math.min(LIMIT_MAX, Math.ceil(Math.max(0, count) / LIMIT_STEP) * LIMIT_STEP);
  }
  if (dir > 0) {
    const next = Math.floor(current / LIMIT_STEP) * LIMIT_STEP + LIMIT_STEP;
    return next > LIMIT_MAX ? UNLIMITED : next;
  }
  return Math.max(0, Math.ceil(current / LIMIT_STEP) * LIMIT_STEP - LIMIT_STEP);
}
