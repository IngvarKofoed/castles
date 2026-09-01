/**
 * Every tunable number the labour loop spends, in one place.
 *
 * Durations are stated in seconds by the spec and converted here, so the
 * spec's numbers stay readable in the source: at TICK_HZ = 10 a "3 s chop"
 * is 30 ticks. Nothing outside this file may hard-code a duration.
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
