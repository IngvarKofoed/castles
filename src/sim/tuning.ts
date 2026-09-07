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
 * repair > haul-to-site > haul-to-input > chop > mine > raze > terraform >
 * haul-to-store.** Buildings first because they are rarer and dearer; walls
 * ahead of general hauling so a drawn line visibly gets worked; mining beside
 * chopping, since both are raw material flowing in; raze below both so tearing
 * down never starves building up; terraforming is ground-keeping and outranks
 * only the tidying.
 *
 * **Repair sits directly after build-wall**, which is the whole of its
 * placement argument: a breach outranks hauling and chopping — the counterplay
 * to a monster is people, and it has to actually get people — but never an
 * active build that may be one segment from closing a ring.
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
  9, // Repair
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

// ------------------------------------------------------------------ threats
//
// The Wilds' numbers (docs/specs/2026-09-04-monsters.md). Two rules shape all
// of them: danger is a *when* as much as a *where* — a monster is only ever
// dangerous while prowling — and the orc/troll split is stats alone, so
// everything below comes in pairs rather than in kind-specific behaviour.

/**
 * How dense the wilds are. The lair pass places ~`LAIR_TARGET` dens on the
 * default map, no nearer to each other than `LAIR_SPACING`, with the chance of
 * any one tile taking a lair rising by radius — **there is no protected radius
 * around the start** (a deliberate call: the gradient is the only mercy, and a
 * rare hard start is part of the game). `LAIR_CLEAR_RADIUS` excludes the spawn
 * clearing itself, which is spawn sanity rather than safety.
 */
export const LAIR_TARGET = 25;
export const LAIR_SPACING = 10;
export const LAIR_CLEAR_RADIUS = 10;
/** How much of a centre tile's chance survives the radial gradient. Not zero:
 *  "rare but possible" is the promise, and zero would make it impossible. */
export const LAIR_INNER_WEIGHT = 0.05;
/** Weighted draws the pass may spend reaching `LAIR_TARGET`. Bounded so the
 *  pass always terminates, generously enough that spacing rejections near the
 *  outer band never cost the map its lairs. */
export const LAIR_ATTEMPTS = LAIR_TARGET * 12;
/** Chance a lair's monster is a troll, inside and outside the outer third.
 *  Orcs anywhere; trolls weighted outward, so the deep map hits harder. */
export const TROLL_CHANCE_INNER = 0.15;
export const TROLL_CHANCE_OUTER = 0.6;
/** Where the "outer band" starts, as a fraction of the island's half-width.
 *  Trolls and the prowl-share multiplier both key off it. */
export const OUTER_BAND = 2 / 3;

/**
 * A monster's hours. `restTicks` is drawn from two game-days ± `PERIOD_SPREAD`,
 * `prowlTicks` from half a day ± the same — per monster, at spawn, so no two
 * lairs tick in unison and each one's window is learnable on its own. The
 * outward gradient multiplies the prowl share: a monster at the island's edge
 * prowls up to twice as long as one near the middle.
 */
export const REST_BASE = 2 * DAY_TICKS;
export const PROWL_BASE = DAY_TICKS / 2;
export const PERIOD_SPREAD = 0.5;

/** Waypoints a prowl circuit visits, and how far from the lair they may sit. */
export const CIRCUIT_WAYPOINTS = 4;
export const ROAM_RADIUS = 12;
/** Draws a single waypoint may spend looking for standable ground before it
 *  falls back to the lair tile. Bounded, so the pass cannot hang on a den
 *  ringed by water. */
export const WAYPOINT_TRIES = 6;

/**
 * How far a prowling monster notices, in tiles, Chebyshev. An acquired target
 * then **holds** until it is broken — the wall dies, the colonist reaches
 * inside ground or passes `NOTICE_BREAK` × the range, or the prowl clock ends.
 * No per-tick nearest-swapping: a chasing orc does not abandon its victim for a
 * closer fence post.
 */
export const ORC_NOTICE = 8;
export const TROLL_NOTICE = 6;
export const NOTICE_BREAK = 1.5;

/** Orcs are fast enough to catch a fleeing worker; trolls are not, and never
 *  needed to be — they are the threat to the *race*, not to the crew. */
export const ORC_SPEED = 1.3 * WALK_TILES_PER_TICK;
export const TROLL_SPEED = 0.5 * WALK_TILES_PER_TICK;

/**
 * The bite: an orc takes `ORC_BITE` off a segment every second, a troll
 * `TROLL_BITE` every two. Against `PALISADE_HP` that is ~40 s of orc contact or
 * ~20 s of troll — long enough for a repairer working the inside face to
 * outlast a prowl, short enough that an unclosed push cannot be held.
 */
export const ORC_BITE = 1;
export const ORC_BITE_TICKS = 1 * TICK_HZ;
export const TROLL_BITE = 4;
export const TROLL_BITE_TICKS = 2 * TICK_HZ;

/** What a segment can take before it falls. Damageable states only: finished
 *  stone cannot be touched at all, and a blueprint is sticks — one bite. */
export const PALISADE_HP = 40;
export const GATE_HP = 60;

/** Repair: pool labour and **no materials at all** (docs/CONCEPT.md — the
 *  counterplay to a monster is people, and charging logs would double-price a
 *  breach). Applied as whole points on a cadence, so the layer stays integral. */
export const REPAIR_HP_PER_SECOND = 4;

/**
 * How near a monster has to be for a colonist on unsafe ground to drop
 * everything and run, and how deep the escape search looks for inside ground.
 * Bounded because the search is per fleeing colonist per repath, and because a
 * colonist forty tiles from any wall is not being saved by a longer look.
 */
export const FLEE_RANGE = 6;
export const FLEE_DEPTH = 48;

/** Catching means adjacent: same tile or a neighbouring one, Chebyshev. */
export const CATCH_RANGE = 1;

/**
 * The threat meter. It tracks the colony's most relevant monster within
 * `THREAT_RANGE` of the colony anchor, and shows it in `THREAT_BUCKETS`
 * segments — coarse on purpose. `RHYTHM_FUZZ` is the per-monster seeded error
 * on every rhythm estimate the player is shown: CONCEPT's rule is that
 * schedules show *approximately* and precision is buildable, so the base game
 * is honest about the rhythm and never exact about the minute. Watchtowers
 * narrow this and nothing else (4b).
 */
export const THREAT_RANGE = 40;
export const THREAT_BUCKETS = 5;
export const RHYTHM_FUZZ = 0.1;
