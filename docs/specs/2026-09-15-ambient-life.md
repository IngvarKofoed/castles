# Ambient life: sway, motes and wandering fauna

The world is still. Crops don't move, chimneys don't smoke, the Pasture's sheep
are baked into the ground they stand on, and a building under construction
looks exactly like one that isn't. This puts motion into the world in **three
classes with one rule between them** — sway (baked geometry displaced in place
by a shader), motes (instanced specks on a closed path around an anchor), and
fauna (creatures that walk, bounded to a home radius) — where the rule is that
**only colonists and monsters cross the map**. Everything added here is tied to
an anchor and stays near it, so "something is traversing open ground" keeps
meaning what it means today. Nothing here touches `src/sim/`.

## Outcome

**What you get:**

- The colony moves: crops and tree canopies sway, chimneys smoke, bees orbit
  the hives and flower fields, birds circle overhead, and sheep graze their pasture
  while deer roam the wilds.
- A monster crossing open ground is exactly as easy to pick out as before —
  nothing else added here travels.
- `prefers-reduced-motion` stills all of it, and leaves colonists and monsters
  moving.

**How to verify:**

- Watch a Farm and a wood: the crops and the canopies lean and settle, and the
  trunks, walls and roofs beside them do not move at all.
- Place a Hive with a flower field in reach and let both finish: each has bees
  of its own, orbiting within a tile or so and never crossing the ground
  between them; watch a pasture for a minute and no sheep crosses its fence.
- Let an orc prowl past a herd of deer: the deer carry on grazing.
- Pause the game: the world holds completely still — crops, smoke, bees and
  herds alike, and the water with them. Unpause at ×3 and all of it runs fast.
- Turn on reduced motion at the OS level and reload: the world holds still
  while colonists still walk and monsters still prowl.
- Save, reload, and confirm the save loads unchanged — no version bump, and the
  test suite's pinned hashes are all untouched.

## Key decisions

- **Three motion classes, and the boundedness rule that protects the map**
  (new). The game's entire threat toolkit is reading the map, and today the only
  things that translate across it are colonists and monsters — which is what
  makes translation itself legible as "alive and consequential". Every kind of
  motion added here is therefore **anchored**: sway displaces in place, motes
  orbit within a tile or two of a building, and fauna wander inside a home
  radius they never leave. A sheep does not leave its pasture and a deer does
  not cross the map. The classes are a vocabulary, recorded in
  `docs/STYLEGUIDE.md`, so the next thing that moves picks one rather than
  inventing a fourth.
- **Nothing enters the sim, and no hash moves** (reuses). Every anchor is
  something `sim/know` already exposes — buildings, their `progress`, the
  terrain, the world seed — and all animation state is renderer-owned. No
  `SAVE_VERSION`, no migration, no fixture, and **not one pinned golden hash
  moves**, which for a change this size is the property worth protecting above
  all others. `src/sim/` is not edited.
- **Sway is a vertex attribute, and the pattern already exists** (reuses). The
  mesher hand-builds each chunk's `BufferGeometry` and already carries a second
  per-vertex float beside the colours — `blockY`, emitted per box in `emitBox`
  and bound as `aBlockY` in `chunks.ts`. `aSway` is a literal copy of that,
  down to the per-box mask. High on crop, bloom and tree-canopy boxes, zero on
  trunks, walls, buildings and ground; a shader injection displaces by
  `sway × sin(world position, uTime)`. Swaying by world Y instead would have
  been free and wrong: it would wave the tops of walls and roofs. The injection
  is **unconditional on the `cozify` path**, so every cosy material keeps one
  compiled program and `customProgramCacheKey` stays `"cosy"` — geometry with
  no `aSway` reads 0, exactly as `materials.ts` already documents for the
  colour attribute.
- **`uTime` is the water's clock, reused** (reuses). `waveTime`
  (`materials.ts:110`, driven at `main.ts:779`) is already a shared ticking
  uniform, so sway costs no new plumbing and is stilled by the same flag.
- **Motes are closed-form, never stateful — which is not the same as simple**
  (new). A mote's position is a pure function of `(anchor, index, time)`:
  nothing is integrated frame to frame, nothing is saved, and a load or a
  tab-wake places them correctly with no catch-up. What that rule does *not*
  ask for is a single frequency, and a single frequency is what reads as
  machinery — a path that repeats exactly. Every mote is therefore built from
  terms whose frequencies are **incommensurable**, so the path never closes;
  the water shader is the precedent, three sines at 1.10, 0.80 and 0.6. Phase
  and frequency offsets per mote come from `hash`, which `render/` already
  imports. Chaos does not need state.
- **Fauna reopen the wander machine, deliberately** (diverges). `props.ts:403`
  states that "the sheep are static props, never entities … renderer-owned
  animation state is a door this step does not open", closing it in
  `docs/changelog/2026-09-11-sheep-and-clothes.md`, whose slug this change
  reverses and must name. This opens it. What kept it shut was scope,
  not principle, and the boundedness rule above is what makes it safe to open:
  the mockup's machine — walk to a target inside a home radius, graze for a
  random pause, pick another — is reinstated with the radius as the load-bearing
  part rather than a detail.
- **Fauna do not notice monsters** (new). A deer grazing near an orc is a
  little odd; a deer that scatters is **free information**, and CONCEPT is
  emphatic that information is infrastructure bought with people — watchtowers
  are a pair of hands. Wildlife that telegraphs a prowler undercuts the one
  mechanic the game sells knowledge through. Recorded so it is not added later
  as an obvious polish.
- **Ambient motion runs on the world's clock, not the wall clock** (diverges).
  All three classes are driven by game time: at ×0 everything ambient stops, at
  ×3 it runs faster. **The water changes to match**, which is the divergence —
  it runs on real time today and would otherwise be the one thing still moving
  in a paused world. Pause is exactly when a player stops to read the map, and
  a pause whose only motion is the motion that does not matter inverts the
  boundedness rule at the worst possible moment.
- **Reduced motion stills everything ambient, and nothing else — through an
  amplitude uniform, not the clock** (extends). `still` (`main.ts:764`)
  currently freezes only the water, by holding `waveTime` at 0. Sway cannot be
  stilled that way: at `uTime = 0` its two-sine is a *fixed non-zero* number,
  which would leave a forest permanently leaning. Sway therefore takes a
  `uSwayAmp` uniform that goes to 0, which is the rest pose; motes hold and
  fauna stand. Colonists and monsters keep moving, because they are the game
  rather than its decoration — a player who asks for less motion is not asking
  to stop seeing the orc.
- **Population is bounded by the camera, not the map** (new). Motes and fauna
  are populated only for anchors within a radius of the camera focus, so cost
  tracks what is on screen rather than what is on a 256² island. Each gets an
  instanced layer with a cap like every other layer in `movers.ts`.

## Goals

- The colony reads as inhabited: things sway, burn, buzz and graze.
- A monster crossing open ground is exactly as easy to spot as it is today.
- The motion has a vocabulary a future feature can join rather than extend
  ad hoc.

## Non-goals

- Any sim behaviour. Fauna are not entities, cannot be hunted, herded, eaten,
  killed or counted, and nothing in `sim/` learns they exist. The Pasture still
  makes wool from a shepherd's hours.
- Fauna reacting to anything — monsters, colonists, weather, time of day.
- Weather, seasons, or a day/night cycle. The sun slider is a mockup fossil and
  stays one.
- New colonist animation — no hammer swings, no walk cycle.
- **Construction.** A site that visibly rises is *information* rather than
  ambience — it is the number the panel already prints, drawn in the world —
  and it is none of the three classes here: it is state-driven geometry keyed
  to `progress`. It also needs a decision this spec does not make, about the
  plate, four corner stakes and timber half-body `buildingBoxes` already bakes
  at Blueprint and Building. Its own spec, so the vocabulary written into the
  styleguide here does not ship with an exception beside it.
- Sound.

## Design

### Sway

`Box` gains a sway field beside the `shade` and `jx/jz` it already carries, and
`emitBox` writes `aSway` per vertex exactly as it writes `aBlockY`. It is set on
the **canopy** boxes of all three tree styles — three for the pine, two for the
round tree, both of the bush, which has no trunk — and on the Farm's crop
furrows and the Flowers' blooms; zero on trunks, walls, buildings and ground.

**The weight is per vertex, not per box**, and that is the load-bearing part:
it is the box's weight multiplied by the same top-vertex mask `emitBox` already
computes for `aBlockY`, so the bottom of a box does not move and the top does.
Without the mask every furrow ridge and every bloom slides bodily sideways and
a bloom head detaches from its stem; with it, a tree bends its head and keeps
its feet *within* a box as well as between boxes.

The injection is on the `cozify` path so the contact shading is untouched, and
displaces `transformed.xz` by `uSwayAmp × sway × sin(world position, uTime)`.
Amplitude is well under a tile: a lean, not a sweep.

Two consequences, both accepted. Chunk rebuilds are unaffected — the attribute
bakes once with the rest of the chunk and the motion is entirely in the vertex
shader, so a swaying chunk costs what a still one costs. And **sway does not
reach the shadow map**: chunk meshes cast and receive shadows, the depth
material carries no injection, so a swaying canopy casts a still shadow. At
this amplitude, from this camera, it is not visible; it is recorded so nobody
hunts it as a bug.

### Motes

One instanced layer for each kind, drawn in `movers.sync` beside the existing
ones, with positions written per frame from a closed form:

- **Bees** around Hives and Flowers: a few specks per anchor that **hover,
  dart, and hover again** within a tile or so of the building. A bee's segment
  index is `floor(time × rate + phase)`, its two endpoints are hashed from that
  index, and it eases between them and then holds — so the flight is piecewise
  and unpredictable while still being a pure function of time, with nothing
  integrated and nothing to catch up after a reload. Rate and phase come off
  the mote's index, so four bees on one hive are never in step. A smooth orbit
  was what shipped first and it read as machinery: a bee does not fly in
  circles. Only while the building is `Active`.
- **Smoke** from the workshops that burn — the Oven's chimney first, and any
  workshop with a fire. A puff rises, drifts and **shrinks to nothing** over a
  fixed period, its phase a function of index; the column is three or four
  puffs, not a particle system. Shrink rather than fade, because a `Layer`
  carries one opacity for the whole mesh and `put` exposes a matrix and a tint
  and nothing else — fading one instance would mean the first non-`put`
  material in `movers.ts`, which is not worth a puff of smoke.
- **Birds** over the colony: a small flock on a wide slow circuit that
  **breathes** — two slow terms swell and shrink its radius and tilt its plane,
  at frequencies incommensurable with the circuit's own, and each bird drifts a
  little within the formation on a third. The flock stays a flock and the
  circuit stays a circuit; it is simply never twice the same. Deliberately much
  calmer than the bees: a circling bird is the one thing here that is meant to
  read as unhurried. High enough never to be mistaken for anything on the
  ground. Its centre is the **first of
  these that exists**: the centre of enclosed ground, else the centroid of the
  buildings, else the centroid of the folk — and with none of the three, no
  flock flies. The fallback is not defensive coding: `enclosed` is
  `enclosedLand(sim)` and reads 0 until a wall actually closes, which is the
  whole early game and every committed fixture, so a flock anchored on it alone
  would be absent exactly when the Outcome promises birds overhead.

Each is sized in tiles and stays there. A bee never leaves its hive's
neighbourhood; the flock's circuit is centred and does not migrate. **The smoke
and bee layers set `castShadow = false`** — `solidLayer` turns it on, and a
shadow-casting puff of smoke is wrong. The flock's centre is cached and
refreshed when enclosure changes, never recomputed per frame: it is a scan of a
65,536-tile layer.

### Fauna

A small module owns the wander state: for each anchor, a set of creatures with
a position, a heading, a target and a timer. The loop is the mockup's, which
`docs/ARCHITECTURE.md` records: walk toward a target inside the home radius,
graze for a random pause, pick another target. Legs swing while walking, heads
dip while grazing; the group turns to face its heading, and every model is
built facing `+z` so heading is `atan2(dx, dy)`.

Two anchors to start:

- **Sheep** in an **Active** Pasture: home radius is the footprint, so they
  mill inside their own fence and the fence is the promise. The baked sheep
  props come out of `pasture()` as they go in as fauna — the pasture keeps its
  fence and turf — and a blueprint or half-built pasture has no flock, exactly
  as it has no baked sheep today.

  **The footprint is not all walkable.** `pasture()` stands the shepherd's hut
  in the south-east corner — a 1.0-tile body under a 1.16-tile roof — so the
  home needs a **keep-out square around the hut** that both targets and derived
  starting offsets step around, or sheep walk into it and behind it. The baked
  flock this replaces was hand-placed clear of that corner; the rule was in the
  placement rather than written down, and it is written down now. Any future
  anchor whose footprint carries a prop needs the same treatment.
- **Deer** in the wilds: a home radius of a few tiles around a point chosen
  from the world seed and the terrain, on grass, outside any enclosure. They
  refuse targets on enclosed ground — and **when a herd's home stops offering
  any legal target, it re-homes outward**, deriving a new point further from
  the colony centre and drifting there. That case is reachable by ordinary
  play: homes are derived once and enclosure grows wherever the player builds,
  so a wall closing round a herd is a matter of time. Refusing without
  re-homing is precisely `docs/ARCHITECTURE.md`'s Gotcha 8 — the mockup's deer
  rejected every roam target and froze on their home tiles. The mockup re-homed
  when a ring went up; there are no rings here and no event that says the
  enclosure grew, so the trigger is the herd's own failure to find a target
  rather than a notification.

**Initial placement is derived, not stored.** A creature's home and its
starting offset come from a hash of the anchor's tile index and the world seed,
so a load, a tab-wake or a renderer rebuild puts them in the same places
without anything being saved. The wander state itself is transient and nobody
misses it: an animal that was mid-stride before a reload is mid-stride
somewhere else after it, and no rule anywhere depends on where.

**But state is kept when an anchor leaves the camera radius, not discarded** —
updating stops, the state stays. Re-deriving on re-entry would teleport a flock
every time the player pans away and back, which is far more visible than the
reload case the paragraph above argues from.

Integration uses the frame loop's **already-clamped `dt`** (`main.ts:775`,
`Math.min(0.1, …)`), so a tab that wakes owing ten seconds does not teleport a
herd across its pasture. The closed-form argument covers motes; fauna integrate
and so need the clamp.

### What `sync` does not receive today

`movers.sync` takes `(alpha, ghost, showEnclosure, reach, box)`. The three
classes need four things it has no access to: the **elapsed time** and the
frame's **`dt`**, the **camera focus** that bounds population, and the
**`still`** flag, which is a module-local const in `main.ts`. All four are
passed in; `still` in particular has to leave `main.ts`, since the renderer is
where it now means more than one thing.

### Budgets

Each new layer takes a cap in the `movers.ts` idiom. Past its cap `put`
silently early-returns and the instance is dropped, which is the right failure
for ambience and deliberately *not* the refuse-whole rule that file documents
for overlays making a claim about reach: a missing bee says nothing false,
whereas half a watch square does.

### Before this is called done

`src/render/CLAUDE.md` mandates a dev-server screenshot pass and a console
check for WebGL and three.js warnings before any visual change is reported
complete, and mandates re-reading `docs/ARCHITECTURE.md`'s Gotchas first. That
list is not decoration here: **Gotcha 8 is this exact machine** — the mockup's
deer keep-out test used `inOct(ringR + 2)`, rejected every roam target, and
froze every deer on its home tile.

### The styleguide

`docs/STYLEGUIDE.md` gains a short **Motion** section under Tone, stating the
three classes, the boundedness rule and what `prefers-reduced-motion` stills.
The existing line — "No animation except what physically moves in the world" —
is what licenses all of this and stays exactly as it is; the new section is
what stops the next moving thing from being invented from scratch.

## Alternatives considered

- **Fauna as sim entities.** Deterministic, saveable, able to react — and
  costing a save version, a migration, tick time and a moved hash for
  decoration that changes no decision. The labour model has no room for them
  and determinism makes them expensive; the whole point is that they are
  scenery.
- **Sway by world height** rather than a vertex attribute. Free, and it waves
  the tops of walls and roofs.
- **A particle system** for smoke and bees. The closed form is smaller, has no
  state to rebuild on load, and cannot drift out of sync after a suspended tab.
- **Letting fauna scatter from monsters.** The single most attractive thing
  here, and rejected on the concept: it is early warning nobody paid a pair of
  hands for.
- **Ambient motion on real time**, as the water runs today. It keeps the world
  alive while paused — and pause is the one moment when the only things moving
  would be the ones that do not matter, which is the boundedness rule standing
  on its head. Rejected, and the water is brought onto the world clock with
  everything else.
- **Deer that simply refuse enclosed targets**, with no re-homing. One line
  shorter and it is ARCHITECTURE's Gotcha 8 with the serial numbers filed off:
  a herd walled in stands frozen on its home tile for the rest of the game.
- **Unbounded roaming** — deer that cross the island. It is what the wilds
  would really look like, and it puts non-threats in motion across open ground
  in a game that reads threat by exactly that signal.

## Implementation strategy

*Not part of the design — a starting point for whoever builds this.*

- **Single agent, Opus 5, as three changes in sequence**, each landing with its
  own changelog entry: **sway** (`Box`, `emitBox`, `chunks.ts`, `materials.ts`
  — plus moving the water onto the world clock, which is the smallest place to
  prove that rule), then **motes** (two or three layers in `movers.ts` and the
  plumbing `sync` is missing), then **fauna** (a new module, and the baked
  sheep coming out of `pasture()`). They share a vocabulary and almost no code,
  and each is separately visible in a screenshot — which is the point, since
  every one of them needs the renderer subtree's mandated visual pass before it
  can be called done.
- Opus rather than Sonnet because the judgment is concentrated and unforgiving:
  a per-vertex sway mask that is wrong detaches blooms from stems, and the
  fauna re-homing rule is the one place this design can deadlock.
- Not multi-agent: the three stages are sequential by dependency — the world
  clock lands in stage one and both later stages read it — and a fan-out would
  put three agents in `movers.ts`.
- Not ultracode: nothing enters `src/sim/`, no save version, no migration, and
  no pinned hash moves, so the whole change reverts cleanly.

## Amendments

- 2026-09-16 — Three build findings folded back, all spec defects the build
  resolved as now written. The Outcome had bees "working between" a hive and a
  field while the Design gave each anchor its own orbits — commuting bees would
  have broken the boundedness rule this spec is built on, so the Outcome is
  corrected to the Design. The Fauna section gave "the footprint" as the sheep's
  only bound, but `pasture()` stands the shepherd's hut inside it; a keep-out
  square around the hut is now stated, along with the general rule for any
  anchor whose footprint carries a prop. And the bird flock was anchored on the
  centre of enclosed ground, which is 0 for the whole early game and every
  fixture: the centre is now the first of enclosed ground, the buildings'
  centroid or the folk's, with no flock when there is none of the three.
- 2026-09-16 — Bees and birds stop flying perfect circles. The closed-form
  decision stands and is sharpened: it never asked for a *single frequency*,
  and a single frequency is what reads as machinery, since the path repeats
  exactly. Bees now hover-dart-hover between hashed endpoints on a segment
  index derived from time; the flock's circuit now breathes, its radius and
  tilt modulated at incommensurable frequencies with a per-bird drift on top.
  Both remain pure functions of `(anchor, index, time)` — nothing integrated,
  nothing saved, a reload still correct.
