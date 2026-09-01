# Tick + labour: the colony starts working

Build-order step 2 from `docs/ARCHITECTURE.md`: the fixed-tick simulation and
the labour model's first complete loop. Pool workers chop designated trees,
haul logs, and construct buildings; one sawmill with an assignable slot
worker turns logs into planks via filtered storage; the player gets their
first commands (designate, place, staff, pause, speed). Playable result: you
mark trees, place a stockpile and a sawmill, watch the colony build and run
them — and when you staff the sawmill, you feel the hauling pool shrink.

## Outcome

**What you get:**

- A working colony: five colonists who chop designated trees, haul logs,
  build what you place, and store goods — on a fixed, deterministic 10 Hz
  tick with pause and ×1/×2/×4 speed.
- The game's first real decision: staff the sawmill and one worker leaves
  the pool for as long as it's staffed — logs become planks, and hauling
  visibly thins.
- The styleguide HUD: ribbon readouts (logs, planks, folk, idle, day),
  build rail, inspector panels — all per `docs/STYLEGUIDE.md`.
- A sim store persistence can freeze as-is: plain data end to end,
  `structuredClone`-able, RNG state included.

**How to verify:**

- Designate a few trees and place a stockpile: workers chop, haul two logs
  to the site, build it, then haul the remaining logs into it — the whole
  chain visible without touching anything else.
- Place and staff a sawmill: one colonist walks in and stays, the ribbon's
  idle count drops by one, logs flow to its input, planks appear in its
  output and then in the stockpile, and the plank readout rises.
- Pause freezes the world; ×4 visibly speeds it up; the day caption
  advances as ticks pass.
- Run the golden test twice: same seed + same scripted command log gives a
  byte-identical store hash. `npm test` and `npm run lint` pass.
- The HUD matches `docs/STYLEGUIDE.md` at a glance: moss-glass panels,
  gold active tool, sage/rust labour meter, no alarm colors anywhere.

## Key decisions

- **Plain-object entity store** (extends). Colonists, items, buildings, and
  tasks are arrays of plain objects with numeric ids inside one `Sim` store
  next to `World` — the plain-data rule applied to entities. Typed arrays
  stay for grids. `structuredClone` must work on the whole store, because
  persistence lands next and freezes this shape.
- **RNG state is a stored number** (extends). The existing `mulberry32`
  closure hides its state, which the plain-data rule forbids; the sim keeps
  `rngState: number` and advances it through a pure `nextRand(state)` step
  so saves capture it. `sim/world/rng.ts` grows that form; the closure stays
  for non-sim callers.
- **Fixed 10 Hz tick, render interpolates** (reuses). An accumulator in
  `src/app/main.ts` runs `advanceTick(sim, commands)`; speed ×0/×1/×2/×4
  multiplies ticks per real second (pause is ×0, app-side, not a command).
  Colonists keep previous and current positions in **fractional tile
  coordinates**, advanced every tick along their path (0.2 tiles per tick
  at walk speed); the renderer lerps by the accumulator fraction, so 10 Hz
  never looks like 10 Hz.
- **Commands at tick boundaries** (reuses). Player input becomes plain
  command objects (designate-chop and cancel-designation, place-building
  and cancel-blueprint, staff/unstaff) queued by the UI and applied at the
  start of the next tick — the seam ARCHITECTURE
  reserves for saves and replays. Determinism contract: same seed + same
  command log at the same ticks = the same colony, byte for byte.
- **Trees are a world layer baked into chunk meshes** (extends). `World`
  gains `treeMap: Uint8Array`; generation seeds forest patches with the same
  third-noise-channel pattern the rock outcrops use. The mesher bakes trunk
  and canopy boxes into the chunk geometry, so chopping a tree clears the
  cell, spawns a log item, and bumps `chunkVersion` — the dirty seam's first
  real customer. Trees block walking.
- **A\* on the tile grid** (reuses). 4-neighbour; water, trees, and
  building footprints (blueprint or built) impassable; height steps of ≤1
  block climbable and ≥2 blocks cliffs. Repath when a step is blocked; no
  hierarchy until a profiler asks. Interaction is adjacency: hauling
  delivers from any tile adjacent to the footprint, and each building has
  one deterministic work tile (adjacent to the centre of its south edge)
  where the slot worker stands.
- **Reservation discipline** (new). Claiming a task reserves its item
  (`reservedBy` on the item) and one unit of destination capacity (a plain
  `reservedIncoming` counter on the building), both released on completion
  or cancellation. Named as a decision because two-haulers-one-log is the
  classic colony-sim bug class — it gets designed once here, not patched
  forever. Items stay entities everywhere: delivered construction
  materials and workshop buffer contents are items with
  `location: stored(buildingId)`, never bare counts — one representation
  for persistence to freeze.
- **Filtered storage pull** (reuses the concept's Kubifaktorium model).
  Stockpiles carry per-type accept filters; the sawmill's input buffer
  generates haul tasks pulling accepted items from stockpiles or the
  ground, and its output is hauled away to any accepting stockpile.
  Buildings never hand items directly to each other.
- **Buildings bake into chunks; movers and inventories are dynamic** (new).
  Building *structure* changes rarely (blueprint → under construction →
  active), so it renders like trees: baked into the chunk mesh, one
  `chunkVersion` bump per state change. The mesher's input widens from
  `World` to the sim — terrain grids plus a render-derived per-tile
  building index; buildings stay entities as the single truth, and no
  building grid enters the store. Colonists, carried/ground items, stored
  piles on stockpile tiles and buffer contents, and the placement ghost
  are the dynamic layer — small per-frame `InstancedMesh`es, colonist
  model ported from the mockup's folk (body + head + carry-box).
- **First `src/ui/` content, styled by `docs/STYLEGUIDE.md`** (reuses). The
  HUD is plain DOM in the styleguide's language — top ribbon, left build
  rail, right inspector — distilled from the approved visual mock the guide
  links; the builder copies its tokens and recipes, never invents visuals.
  Picking raycasts the chunk meshes; because vertices are baked in world
  coordinates, hit position → tile is `floor(x), floor(z)` — no instance
  bookkeeping.

## Goals

- The tick exists, is deterministic, and everything later hangs off it —
  pause and speed work, and a golden-master test replays a scripted command
  log to an identical store hash.
- The full labour loop runs: designate → chop → haul to site → build →
  store → mill → plank, driven entirely by the task queue.
- The pool/slot tension is real and visible: staffing the sawmill removes a
  hauler from the pool, and the colony's throughput changes.
- The store shape is complete enough that persistence (next step) freezes
  it without a migration.

## Non-goals

- Walls, palisades, enclosure, terraforming (step 3). Threats and the
  knowledge model (step 4). Saves (step 5 — but everything here must stay
  `structuredClone`-able).
- Colonist needs: no food, sleep, mood, or death. Colonists are tireless.
- No second workshop, no belts/carts, no per-colonist job-priority UI (the
  concept's priority lists come when there are enough task types to need
  them; step 2 uses one fixed global order).
- No animals, no birds — decorative life returns later.
- No demolishing of *active* buildings — blueprints can be cancelled, but
  a finished building is permanent this step.

## Design

### The tick

`src/sim/tick.ts` exports `advanceTick(sim, commands)`: apply queued
commands, then run systems in a fixed, documented order — task generation,
colonist behavior, workshop processing. The order is part of the
determinism contract. `TICK_HZ = 10`. The app loop accumulates real time ×
speed, runs at most `MAX_TICKS_PER_FRAME = 5` ticks per frame (tab-suspend
guard), and passes the leftover fraction to the renderer for interpolation.

### The store

```ts
interface Sim {
  world: World;              // + treeMap: Uint8Array
  tick: number;
  rngState: number;
  nextId: number;
  colonists: Colonist[];     // id, x/y + prev, role: pool | slot(buildingId),
                             // state, path, taskId, carryingItemId
  items: Item[];             // id, type: log|plank, location: ground(x,y) |
                             // carried(colonistId) | stored(buildingId), reservedBy
  buildings: Building[];     // id, kind: stockpile|sawmill, origin + footprint,
                             // state: blueprint|building|active, progress,
                             // delivered materials, filters / buffers, slotColonistId
  tasks: Task[];             // id, kind: chop|haulToSite|haulToStore|haulToInput|
                             // build, targets, claimedBy, state
}
```

Derived indexes (tile occupancy, ground-items-by-tile) are rebuilt at load
or on demand and never serialized — one source of truth in the store.
Colonist count at start: `STARTING_COLONISTS = 5`, spawned by the focus at
the map centre; generation keeps a tree-free radius there so the opening
view is buildable.

### Tasks and workers

Task generation each tick, idempotent — generation tops up so the live
tasks of a kind match the need, deduplicated by kind + target (live
haul-to-site tasks per blueprint equal its missing, unreserved units): a
chop designation without a task gets one; a blueprint missing materials
gets haul-to-site tasks; an active stockpile with unreserved capacity plus
an unreserved ground/output item gets haul-to-store; a staffed sawmill
with input space and an unreserved log — stored or on the ground — gets
haul-to-input; a fully-delivered blueprint gets build. Generation never
path-checks: reachability is discovered at claim time, a failed path
releases the task with the cooldown below, and a permanently unreachable
target just stays marked and quietly retries — an accepted step-2 limit.

Pool workers claim the nearest available task (Manhattan distance, ties
broken by task id — deterministic and cheap, no path-cost ranking) in one
fixed global priority order: **build > haul-to-site > haul-to-input > chop > haul-to-store**
(construction first per the concept; feeding the mill beats felling more
trees; general tidying last). Claim → reserve → A\* walk → act → release.
Failure (path gone, item stolen, target invalid) releases everything and
returns the task to the queue with a short cooldown so it doesn't spin.

Slot worker: the staff command takes the nearest pool worker — idle or
not; an interrupted task is released back to the queue — who walks to the
building's work tile and stays. With a log in the input buffer they
consume it and produce a plank after `MILL_TICKS`, into the output buffer.
Milling progress lives on the building, so unstaffing mid-mill loses
nothing: the consumed log's progress waits and resumes when restaffed.
They never take queue tasks — priorities stop applying to them, exactly as
CONCEPT.md's labour section demands. Unstaffing returns them to the pool.

Durations (one tunables block in `sim/tuning.ts`): walk 2 tiles/s, chop 3 s,
build 4 s, mill 5 s per plank.

### Content: trees, stockpile, sawmill

Forest patches: third noise channel on grass tiles (the rock-outcrop
pattern reused, own salt, threshold tuned to cover roughly 10–15% of
grass in clumps). The mesher adds a trunk box and one or two canopy boxes
per tree cell with the mockup's trunk/leaf palette and per-tile jitter.

Stockpile: 2×2 footprint, costs 2 logs, accepts logs and planks (filters
toggleable per type in its panel later; step 2 ships accept-all defaults
with the filter fields present in the store). Capacity: 8 items per tile
as a flat pile render.

Sawmill: 2×2 footprint, costs 4 logs, one slot, input buffer 2, output
buffer 2. Placement rule for both: footprint must be flat (same height),
on grass or sand, no trees, no water, no overlap with buildings, no ground
items — invalid placement shows the rust ghost per the styleguide's
overlay grammar. Colonists never block placement: the footprint turns
impassable on placement and anyone standing in it immediately paths to the
nearest free tile.

### Rendering and UI

The chunk pipeline keeps its shape; the mesher's input widens to read
`treeMap` and the render-derived building index, staying a pure, testable
function. The new dynamic layer (`src/render/movers.ts`) draws colonists
(ported folk boxes, lerped positions, facing from heading), ground and
carried items, and the placement ghost — overlay colors per
`docs/STYLEGUIDE.md`'s in-world grammar (sage valid, rust invalid, gold
designation).

The HUD (`src/ui/`, plain DOM, every visual token from
`docs/STYLEGUIDE.md`): the top ribbon carries the readouts — logs, planks,
folk, and the idle count, which is what makes the staffing trap visible —
plus the speed group (pause/×1/×2/×4) and a cosmetic day caption derived
from the tick counter (`DAY_TICKS` in tuning; no day/night simulation this
step). The left build rail holds the chop tool and the two build buttons;
the right inspector is the click-a-building panel with staff/unstaff for
the sawmill. Chop designation is click per tree (drag-rectangle is later
sugar); designated trees get a visible mark, and clicking a designated
tree again cancels it. The blueprint panel carries a Cancel action that
drops any delivered logs onto adjacent ground. A starved blueprint
surfaces only in its panel — "waiting for logs (0/2)" — no alerts, no
color changes; calm is the tone.

### Determinism

`rngState` in the store, fixed system order, commands applied only at tick
boundaries. The golden test: fixed seed, scripted command log (designate,
place, staff at set ticks), run N ticks, hash the store — byte-identical
across runs, and any future refactor that changes the hash has to explain
itself.

## Alternatives considered

- **Typed-array ECS for entities** — faster at a scale colony sims never
  reach; heavy ceremony for heterogeneous task data. Rejected for plain
  object arrays; the plain-data rule is served either way, simplicity wins.
- **Pool-only step 2 (no sawmill/slots)** — smaller, but persistence lands
  next and would freeze a store that has never seen a workshop, a recipe,
  or a buffer; and the game's core tension would not exist yet. Rejected.
- **Buildings and trees as dynamic instanced meshes** — a second render
  path for static world content the chunk pipeline already owns. Rejected;
  bake them, bump `chunkVersion`, and the dirty seam earns its keep.
- **Per-colonist priority lists now** — the concept wants them eventually,
  but with five task kinds and five colonists a fixed global order is
  indistinguishable in play and much less UI. Deferred.

## Implementation strategy

*Not part of the design — a starting point for whoever builds this.*

- **Single agent, Opus 5.** The biggest step so far, but one coherent
  thread: every piece — tick systems, tasks, mesher extension, movers,
  HUD — hangs off the same store types, so parallel streams would collide
  on `sim/` constantly. Build sim-first with the golden test early (it
  pins determinism before behavior grows), verify against the Outcome
  section at the end, browser checks included.
