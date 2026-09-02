import type { TaskKindValue } from "./store";

/**
 * Every tunable number the labour loop spends, in one place.
 *
 * Durations are stated in seconds by the spec and converted here, so the
 * spec's numbers stay readable in the source: at TICK_HZ = 10 a "3 s chop"
 * is 30 ticks. Nothing outside this file may hard-code a duration.
 *
 * The `TaskKindValue` import above is **type-only on purpose**, and has to
 * stay that way: `store.ts` imports this file, so a value import would close a
 * cycle whose failure — `TaskKind` read in this module's body while `store.ts`
 * is still initializing — depends on which of the two a bundler loads first.
 * Type imports are erased, so nothing runs.
 */

/** Sim ticks per second of game time. The tick is fixed; speed multiplies it. */
export const TICK_HZ = 10;

/**
 * Ticks a single frame may run before it gives up and drops the rest. Guards
 * a suspended tab from waking into a thousand-tick catch-up.
 */
export const MAX_TICKS_PER_FRAME = 5;

/** Ticks per in-game day. Cosmetic this step: nothing simulates day/night. */
export const DAY_TICKS = 600;

export const STARTING_COLONISTS = 5;

/** Walk speed: 2 tiles/s. */
export const WALK_TILES_PER_TICK = 2 / TICK_HZ;

/** Chop 3 s, build 4 s, mill 5 s per plank. */
export const CHOP_TICKS = 3 * TICK_HZ;
export const BUILD_TICKS = 4 * TICK_HZ;
export const MILL_TICKS = 5 * TICK_HZ;

/**
 * Walls: a palisade segment is 2 s, a gate 6 s, tearing either down 1 s.
 * The gate costs more *labour* than a palisade and the same materials — one
 * log for any segment — because multi-log delivery to a grid tile needs
 * per-tile ledger bookkeeping the grid deliberately does not have. That
 * arrives with the stone tier, which needs it anyway.
 */
export const WALL_BUILD_TICKS = 2 * TICK_HZ;
export const GATE_BUILD_TICKS = 6 * TICK_HZ;
export const RAZE_TICKS = 1 * TICK_HZ;

/** Logs a wall segment costs. One, gates included — see above. */
export const WALL_LOG_COST = 1;

/**
 * The one fixed global order a pool worker works down: **build > build-wall >
 * haul-to-site > haul-to-input > chop > raze > haul-to-store.** Buildings
 * first because they are rarer and dearer; walls ahead of general hauling so a
 * drawn line visibly gets worked; raze below chop so tearing down never
 * starves building up; tidying last.
 *
 * The numbers are `TaskKind` values written out, because this file may not
 * import that enum as a value (see the header). They are type-checked against
 * `TaskKindValue`, so a number that is not a live kind fails to compile — and
 * `tasks.test.ts` pins the *order* by name, which is what catches a renumbered
 * enum rather than an invented one.
 */
export const TASK_PRIORITY: readonly TaskKindValue[] = [
  0, // Build
  5, // BuildWall
  1, // HaulToSite
  2, // HaulToInput
  3, // Chop
  6, // Raze
  4, // HaulToStore
];

/**
 * A task whose claim failed (no path) sleeps this long before anyone tries
 * again, plus a small seeded jitter so five colonists don't retry the same
 * unreachable target in lockstep forever.
 */
export const TASK_COOLDOWN_TICKS = 2 * TICK_HZ;
export const TASK_COOLDOWN_JITTER = TICK_HZ;

/** Stockpile: items per footprint tile. */
export const STOCKPILE_PER_TILE = 8;

/** Sawmill buffers. */
export const SAWMILL_INPUT_CAP = 2;
export const SAWMILL_OUTPUT_CAP = 2;

/** Tiles around the map centre generation keeps clear of trees, so the
 * opening view is buildable and the starting folk have room. */
export const SPAWN_CLEAR_RADIUS = 8;
