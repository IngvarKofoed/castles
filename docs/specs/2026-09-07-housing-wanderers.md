# Housing and wanderers: the colony can grow

Step 5a: population inflow, the recovery loop the monsters step made
urgent. A House — built from planks, the sawmill's first real customer —
adds beds; while the colony's population sits under its cap (the starting
five plus total beds), wanderers arrive **by sea**, landing on a beach and
walking inland through whatever prowls between, settling as pool workers.
Growth is calm and placement-priced: build another house to grow. Food is
5b, which tightens this same gate to beds *plus* bread surplus — a
concept-level decision made in conversation and recorded here.

## Outcome

**What you get:**

- The colony can grow and recover: build a House (4 planks, 2 beds) and
  wanderers start arriving by sea, one at a time, walking in from a
  beach and settling as pool workers — deaths open room the next
  arrival refills.
- Planks get their first real purpose, pulling the log → plank chain.
- Arrivals as scenes, not popups: a figure lands on the sand, crosses
  the wilds past whatever prowls there, and the ribbon's new
  `folk N / cap` readout quietly ticks up when they make it.
- Failure stays calm: a wanderer caught by an orc dies like anyone
  (grave included); one who can't reach a bed waits at the coast two
  days and leaves — nothing queues, nothing alerts.

**How to verify:**

- Build and finish a House: within a couple of game-days a wanderer
  appears on a distant beach and — a further one to three game-days of
  walking later — reaches the house; the folk readout rises by one, and
  a second follows while beds remain.
- Fill the cap: arrivals stop. Lose a colonist to a monster: arrivals
  resume until the cap is met again.
- Wall the colony shut with no gate: the wanderer waits at the shore
  and is gone about two game-days later, no grave, no message.
- Load a v4 (or older) save: it plays unchanged, and building its first
  House starts arrivals. The scripted golden runs (a settling and a
  death en route) hash identically; `npm test` and lint pass.

## Key decisions

- **Cap-based beds, no homelessness** (new). Population cap =
  `STARTING_COLONISTS` + the summed beds of *active* Houses. Arrivals
  happen only under cap; nobody needs a bed to stay, houses only invite.
  No bed assignment, no homelessness mechanic — and a death frees room,
  so the colony can always recover, which is this step's whole point.
  Razing is not a thing for buildings (they're permanent per 3a), so the
  cap only rises; deaths are the only decrease in population.
- **Wanderers are colonists with a `dest` field** (extends). One new
  defaulted field on `Colonist`: `dest` — the destination House id while
  wandering, `-1` for everyone settled. No type puns in the save format.
  `dest ≥ 0` also excludes a colonist from **every selector that means
  "an available worker"** — `staff()`'s nearest-`slot < 0` pick
  foremost, which would otherwise bind a workshop to someone still
  walking in and strand `b.worker` on a dead id when they gave up. The
  known sites are the four readouts and `staff()`, but the **rule is the
  contract, not the list**: any selector, present or future, that means
  "available" must ask `dest < 0`.
  The whole 4a machinery — flee, death, graves, monster notice, gate
  passage — applies for free through a wanderer branch in
  `stepColonists` (walk, never claim tasks), which also preserves the
  tick contract: catches still test post-move positions. A wanderer
  counts in **none** of the four labour numbers — folk, pool, idle, and
  the meter's slots (computed as folk − pool) all exclude `dest ≥ 0`, or
  the meter invents a phantom slot worker. They settle (`dest = -1`,
  pool worker) on reaching any tile **adjacent to the destination
  House's footprint** — the `atStation` precedent, because a fixed work
  tile can be water or off-map for a slotless building.
- **Arrival by sea, near the door** (new, forced by geography). The
  island has no land edge, so wanderers land on a beach — destination
  first, then beach. The destination is the **lowest-id active House**
  (deterministic; no per-house occupancy exists, and the spawn guard is
  simply population < cap plus at least one active House). The landing
  tile is the **nearest eligible beach to that House** — sand,
  water-adjacent, outside any enclosure, and outside every *prowling*
  monster's per-kind notice radius at that tick. Nearest *minimizes* the
  trek — but honesty about the geometry: with the colony at the map
  centre every beach is ~110 tiles out, so an arrival is a one-to-three
  game-day journey whose **final approach** is the scene; the original
  "short walks" claim was false and is retracted (it also broke
  pathfinding — see the `ceiling` decision below). No eligible beach at
  countdown zero means retry next tick, drawing from the PRNG only when
  a spawn actually happens. One wanderer in transit at a time; the next countdown starts
  `WANDERER_INTERVAL` (± seeded jitter) after the last resolution
  (settled, died, or gave up).
- **Patience, not queues** (new — the no-spiral rule applied). A
  wanderer who cannot path to their destination — from the landing
  beach, or from wherever a closing wall sealed them mid-walk — runs the
  `WANDERER_PATIENCE` clock (2 game-days) **wherever they are stuck**
  and despawns in place, quietly, no grave: they left, they didn't die,
  and since graves are the game's only obituary, the missing grave is
  the tell. Nothing accumulates, nothing alerts; the next countdown
  starts as normal. The clock is a **named `patience` field** on
  `Colonist` — never an overload of `work`, whose meaning is
  task-progress and whose zeroing rides other systems' side effects; a
  field costs one migration line, a pun costs an invariant nobody wrote
  down.
- **`findPath` gains a visited `ceiling`** (extends — an engine change
  ratified from the build). Long open-ground routes plateau: every
  shortest path ties and A\* expands the whole band between the
  endpoints, so the ~110-tile beach walk measured 700–6300 visited nodes
  by seed — over `MAX_VISITED` (6000) on a third of seeds, making
  wanderers give up on routes that plainly existed. `findPath` takes an
  optional ceiling; only the wanderer repath passes one (island-wide).
  Every other caller keeps the default — tasks are local walkers; the
  wanderer is the one legitimately island-scale one.
- **The House** (extends `BUILDING_DEFS`). `BuildingKind.House = 3`
  (append), 2×2, no slot, `BEDS_PER_HOUSE = 2`. Built from **planks** —
  which requires the one structural change this step carries:
  `BuildingDef` gains `costType: ItemTypeValue`, and the hardcoded
  `ItemType.Log` in `freeCapacity`'s blueprint branch (and the
  haul-to-site sourcing behind it) generalizes to read the def.
  Existing defs say `costType: Log`; behavior is unchanged for them.
  Generalizing means **every** hardcoded Log dies, not just the obvious
  two: the blueprint-completion count in `actHaul` (left alone, a
  plank-fed House never flips to Building — delivered planks don't count
  as logs), `inspect`'s delivered count, the panel's "waiting for logs"
  wording, and the rail button's `${cost} logs` caption all read the
  def's `costType`.
- **Arrivals are silent** (reuses the calm doctrine). No toast, no
  banner: the ribbon's folk readout gains its `/ cap` suffix **once the
  first active House exists** — before that it stays a bare count, so a
  fresh colony never reads as "full" and an old, death-reduced save
  isn't teased with room nothing will fill. It ticks up when a wanderer
  settles; the wanderer walking up the beach *is* the announcement.
- **SAVE_VERSION 5, then a v6 rung for `patience`** (reuses the ladder).
  v5 shipped `BuildingKind.House = 3`, `dest = -1` on every colonist,
  and `wandererTimer` on `Sim` (the countdown is store state, or a
  reload would forget it mid-interval). The patience un-pun adds the
  named `patience` field on a **v6** rung (defaulted 0), returning
  `work` to its single documented meaning. Fixtures v1–v5 keep loading;
  a v6 fixture joins.

## Goals

- The population ratchet is gone: deaths open room the colony can
  refill, and growth is a placement decision (another house) rather
  than a score.
- Planks become a real economy: house-building pulls the sawmill chain.
- Arrivals are a scene, not a system popup — a small figure on the
  beach, a walk through the wilds, one more pair of hands at the end.
- 5b can tighten this gate to beds + bread without reshaping anything.

## Non-goals

- No food, hunger, or needs (5b). No emigration beyond the coast-side
  give-up; settled colonists never leave.
- No bed ownership, sleep, or homes-as-workplaces; the House has no
  slot and no panel actions beyond the standard blueprint/building
  states.
- No wanderer variety (skills, names, traits) — every settler is a
  standard pool worker.
- No multi-material building costs — `costType` is one type per def;
  mixed costs wait until a building actually needs them.

## Design

### Store, defs, migration

`Colonist` gains `dest: number` (−1 settled; a House id while
wandering) and `patience: number` (give-up ticks accumulated while
stuck; the v6 rung); `Sim` gains `wandererTimer: number` (ticks to the
next spawn attempt; −1 while one is in transit). `dest` and
`wandererTimer` default in the v5 migration, `patience` in v6. `BUILDING_DEFS` gains the House (2×2, 4 planks,
`hasSlot: false`, `beds: 2`); `BuildingDef.costType` lands with `Log` on
the three existing defs, and every hardcoded Log reads it instead:
`freeCapacity`'s blueprint branch, the site-sourcing in
`sim/labour/tasks.ts`, the blueprint-completion count in `actHaul`, and
the inspect/panel/rail-caption strings. Population cap derives per read
(`STARTING_COLONISTS + Σ beds of active Houses`) — no stored counter to
drift.

### The arrival loop

Movement lives where movement lives: `stepColonists` gains the wanderer
branch (`dest ≥ 0` walks toward the destination, never claims tasks), so
the existing flee check applies untouched and the tick contract holds.
`sim/settlers.ts`, stepped after monsters and before workshops, owns
only the bookkeeping: countdown, spawn, settle, give-up. When no
wanderer exists, population < cap, and an active House exists, the
persisted `wandererTimer` runs down; at zero it spawns per Key decisions
(lowest-id active House, nearest eligible beach to it), retrying each
tick without PRNG draws while no beach qualifies. (The beach's
outside-any-enclosure check is nearly vacuous — the flood flows through
sea from the map edge, so only a walled interior pond's shore can read
inside; it stays because it is one array read, and correctness by
accident is how regressions start.)

En route they are a colonist: monsters chase them, they flee — the
bounded BFS knows no inside tiles out there, so they run from the
monster and re-path when calm, and a fleeing wanderer heading for
inside ground may lead its orc straight to the gate approach, which is
emergent, consistent with colonist flee, and intended — and they die
like anyone, grave included; death resolves the attempt and the
countdown restarts. On reaching any tile adjacent to the destination's
footprint they settle: `dest = -1`, folk count rises, done. A wanderer
who cannot path — from the beach, or from wherever a wall sealed them
mid-walk — runs the patience clock in place and despawns there, no
grave. Repath attempts ride the existing claim-cooldown rhythm rather
than hammering A\* per tick.

### HUD and rendering

The folk readout gains its `/ cap` suffix once the first House is
active — the single visible HUD change; all four labour numbers (folk,
pool, idle, and the meter's slots) exclude in-transit wanderers.
The House bakes like any building (timber walls, plank door, the
palette's linen/timber tones; blueprint and under-construction states
per the existing grammar). Wanderers render as ordinary folk with the
carry-box drawn off `dest ≥ 0` (the carry prop currently keys on
`carrying` — the traveler's pack is the same box on a different flag);
no new model. The House panel is the standard building panel: name, state,
"beds 2" row. No new overlay, no new meter.

### Determinism and tests

The golden script gains: build a house, wait an interval, watch a
wanderer land, walk, settle, folk count rises — byte-identical; a
second run where the wanderer's walk crosses a prowl window and dies —
the encounter found by *seed selection*, not special spawning (the
monsters spec's method), and necessarily an **orc** seed: at half walk
speed a troll can never catch a walking wanderer. The drift test runs
through both. Cap
math is unit-tested (active-only houses count; blueprints don't).

## Alternatives considered

- **Food-gated growth now** — the concept's bread chain as the gate;
  deferred to 5b (three production nodes is its own step), which
  tightens this same gate rather than replacing it. Decided in
  conversation, recorded here.
- **Milestone/event arrivals** — population as reward for progress;
  rejected: growth should cost placement and resources, not score.
- **Bed assignment / homelessness** — per-colonist beds and housing
  needs; rejected for the cap model: bookkeeping without a decision
  behind it, and the calm tone has no room for "homeless" alerts.
- **A wanderer queue** — multiple simultaneous arrivals when many beds
  are free; rejected: one-at-a-time keeps arrivals a scene, keeps
  failure cheap, and can be lifted later by changing one guard.

## Implementation strategy

*Not part of the design — a starting point for whoever builds this.*

- **Single agent, Opus 5.** One thread: the `dest` field, the
  `stepColonists` wanderer branch, the settlers bookkeeping, the
  `costType` generalization (whose completion-count fix touches
  `actHaul`), the migration, and the HUD tweaks all share the store.
  Build the costType generalization + House def with its unit tests
  first (a plank blueprint must flip to Building), then the arrival
  loop with the two golden runs, then HUD and rendering; verify against
  the Outcome section at the end, browser checks included.

## Amendments

- **2026-09-07 — spec-issues round from the build.** Three defects: the
  "short walks near the colony" claim was geometrically false (every
  beach is ~110 tiles from the centre; arrivals are one-to-three-day
  journeys, retracted and restated) and had broken pathfinding —
  `findPath`'s new optional visited `ceiling`, added in the build for
  wanderer repaths only, is ratified as spec; wanderer exclusion from
  "available worker" selectors (`staff()` foremost) is now a stated
  rule, not an implied list, after a workshop bound itself to a walking
  wanderer; and the patience clock becomes a named `patience` field on a
  v6 rung — the spec's "one new field" constraint had forced an overload
  of `work`, the exact pun the same spec forbids.
