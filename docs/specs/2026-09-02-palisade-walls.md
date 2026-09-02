# Palisade walls and enclosure

Build-order step 3a: the expansion loop's first tier. The player line-drags
palisade runs; pool workers fetch logs and build the segments in place;
gates let colonists through while counting as wall to the world; a
flood-fill from the map edge computes inside/outside — the load-bearing
primitive threats will consume; dismantling recovers logs. Walls live in a
grid layer beside the terrain, not as building entities, and this is the
first change to ride the save-version ladder. Stone, the rock → block
chain, and terraforming are step 3b.

## Outcome

**What you get:**

- The game's core loop, playable: line-drag a palisade, watch workers
  fetch logs and raise it segment by segment, cut a gate for traffic, and
  see the ground inside become *inside* — then tear a stretch down, get
  the logs back, and redraw.
- Inside/outside as a real, visible fact: a keylined sage boundary (with a
  faint interior fill) over enclosed ground while a wall tool is active,
  and an "enclosed" count on the ribbon — the game's progress bar per
  CONCEPT.
- Old saves keep working: version-1 saves load into the walled world
  through the first real migration.

**How to verify:**

- Drag a wall line: valid segments ghost sage, an invalid tile ghosts
  rust and is skipped; on release, workers build the run one log at a
  time, and colonists path around finished segments but through gates.
- Close a ring around the colony with one gate: the wash covers the
  interior and the ribbon's enclosed count jumps; raze one segment and
  both revert; a blueprint-only ring encloses nothing.
- Raze a built stretch: logs drop on the ground and get hauled away;
  razing an unbuilt blueprint refunds instantly.
- Load a save from before this feature: it opens wall-less and working,
  and can immediately build walls. `npm test` and `npm run lint` pass.

## Key decisions

- **Walls are a grid layer** (new). `wallMap: Uint8Array` in `Sim`:
  structurally it follows `treeMap`'s per-tile-structure precedent, and it
  lives in `Sim` rather than `World` because it is player-made and the
  mesher already reads the sim. Values: none / palisade-blueprint /
  palisade / gate-blueprint / gate — consumed only through
  `isBlocking(state)` / `isWalkable(state)` predicates in `sim/walls/`, so
  the stone tier appends values without touching consumers. Dismantle
  designation is a second layer, `razeMap`, exactly on `chopMap`'s
  player-intent pattern. Chosen over per-segment `Building` entities: a
  castle is hundreds of segments, and the flood-fill, mesher, and
  pathfinder all read grids. Wall code lives in `sim/walls/` (the subtree
  `src/sim/CLAUDE.md` already names); ARCHITECTURE's repo-layout line
  moves "the enclosure test" there in the same stroke as its
  incremental-wording update.
- **New task kinds append; priority becomes a table** (diverges,
  deliberately). `TaskKind`'s numeric order doubling as the priority order
  was a step-2 convenience — but task kinds are serialized in saves, so
  *inserting* kinds would renumber every live task in every v1 save into a
  different meaning. `BuildWall` and `Raze` therefore **append** (5, 6),
  and priority moves to an explicit `TASK_PRIORITY` table in `tuning.ts`.
  The stone tier will add kinds again; this removes the bug class rather
  than patching its first instance.
- **SAVE_VERSION 2 — the first real migration** (extends). Old saves gain
  empty `wallMap`/`razeMap`/`insideMap`, and `decode` recomputes enclosure
  after migration so any migrated (or hand-edited) save is
  self-consistent. Task kinds need no migration because they append. The
  committed v1 fixture must keep loading, and a v2 fixture joins it. This
  is the migrations ladder doing its job for the first time.
- **Wall-building is a tile-targeted task; the log stays carried until
  completion** (extends the chop precedent). One task kind: claim → fetch
  the segment's log (ground or stored, the sawmill-input sourcing rule
  reused) → walk adjacent → work — still carrying — → at the completion
  instant, consume the log, set `wallMap`, bump the chunk version, flag
  the re-flood. Consuming *last* is load-bearing: every existing
  interruption path (abandon, the staff command grabbing the builder,
  eviction) already drops a carried item, so no delivery ledger exists and
  a cancelled blueprint's "refund" is simply the carried log falling where
  the builder stood. Blueprints are passable; a finished segment is
  impassable, and a colonist standing on a completing segment steps off —
  the building-placement rule reused.
- **One log per segment, gates included** (new, a deliberate
  simplification). Palisade: 1 log, 2 s. Gate: 1 log, 6 s — the cost
  difference is labour, not materials, because multi-log delivery to a
  grid tile needs per-tile ledger bookkeeping the grid deliberately
  doesn't have. Multi-log walls arrive with the stone tier, which needs
  that bookkeeping anyway.
- **Gates: passable to colonists, wall to the world** (new,
  concept-mandated). Pathing treats a gate as walkable; the enclosure fill
  treats it as blocking — otherwise a walled colony with a gate would
  never count as enclosed. "Closed" semantics wait for threats.
- **Enclosure: full flood-fill, recomputed only on wall events**
  (diverges from ARCHITECTURE's wording, deliberately). BFS seeded from
  every map-edge tile whose own state is non-blocking, flooding through
  every tile where `isBlocking` is false. At 256² a full BFS is
  sub-millisecond, so "incremental" is satisfied by *event-driven*: it
  runs at most once per tick, batching however many segments completed or
  fell that tick, and not at all on quiet ticks — behind an API a truly
  incremental version can later replace. `insideMap` is a `Sim` field like
  any other, serialized with the store per the persistence spec's
  no-special-cases doctrine (it is deterministic, so save-time and
  load-time content agree). ARCHITECTURE's "must be incremental" sentence
  gets updated to match as part of this change.
- **Line-drag placement** (extends the marquee input pattern). The wall
  tool previews an axis-aligned run from press to cursor (dominant axis),
  each segment's ghost sage or rust per the overlay grammar; release
  becomes one place-wall command carrying the run. Corners are composed
  from multiple drags. The gate tool places single tiles.
- **Dismantle reuses the designation grammar** (extends). The raze tool
  marks wall/gate tiles (click or marquee — the chop interaction reused);
  a raze task works the segment down and drops its log on adjacent ground;
  razing a *blueprint* cancels instantly and refunds any delivered log.
- **Enclosure is shown, calmly** (new). While a wall-family tool (wall,
  gate, raze) is active, enclosed ground gets a faint sage wash; no
  permanent tint — the world stays the hero. The builder adds the wash
  recipe to `docs/STYLEGUIDE.md`'s overlay grammar as part of this change.

## Goals

- The concept's core loop exists end to end: draw a wall, watch it get
  built, see the ground inside become *inside*, cut a gate, tear a stretch
  down and redraw it — all within the log economy step 2 already runs.
- The enclosure primitive is real, unit-tested, and exposed through
  `sim/know/` — threats (step 4) consume it without redesign.
- Old saves load: the migrations ladder carries v1 saves into the walled
  world.

## Non-goals

- No stone tier, no rock → block chain, no terraforming (step 3b).
- No wall hit points or damage — nothing exists to damage them; the field
  arrives with threats and its own migration, not speculatively now.
- No closed-gate mechanics, no auto-closing, no defense (step 4).
- No wall inspector panel — walls are grid tiles, not entities; the raze
  tool is their whole interaction surface this step.

## Design

### Store and migration

`WallState` as a frozen `as const` object (the `Terrain` pattern): `None`,
`PalisadeBp`, `Palisade`, `GateBp`, `Gate`. `sim.wallMap` and `sim.razeMap`
are `Uint8Array(size²)` next to `chopMap`. `SAVE_VERSION` bumps to 2 with
a migration that adds both arrays zero-filled; the v1 fixture test keeps
passing, and a v2 fixture is committed beside it.

### Placement

The wall tool's press–drag–release computes a straight run: dominant axis
of the drag, from the press tile to the cursor's projection on that axis.
Edge rules, pinned: a press that moves under the marquee's ~6 px threshold
places a single segment; a perfect diagonal breaks to horizontal; the run
clamps to the map bounds; and the axis re-evaluates live while the drag is
held, so the preview may flip between horizontal and vertical until
release.
Per-segment validity: on grass or sand, no tree, no water, no building, no
existing wall, no ground item — `canPlace`'s checks minus flatness, which
is moot for 1×1 (segments follow the terrain; height steps between
neighbouring segments are fine and look like real hillside palisades).
Invalid segments render rust and are skipped on release: the command
carries only the valid tiles, so one bad tile doesn't kill the run. The
gate tool is a single-tile click with the same validity; converting a
built palisade to a gate is raze-then-place, not a special case.

Placement writes blueprint states into `wallMap` at the tick boundary.
Blueprints stay passable — a long line must not wall its own builders off
halfway through construction.

### Tasks

Two new task kinds — **appended** to `TaskKind` (5, 6), never inserted,
because kinds are serialized in saves (Key decisions). Priority moves to
an explicit `TASK_PRIORITY` table reading: **build > build-wall >
haul-to-site > haul-to-input > chop > raze > haul-to-store** — buildings
still first (they're rarer and dearer), walls before general hauling so a
drawn line visibly gets worked, raze below chop so tearing down never
starves building up.

`build-wall(tile)`: fetch a log (unreserved, ground or stored — nearest),
carry it adjacent to the segment, work `WALL_BUILD_TICKS` (palisade) or
`GATE_BUILD_TICKS` still carrying it, then — at completion — consume the
log, flip `wallMap`, mark the chunk dirty, sweep any ground item off the
tile to the nearest free tile (the colonist-eviction rule, applied to
things), and flag the enclosure recompute. Task generation tops up one
task per blueprint tile, deduplicated by tile — the step-2 idempotence
rule extended to tile targets (chop already proves the shape).

`raze(tile)`: walk adjacent, work `RAZE_TICKS` (1 s for either kind —
tearing down is quick), clear the tile to `None`, drop one log via the
`dropTile` spiral starting at the razed tile itself (the chop precedent —
the tile has just become free), mark dirty, flag the recompute. On a
blueprint it applies instantly at task-generation time: the blueprint
clears, and any live `build-wall` task for that tile is abandoned through
the standard `abandonTask` path — which releases its reservations and
drops a carried log wherever the builder stands. That drop *is* the
refund; nothing else tracks delivery. `dropTile`'s spiral additionally
skips wall and wall-blueprint tiles, so refunds and chop drops can never
land where a wall is or will be — the completion sweep catches anything
older than the blueprint.

Reachability follows the existing rule: generation never path-checks;
claims that fail to path release with the cooldown. A segment nobody can
reach just stays a blueprint — the accepted step-2 limit, unchanged.

### Enclosure

`sim/walls/enclosure.ts`: `recomputeEnclosure(sim)` BFS-floods from every
non-blocking map-edge tile through every tile where `isBlocking` is false
(blueprints don't block; trees and water don't block — the wall is the
only safety technology, per CONCEPT). The definition, pinned once:
`insideMap[i] = 1` exactly when the tile was not reached *and* is not
itself a wall tile. It recomputes at most once per tick, batching that
tick's wall events (palisade built, gate built, either razed), and after
any decode. The ribbon's "enclosed" readout counts inside **land** tiles
only (grass, sand, rock — not water): buildable ground is the number the
whole game will eventually be about.

Pathing reads the same predicates: `passable` gains `wallMap` as an input
with the table stated once — `None`, `PalisadeBp`, `GateBp`, and `Gate`
walkable; `Palisade` not. The `occupancy` set stays buildings-only, so its
"footprint area stays tiny" rationale survives. Colonists already re-path
when a step is blocked (the step-2 A\* rule), which is what keeps walkers
from ghosting through a segment that finished across their precomputed
path. `sim/know/` exposes `insideLayer(sim)` and `isInside(sim, x, y)`.

Unit tests pin the semantics: a closed ring encloses its interior; a
one-tile gap leaks; a ring with a gate encloses; razing a segment
reopens; a blueprint ring encloses nothing; an enclosed pond's water is
inside but uncounted by the readout; a wall on a map-edge tile blocks
rather than seeds.

### Rendering and UI

Palisade segments bake into the chunk mesh — posts and two rails in the
timber palette with per-tile jitter. (Built from the palette, not a
recipe: the mockup's `fence()` at mockups/mockup3d.html:780 is a single
low pole — inspiration only — and the stockpile `deck()` in
`src/render/props.ts` shows how rails are assembled.) Gates are two heavier posts and a
lintel over an open gap. Blueprints bake as ghost-toned frames so a
planned line reads on the map. Raze-designated segments get the gold
base-mark + tint treatment designated trees already have.

The build rail gains Wall, Gate, and Raze tools below the existing three,
and the ribbon gains the "enclosed" readout. While a wall-family tool is
active, enclosure shows as a **keylined sage boundary line** traced along
the inside edge of the enclosing walls, plus a very faint interior fill —
boundary-first because the styleguide's own measurements say a faint sage
fill alone is invisible against grass, and sage already means validity on
the run ghost. Exact strengths are dialed by eye against real terrain;
the recipe lands in `docs/STYLEGUIDE.md` with this change. All three
tools obey the existing ladder: right-click/Escape drops the tool.

Two quiet-UX consequences are accepted deliberately, not overlooked. A
run released across an invalid tile builds a *gapped* wall: the tell is
the enclosure boundary refusing to appear and the enclosed count staying
put — intended, calm, revisited when the threat-era UI gives walls more
attention. And stalled wall blueprints have no panel to explain
themselves (walls are tiles, not entities); they sit as ghost frames
until logs exist or the player razes them — the same quiet voice as
everything else, accepted until walls earn an inspector.

One colonist edge case, accepted: a colonist can end up walled in with no
gate — by the player's drawing, or by the sim itself when the closing
segment's builder happens to stand on the inner side (the task system
picks the nearest adjacent tile, not the outside one; preferring outside
is real pathfinding complexity, rejected for now). Their task claims fail
to path and release; they idle inside until the player razes a segment or
places a gate. Fully reversible, no special handling.

## Alternatives considered

- **Segments as `Building` entities** — maximal reuse of the blueprint
  loop, but hundreds of 1×1 entities, per-segment panels, and `buildingAt`
  linear scans on every placement/path check. Rejected: walls are world
  structure; grids are what their consumers read.
- **Freeform paint placement** — flexible but produces ragged diagonals
  and accidental double rows; castle walls want straight runs. Rejected
  for line-drag.
- **True incremental flood-fill now** — ARCHITECTURE asks for it, but a
  full BFS at this map size is sub-millisecond and event-driven recompute
  meets the intent; the API leaves room. Doc wording updated instead.
- **Multi-log gates with per-tile delivery ledgers** — correct but drags
  building-style bookkeeping into the grid for one content item; deferred
  to the stone tier, which needs that machinery regardless.
- **Remapping task kinds in the v2 migration** — would fix the enum
  renumbering once, but every future kind insertion needs another remap
  and a live-task fixture; appending plus a priority table removes the
  bug class instead of patching its first instance.
- **Outside-preferring build positions** when a ring closes — rejected:
  real pathfinding complexity to avoid a rare, fully reversible
  inconvenience.

## Implementation strategy

*Not part of the design — a starting point for whoever builds this.*

- **Single agent, Opus 5.** One thread through the sim: the wall grid,
  predicates, tasks, enclosure, save migration, and the tools all share
  the store types and the priority-table refactor touches existing task
  code. Build `sim/walls/` + enclosure with its unit tests first (pure,
  fast feedback), then the migration + fixtures, then tools and
  rendering; verify against the Outcome section at the end, browser
  checks included.
