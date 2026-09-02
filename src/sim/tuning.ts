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
 * Quarrying one outcrop tile: 6 s of work for `MINE_ROCK` rock, and the ground
 * it stood on. Slower than a chop because the second reward is the point — an
 * outcrop mined out is stone *and* a flat build site.
 */
export const MINE_TICKS = 6 * TICK_HZ;
export const MINE_ROCK = 4;

/**
 * The mason: 6 s and `ROCK_PER_BLOCK` rock per block. The ratio is the stone
 * tier's cost dial — a segment costs one block whatever this says, so making
 * stone dearer means raising this (or `MINE_TICKS`), never the segment.
 */
export const MASON_TICKS = 6 * TICK_HZ;
export const ROCK_PER_BLOCK = 2;

/**
 * Terraforming: 3 s of pool labour per tile per height step, and **no
 * materials at all** (docs/CONCEPT.md — levelling is charged in people-hours,
 * which is the scarcest currency there is). A four-step drop is four of these.
 */
export const TERRAFORM_TICKS = 3 * TICK_HZ;

/** Heights terraforming and mining may leave a tile at. The world's shape is
 *  generation's job: no lowering into water, no raising into rock. */
export const GROUND_MIN = 2;
export const GROUND_MAX = 6;

/**
 * Walls: a palisade segment is 2 s, a wooden gate 6 s, and stone twice
 * either — the permanent tier is meant to be *slow*, which is what keeps the
 * palisade worth throwing up first. Tearing anything down is 1 s.
 *
 * A segment costs one item whatever its material (`WALL_ITEM_COST`), because
 * multi-item delivery to a grid tile needs the per-tile ledger the grid
 * deliberately does not have. The stone tier's real cost lives upstream
 * instead: `MINE_TICKS`, `ROCK_PER_BLOCK`, and the walk from the outcrop.
 */
export const WALL_BUILD_TICKS = 2 * TICK_HZ;
export const GATE_BUILD_TICKS = 6 * TICK_HZ;
export const STONE_BUILD_TICKS = 4 * TICK_HZ;
export const STONE_GATE_BUILD_TICKS = 12 * TICK_HZ;
export const RAZE_TICKS = 1 * TICK_HZ;

/** Items a wall segment costs: one log, or one block for stone. Gates
 *  included — a gate costs more labour, never more material. */
export const WALL_ITEM_COST = 1;

/**
 * The one fixed global order a pool worker works down: **build > build-wall >
 * haul-to-site > haul-to-input > chop > mine > raze > terraform >
 * haul-to-store.** Buildings first because they are rarer and dearer; walls
 * ahead of general hauling so a drawn line visibly gets worked; mining beside
 * chopping, since both are raw material flowing in; raze below both so tearing
 * down never starves building up; terraforming is ground-keeping and outranks
 * only the tidying.
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
  7, // Mine
  6, // Raze
  8, // Terraform
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

/** Workshop buffers — both workshops carry the same two-in, two-out shape. */
export const WORKSHOP_INPUT_CAP = 2;
export const WORKSHOP_OUTPUT_CAP = 2;

/** Tiles around the map centre generation keeps clear of trees, so the
 * opening view is buildable and the starting folk have room. */
export const SPAWN_CLEAR_RADIUS = 8;
