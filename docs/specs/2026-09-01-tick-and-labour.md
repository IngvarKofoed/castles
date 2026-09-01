# Tick + labour: the colony starts working

Build-order step 2 from `docs/ARCHITECTURE.md`: the fixed-tick simulation and
the labour model's first complete loop. Pool workers chop designated trees,
haul logs, and construct buildings; one sawmill with an assignable slot
worker turns logs into planks via filtered storage; the player gets their
first commands (designate, place, staff, pause, speed). Playable result: you
mark trees, place a stockpile and a sawmill, watch the colony build and run
them — and when you staff the sawmill, you feel the hauling pool shrink.

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
  Colonists keep previous and current tile positions; the renderer lerps by
  the accumulator fraction, so 10 Hz never looks like 10 Hz.
- **Commands at tick boundaries** (reuses). Player input becomes plain
  command objects (designate-chop, place-building, staff/unstaff) queued by
  the UI and applied at the start of the next tick — the seam ARCHITECTURE
  reserves for saves and replays. Determinism contract: same seed + same
  command log at the same ticks = the same colony, byte for byte.
- **Trees are a world layer baked into chunk meshes** (extends). `World`
  gains `treeMap: Uint8Array`; generation seeds forest patches with the same
  third-noise-channel pattern the rock outcrops use. The mesher bakes trunk
  and canopy boxes into the chunk geometry, so chopping a tree clears the
  cell, spawns a log item, and bumps `chunkVersion` — the dirty seam's first
  real customer. Trees block walking.
- **A\* on the tile grid** (reuses). 4-neighbour, water and trees
  impassable, height steps of ≤1 block climbable and ≥2 blocks cliffs.
  Repath when a step is blocked; no hierarchy until a profiler asks.
- **Reservation discipline** (new). Claiming a task reserves its item and
  its destination capacity via `reservedBy` fields on the entities,
  released on completion or cancellation. Named as a decision because
  two-haulers-one-log is the classic colony-sim bug class — it gets designed
  once here, not patched forever.
- **Filtered storage pull** (reuses the concept's Kubifaktorium model).
  Stockpiles carry per-type accept filters; the sawmill's input buffer
  generates haul tasks pulling accepted items from stockpiles or the
  ground, and its output is hauled away to any accepting stockpile.
  Buildings never hand items directly to each other.
- **Buildings bake into chunks; movers are dynamic** (new). Buildings change
  state rarely (blueprint → under construction → active), so they render
  like trees: baked into the chunk mesh, one `chunkVersion` bump per state
  change. Colonists, carried/ground items, and the placement ghost are the
  dynamic layer — small per-frame `InstancedMesh`es, colonist model ported
  from the mockup's folk (body + head + carry-box).
- **First `src/ui/` content: a plain-DOM toolbar** (reuses "plain DOM").
  Pause/speed, chop tool, place-stockpile, place-sawmill, and a
  staff/unstaff control on the sawmill. Picking raycasts the chunk meshes;
  because vertices are baked in world coordinates, hit position → tile is
  `floor(x), floor(z)` — no instance bookkeeping.

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

Task generation each tick, idempotent (nothing generates a duplicate of a
live task): a chop designation without a task gets one; a blueprint missing
materials gets one haul-to-site per missing unit; an active stockpile with
unreserved capacity plus a reachable unreserved ground/output item gets
haul-to-store; a staffed sawmill with input space and a stored log gets
haul-to-input; a fully-delivered blueprint gets build.

Pool workers claim the nearest available task in one fixed global priority
order: **build > haul-to-site > haul-to-input > chop > haul-to-store**
(construction first per the concept; feeding the mill beats felling more
trees; general tidying last). Claim → reserve → A\* walk → act → release.
Failure (path gone, item stolen, target invalid) releases everything and
returns the task to the queue with a short cooldown so it doesn't spin.

Slot worker: the staff command assigns the nearest idle pool worker to the
sawmill; they walk there and stay. With a log in the input buffer they
consume it and produce a plank after `MILL_TICKS`, into the output buffer.
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
on grass or sand, no trees, no water, no overlap — invalid placement shows
the ghost in red, exactly like the mockup's ring ghost language.

### Rendering and UI

The chunk path is untouched except the mesher reading `treeMap` and
buildings. The new dynamic layer (`src/render/movers.ts`) draws colonists
(ported folk boxes, lerped positions, facing from heading), ground and
carried items, and the placement ghost. The toolbar (`src/ui/`) is plain
DOM: pause/×1/×2/×4, chop tool, two build buttons, and a click-a-building
panel with staff/unstaff for the sawmill. Chop designation is click per
tree (drag-rectangle is later sugar); designated trees get a visible mark.
A starved blueprint surfaces only in its panel — "waiting for logs (0/2)"
— no alerts, no color changes; calm is the tone.

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
