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
- **Sway is a vertex attribute, not a height rule** (new). The mesher writes a
  per-vertex `sway` weight alongside the vertex colours it already writes —
  high on crop boxes and tree-canopy boxes, zero on trunks, walls, buildings
  and ground — and a shader injection displaces by `sway × sin(world position,
  uTime)`. Swaying by world Y instead would have been free and wrong: it would
  wave the tops of walls and roofs. `cozify`'s `customProgramCacheKey` gains
  the variant so a swaying material never shares a compiled program with a
  still one.
- **`uTime` is the water's clock, reused** (reuses). `waveTime`
  (`materials.ts:110`, driven at `main.ts:779`) is already a shared ticking
  uniform, so sway costs no new plumbing and is stilled by the same flag.
- **Motes are closed-form, never stateful** (new). A bee's position is a pure
  function of `(anchor, index, time)` — an orbit with a bob — and so is a smoke
  puff's rise and a bird's circuit. Nothing is integrated frame to frame,
  nothing is saved, and a load or a tab-wake places them correctly with no
  catch-up. This is the mockup's chimney-smoke trick generalised.
- **Fauna reopen the wander machine, deliberately** (diverges). `props.ts:341`
  states that "the sheep are static props, never entities … renderer-owned
  animation state is a door this step does not open", closing it for
  `2026-09-10-sheep-and-clothes`. This opens it. What kept it shut was scope,
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
- **Reduced motion stills everything ambient, and nothing else** (extends).
  `still` (`main.ts:764`) currently freezes only the water. It comes to mean
  *all three classes*: sway stops, motes hold, fauna stand. Colonists and
  monsters keep moving, because they are the game rather than its decoration —
  a player who asks for less motion is not asking to stop seeing the orc.
- **Population is bounded by the camera, not the map** (new). Motes and fauna
  are populated only for anchors within a radius of the camera focus, so cost
  tracks what is on screen rather than what is on a 256² island. Each gets an
  instanced layer with a cap like every other layer in `movers.ts`.

## Goals

- The colony reads as inhabited: things grow, burn, buzz, graze and get built.
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
- New colonist animation — no hammer swings, no walk cycle. Construction is
  told by the site, not by the builder.
- Sound.

## Design

### Sway

`mesher.ts` writes a `sway` float per vertex beside the colour it already
writes: `1` on the three canopy boxes of `treeBoxes` (`props.ts:150–157`), `1`
on the Farm's crop furrows and the Flowers' blooms, `0` on everything else
including trunks. The material's injection, on the `cozify` path so the contact
shading is untouched, displaces `transformed.xz` by a two-sine function of world
position and `uTime`, scaled by the attribute. Amplitude is well under a tile —
a lean, not a sweep — and because the weight is zero on the trunk, a tree bends
its head and keeps its feet.

Chunk rebuilds are unaffected: the attribute is baked once with the rest of the
chunk, and the motion is entirely in the vertex shader. A swaying chunk costs
the same to rebuild as a still one.

### Motes

One instanced layer for each kind, drawn in `movers.sync` beside the existing
ones, with positions written per frame from a closed form:

- **Bees** around Hives and Flowers: a few specks per anchor on tilted circular
  orbits of a tile or so, each offset by its index, with a slow bob. Only while
  the building is `Active`.
- **Smoke** from the workshops that burn — the Oven's chimney first, and any
  workshop with a fire. A puff rises, drifts and fades over a fixed period,
  its phase a function of index; the column is three or four puffs, not a
  particle system.
- **Birds** over the colony: a small flock on a wide slow circuit above the
  enclosed ground's centre, high enough never to be mistaken for anything on it.

Each is sized in tiles and stays there. A bee never leaves its hive's
neighbourhood; the flock's circuit is centred and does not migrate.

### Construction

A site under construction grows a **scaffold**: a few timber poles and a rail,
drawn per frame from the building's `progress` rather than baked, so it changes
every tick with nothing to dirty. At `Blueprint` the outline is bare stakes; as
progress climbs the frame fills in, and at `Active` it is gone. This is the one
piece of ambient motion that is *information* — it is the same number the
panel prints, drawn where the player is already looking, and it is knowledge
the player already has.

### Fauna

A small module owns the wander state: for each anchor, a set of creatures with
a position, a heading, a target and a timer. The loop is the mockup's, which
`docs/ARCHITECTURE.md` records: walk toward a target inside the home radius,
graze for a random pause, pick another target. Legs swing while walking, heads
dip while grazing; the group turns to face its heading, and every model is
built facing `+z` so heading is `atan2(dx, dy)`.

Two anchors to start:

- **Sheep** in a Pasture: home radius is the footprint, so they mill inside
  their own fence and the fence is the promise. The baked sheep props come out
  of `props.ts` as they go in as fauna — the pasture keeps its fence and turf.
- **Deer** in the wilds: a home radius of a few tiles around a point chosen
  from the world seed and the terrain, on grass, outside any enclosure. They
  refuse targets on enclosed ground, as the mockup's did.

**Initial placement is derived, not stored.** A creature's home and its
starting offset come from a hash of the anchor's tile index and the world seed,
so a load, a tab-wake or a renderer rebuild puts them in the same places
without anything being saved. The wander state itself is transient and nobody
misses it: an animal that was mid-stride before a reload is mid-stride
somewhere else after it, and no rule anywhere depends on where.

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
- **Unbounded roaming** — deer that cross the island. It is what the wilds
  would really look like, and it puts non-threats in motion across open ground
  in a game that reads threat by exactly that signal.
