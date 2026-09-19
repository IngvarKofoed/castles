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
 * The bread chain (docs/specs/2026-09-08-bread-economy.md). A farmer raises a
 * grain every `FARM_TICKS` out of nothing but their hours — ~12 a game-day —
 * the mill grinds one grain into one flour, and the oven bakes one flour into
 * one loaf. One fully staffed chain feeds about twelve mouths; past that the
 * player adds a second farm, which is where the land pressure comes from.
 *
 * `MILL_TICKS_5B` is the *grain* mill, not the sawmill: `MILL_TICKS` above is
 * the plank cadence and predates it.
 */
export const FARM_TICKS = 5 * TICK_HZ;
export const MILL_TICKS_5B = 4 * TICK_HZ;
export const OVEN_TICKS = 5 * TICK_HZ;

/**
 * Eating (docs/specs/2026-09-08-bread-economy.md). A colonist is due a meal
 * every `MEAL_TICKS` — one game-day — and walks to the nearest free **food**
 * (`FOODS` in `goods.ts`: bread or cheese, nearest wins) to take it. From
 * `HUNGRY_TICKS` since their last meal with none found they work
 * and walk at `HUNGRY_FACTOR`, and **that is the entire penalty**: nobody
 * starves, nobody stops, nothing alerts (docs/CONCEPT.md — a supply failure
 * plateaus, it never spirals). Fleeing is exempt at full speed, because
 * threat-versus-flee speed is the game's central difficulty dial and an empty
 * larder must never quietly raise the death rate.
 */
export const MEAL_TICKS = DAY_TICKS;
export const HUNGRY_TICKS = (DAY_TICKS * 3) / 2;
export const HUNGRY_FACTOR = 0.6;

/**
 * Loaves a head the colony opens with — dropped in the clearing by `createSim`
 * and granted to a migrating save by the v8 rung, so a fresh colony and a
 * loaded one both have about three days before the first meal goes missing.
 * The cold start is the whole reason it exists: hunger must never bite before
 * the player could possibly have acted.
 */
export const PROVISION_BREAD = 3;

/**
 * The sheep chain and the game's first equipment
 * (docs/specs/2026-09-10-sheep-and-clothes.md).
 *
 * A shepherd raises a wool every `WOOL_TICKS` out of nothing but their hours
 * (the Farm's `per: 0` recipe, one chain over), the dairy turns one grain into
 * one cheese, the weaver one wool into one cloth, the tailor one cloth into one
 * garment. One tailor at 6 s a garment covers a colony of about fifteen —
 * demand is roughly 1.5 a day — so the chain's real price is its four slots
 * and the wool logistics, not the cadence.
 */
export const WOOL_TICKS = 6 * TICK_HZ;
export const DAIRY_TICKS = 5 * TICK_HZ;
export const WEAVE_TICKS = 4 * TICK_HZ;
export const TAILOR_TICKS = 6 * TICK_HZ;

/**
 * The drink chain (docs/specs/2026-09-14-hives-and-mead.md), and the game's
 * first rate that is a fact about **where a building stands**.
 *
 * A keeper alone makes a honey every `HIVE_TICKS` — three a game-day, against
 * the Farm's twelve grain — and the table below is what flower fields buy:
 * indexed by how many fields are in reach, 0 to `HIVE_FIELDS_MAX`, so a hive
 * among three fields makes ten a day. Integers throughout, and nothing is
 * scaled at runtime: the batch length is a table lookup, read at the
 * completion compare every tick.
 *
 * `HIVE_REACH` is a Chebyshev gap between **footprints**, not between origins,
 * and it is exactly the rectangle the placement overlay draws — the hive's plot
 * grown by six tiles on every side. Fields are never razed, so a rule that
 * disagreed with its own picture would be baked into a colony's honey rate for
 * good.
 *
 * `MEADERY_TICKS` is an ordinary one-in-one-out workshop cadence, in the band
 * the Oven and Dairy already sit in: honey is the scarce half of the chain, so
 * the brew is not where the pressure belongs.
 */
export const HIVE_TICKS_BY_FIELDS: readonly number[] = [20 * TICK_HZ, 12 * TICK_HZ, 8 * TICK_HZ, 6 * TICK_HZ];
export const HIVE_TICKS = HIVE_TICKS_BY_FIELDS[0];
export const HIVE_FIELDS_MAX = 3;
export const HIVE_REACH = 6;
export const MEADERY_TICKS = 5 * TICK_HZ;

/**
 * Equipment: how long a garment lasts, and what wearing one is worth.
 *
 * `CLOTHES_WEAR_TICKS` counts **down** on `Colonist.clothes` every tick, worn
 * — about ten game-days — and at zero the colonist is a tailor's customer
 * again. That wear clock is what makes clothes an economy instead of a
 * one-shot upgrade.
 *
 * `CLOTHED_FACTOR` is applied as a **cadence over whole ticks** exactly as
 * `HUNGRY_FACTOR` is, at the same three work accumulators: its excess over 1
 * is the rate at which a clothed worker gets an *extra* work tick, so 1.25
 * means one extra every fourth. The two gates **compose**, and the composition
 * is pinned rather than left to read two ways: the extra tick is granted only
 * on a tick the hunger gate already lets through, so clothed is ×1.25, hungry
 * ×0.6, and both together exactly ×0.75 (4 and 5 are coprime, so the
 * intersection is 3 ticks in 20 at every phase offset). Granting it
 * unconditionally would ship ×0.85 while still matching the words.
 *
 * Walk speed is untouched: that is **shoes**, a later rung and not designed.
 */
export const CLOTHES_WEAR_TICKS = 10 * DAY_TICKS;
export const CLOTHED_FACTOR = 1.25;

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

/**
 * Production ceilings (docs/specs/2026-09-07-production-control.md). A
 * ceiling is a **global per-good** number — "make planks until N exist",
 * counted over every plank anywhere — and `-1` means unlimited, which is the
 * default everywhere. `LIMIT_MAX` is the top of the settable range; the panel's
 * `+` past it returns to unlimited, and `LIMIT_STEP` is what one press moves.
 * Neither number is in any save: the ceiling itself is, the range is a tunable.
 */
export const LIMIT_MAX = 100;
export const LIMIT_STEP = 5;
export const UNLIMITED = -1;

/** Tiles around the map centre generation keeps clear of trees, so the
 * opening view is buildable and the starting folk have room. */
export const SPAWN_CLEAR_RADIUS = 8;

// ------------------------------------------------------------------ threats
//
// The Wilds' numbers (docs/specs/2026-09-17-incursions-from-the-sea.md). Two
// rules shape all of them: danger is a *when* as much as a *where* — nothing
// is on the map at all between incursions — and the orc/troll split is stats
// alone, so everything below comes in pairs rather than in kind-specific
// behaviour.

/**
 * The forecast, and the storm it counts toward.
 *
 * `STORM_INTERVAL` ± `STORM_JITTER` is the peace between incursions, drawn from
 * the store PRNG when the previous one ends — so the schedule is as replayable
 * as everything else, and a wall push has a window whose length is knowable
 * rather than guessed.
 *
 * **`FIRST_STORM` has a test-shaped floor under it and that is worth stating,
 * because it is invisible from inside the game.** The opening grace must outlast
 * the longest scripted run in the suite — `tick.test.ts` pins the labour loop
 * over 2.5 game-days and `threats/encounter.test.ts` runs four — or a landing
 * inside one of those turns a labour golden into a massacre. The encounter
 * schedules its own incursion deliberately instead of waiting for this clock.
 */
export const FIRST_STORM = 6 * DAY_TICKS;
export const STORM_INTERVAL = 4 * DAY_TICKS;
export const STORM_JITTER = DAY_TICKS;

/**
 * How long an incursion stays ashore before the storm passes and it turns for
 * the boats, and how long a monster that cannot reach them has before it is
 * removed wherever it stands.
 *
 * The backstop is the second clock, and it exists because the way home can be
 * walled off behind a monster: without it a badly timed wall leaves a permanent
 * resident inside the colony — the den problem reborn, indoors. It is
 * deliberately *longer* than the incursion, so a monster blinking out mid-map
 * is never the first thing a player sees.
 */
export const INCURSION_TICKS = DAY_TICKS;
export const WITHDRAW_BACKSTOP = 2 * DAY_TICKS;

/**
 * Strength: **how much land the colony has enclosed**, and nothing else
 * (docs/CONCEPT.md, pillar 2 — expansion is the risk). `INCURSION_BASE`
 * monsters land on a colony that has walled nothing; one more joins them per
 * `LAND_PER_MONSTER` tiles of enclosed land, up to `INCURSION_MAX`.
 *
 * `STORM_SEVERITY` is the seeded wobble either side of that, drawn with the
 * countdown when the previous incursion ends. The acreage itself is read at the
 * **landing**, never at the end of the previous storm: a monster sealed inside
 * a wall collapses the enclosure fill to zero (see `walls/enclosure`), so a
 * reading taken then would price the next storm off an exploit.
 */
export const INCURSION_BASE = 1;
export const LAND_PER_MONSTER = 250;
export const INCURSION_MAX = 8;
export const STORM_SEVERITY = 0.35;

/** The troll share of an incursion, at zero strength and at `INCURSION_MAX`.
 *  Trolls weight toward the bigger storms, so a grown colony meets the threat
 *  to the *race* rather than only the threat to the crew. */
export const TROLL_SHARE_MIN = 0.1;
export const TROLL_SHARE_MAX = 0.55;

/**
 * The margin on how far inland an incursion presses.
 *
 * The depth itself is the walk from the beach to the colony **plus the colony's
 * own reach** — the furthest enclosed tile from its centre — so an incursion
 * always arrives, and a colony that has walled more ground is walked further
 * across. That second term is why **depth still costs something**: without it a
 * single global strength dial would make a tile a hundred out exactly as
 * dangerous as one ten out, which quietly deletes CONCEPT's "danger scales
 * outward … the deep map is earned". This constant is only the slack on top,
 * covering the outskirts of a colony that has enclosed nothing yet.
 */
export const INCURSION_DEPTH = 24;

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
 * The forecast meter. One bar on one clock, shown in `THREAT_BUCKETS` segments
 * — coarse on purpose, and never a digit.
 *
 * `FORECAST_HORIZON` is how far ahead the colony reads the weather unaided: a
 * storm further off than this is simply "far off", with no bar to fill. CONCEPT's
 * rule is that schedules show *approximately* and precision is buildable, so
 * what a manned Watchtower buys is `WATCH_HORIZON` — sight of a landing on
 * covered coast from twice as far out — and `WATCH_BUCKETS` under it.
 *
 * **The two are paired with their bucket counts on purpose.** A horizon divided
 * by its buckets is the width of the finest thing the meter can say, and
 * `know.when` only reaches "any moment now" under about a third of a game-day —
 * so 1.5 days in fifths and 3 days in tenths both land at 0.3, and both can
 * therefore say it. Widen a horizon without moving its buckets and the meter
 * quietly loses its sharpest phrase.
 */
export const THREAT_BUCKETS = 5;
export const FORECAST_HORIZON = 1.5 * DAY_TICKS;
export const WATCH_HORIZON = 3 * DAY_TICKS;

/**
 * The Watchtower's two numbers.
 *
 * `WATCH_RANGE` is measured **from the tower tile to a stretch of coast**,
 * Chebyshev — a tower watches the sea, so siting one is the question *which
 * shore do I want warning of?* It was lair-anchored until the wilds stopped
 * living on the map (docs/specs/2026-09-17-incursions-from-the-sea.md,
 * docs/changelog/2026-09-09-watchtowers.md).
 *
 * `WATCH_BUCKETS` replaces `THREAT_BUCKETS` on a forecast whose landing sits on
 * covered coast, and `WATCH_HORIZON` replaces `FORECAST_HORIZON` with it. The
 * bar gets finer and arrives sooner; it never gets a digit.
 */
export const WATCH_RANGE = 24;
export const WATCH_BUCKETS = 10;

// ------------------------------------------------------------------ housing
//
// Population inflow (docs/specs/2026-09-07-housing-wanderers.md). Growth is
// placement-priced: a House adds beds, beds raise the cap, and while the
// colony sits under its cap wanderers walk in from the coast. Deaths open room
// the next arrival refills, which is what makes the population ratchet-free.

/** Beds one House carries. The cap is `STARTING_COLONISTS` plus the summed
 *  beds of every *active* House — derived per read, never stored. */
export const BEDS_PER_HOUSE = 2;

/**
 * How long after one arrival resolves — settled, died, or gave up — the next
 * countdown runs, ± `WANDERER_JITTER` drawn from the store PRNG. Half a game
 * day, so a house pays off inside the day that built it without arrivals
 * reading as a stream: one figure at a time, walking.
 *
 * A fresh colony (and a migrated save) starts at exactly `WANDERER_INTERVAL`
 * with no draw, and the clock only runs while the gate is open — under cap,
 * with a House standing and nobody in transit.
 */
export const WANDERER_INTERVAL = DAY_TICKS / 2;
export const WANDERER_JITTER = DAY_TICKS / 5;

/**
 * How long a wanderer who cannot reach their destination waits before leaving
 * — two game days, wherever they got stuck. They despawn in place with **no
 * grave**: they left, they did not die, and a grave is the game's only
 * obituary (docs/CONCEPT.md). Nothing queues and nothing alerts.
 */
export const WANDERER_PATIENCE = 2 * DAY_TICKS;
