# Castles — Architecture

*Last updated 2026-09-17. The first half of this document is the
architecture **as built** — every system below has shipped (the record is
`docs/changelog/`, the designs `docs/specs/`); the second half is the record
of the two visual mockups that came first.*

## Tech stack

Decided 2026-09-01:

- **TypeScript**, strict, everywhere.
- **three.js** (pinned, currently r160) for rendering. The voxel look and
  the two shader injections were proven in `mockup3d.html` and have been
  ported into `render/` on chunked meshing, as planned.
- **Vite** for dev server and build, **Vitest** for tests.
- **Plain DOM for the HUD.** No UI framework; the HUD (ribbon, Stores
  panel, build rail, inspector, labour panel, centre modal) is built
  entirely from the recipes in `docs/STYLEGUIDE.md`, which is the source of
  truth for everything visual.
- **No backend.** The game ships as static files, browser-first; wrapped with
  Tauri (or Electron) for Steam/desktop later if it earns it. Nothing in the
  architecture may assume a server.

## The one hard boundary

`src/sim/` is the game. It is pure TypeScript with **no DOM and no three.js
imports** — enforced mechanically in `eslint.config.js`
(`no-restricted-imports` per directory, `no-restricted-globals` for
`document` / `window` / `navigator`, and `no-restricted-properties` so
`Math.random` and `Date.now` cannot enter `sim/`). Everything else —
renderer, HUD, persistence plumbing — is a consumer that reads sim state and
feeds it commands.

Three commitments inside that boundary:

- **Fixed tick.** The sim advances at a fixed rate (`TICK_HZ` = 10
  ticks/second of game time), decoupled from the render loop;
  `requestAnimationFrame` interpolates between ticks. Game speed multiplies
  ticks per real second; pause is zero.
- **Determinism.** One seeded PRNG owned by the sim; `Math.random` is banned
  inside `sim/`. Same seed + same commands = same colony. This buys
  replayable bugs, cheap golden-master tests, and saves that cannot drift.
- **State is plain data.** All sim state lives in one serializable store —
  plain objects and typed arrays, systems as functions over it. Saving is a
  clone plus a version stamp, not a tour of class instances each serializing
  itself.

Player input becomes **commands applied at tick boundaries** (place
blueprint, assign slot, order teardown) — the same seam saves and replays
use.

## Truth and knowledge

The concept requires the sim to know things the player has not earned: the
sim knows to the tick when the next incursion lands and on which beach, while
the player sees a coarse forecast in words that goes blank past a horizon —
and a manned watchtower covering that coast widens the horizon and halves the
bucket. So the sim keeps two models — **truth** and **knowledge** — and the
renderer and HUD may only read knowledge.

This is the easiest architectural mistake available in this game: draw the
sim's truth once, "temporarily", and information-as-infrastructure quietly
stops being a mechanic. The import boundary should make it structural:
`render/` and `ui/` import from `sim/know`, never from the truth modules.

## Repo layout

```
src/
  sim/            the game — pure TS, no DOM, no three.js
    world/        grid, terrain gen
    labour/       pool/slot workers, task queue
    economy/      filtered storage, recipes, hauling
    walls/        the wall grid layer and its predicates, wall lifecycle
                  (palisade → stone → finished → teardown), the enclosure test
    threats/      orcs, trolls, the incursion clock, notice / attack / flee
    know/         the knowledge model — what the player may see
    save/         snapshot, versioning, migrations
  render/         three.js — chunked meshing, materials, shaders
  ui/             HUD, build menus, overlays (plain DOM)
  app/            bootstrap, main loop, storage, sim ↔ render ↔ ui wiring
  types/          ambient declarations
mockups/          mockup.html and mockup3d.html — the pre-build record below
docs/             CONCEPT.md, this file, STYLEGUIDE.md, specs/, changelog/
```

Content — buildings, recipes, monster kinds, goods — currently lives as
tables in `sim/` (`BUILDING_DEFS`, `GOODS`, `MONSTER_DEFS`), documented as
"data, not behaviour". The planned `assets/` folder does not exist yet; the
tables move out to it when a content format earns its keep, and nothing
consumes them by anything but the table shape.

## World model

- The world ships at **256 × 256** (`WORLD_SIZE`), **chunked** (16 × 16
  tiles), so terrain rebuilds, render meshing, and dirty-marking are
  per-chunk, never whole-world — the mockups' bake-once-blit-forever trick
  did not survive a map this size, and bake-per-chunk with
  rebuild-only-what-changed is what replaced it.
- Terrain generation is simpler than the mockups': fairly flat
  (CONCEPT.md: terraforming is labour-only), few height steps, water and
  rock as features rather than topography, an island with no land edge.
- **Enclosure is computed, not prescribed.** There are no rings — the player
  chooses where to expand. "Inside" is derived from the wall graph:
  flood-fill **from the map edge and from every monster on the map**, and
  anything unreached is enclosed; a gate counts as wall. This test is the
  load-bearing primitive — safety, buildable ground, and the gap-in-the-wall
  failure all hang off it — so it must never run per-frame or per-consumer. It
  is **event-driven**: the whole fill runs at most once per tick, batching every
  segment that completed or fell *and every monster that changed tile*, and not
  at all on a quiet tick. That is what "incremental" bought, and at 256² a full
  BFS is sub-millisecond, so a region-incremental re-flood was measured as
  unnecessary and deferred behind the same API
  (`docs/specs/2026-09-02-palisade-walls.md`). In peace `sim.monsters` is empty
  and the fill is the map-edge flood alone — cheaper than it has ever been.

  **Seeding from monsters is what stops a stone box round one reading as calm
  ground**, and the consequence is colony-wide and intended: close a wall around
  a landed monster and the *whole* enclosure reads as outside, because a monster
  inside your walls can walk anywhere in them. A monster may be **contained**
  and only never killed, removed, or made safe to stand beside. The seed was
  anchored on a **lair** until `docs/specs/2026-09-17-incursions-from-the-sea.md`
  deleted dens; with them went the rule that nothing could be built on a lair
  tile, since a landed monster is leaving and there is no seed to protect
  forever (`docs/specs/2026-09-04-monsters.md`).
- Walls are a **grid layer** (`sim.wallMap`, one state per tile) rather than
  per-segment entities: a castle is hundreds of segments, and the flood-fill,
  the mesher and the pathfinder all read grids. Consumers go through
  `isBlocking` / `isWalkable` predicates, so appending states costs them
  nothing. Bite damage arrived with threats as a **second grid layer**
  (`sim.wallDamageMap`) rather than as hit points on a segment, and it stores
  *damage* rather than remaining health: 0 is pristine, so a new segment costs
  no write, and the max-HP numbers stay tunables instead of being frozen into
  every save. `isDamageable` names the set (palisade, wooden gate and every
  blueprint; finished stone never). Construction progress lives on the builder,
  not the segment, because one log and one work stint is the whole of a
  palisade. The mockups' walls are just props.
- Pathfinding is A* on the tile grid with per-chunk locality; hierarchical
  refinement only when a profiler demands it.

## Persistence

- A save is a **versioned snapshot** of the whole sim store —
  `{version, seed, tick, state}` — gzipped via `CompressionStream`.
- Saves live in **IndexedDB**: autosave every few game-days and on tab hide,
  plus named manual slots with metadata (colony name, in-game day,
  population) for the load screen.
- **Export/import:** the same bytes as a downloadable `.castles` file the
  player owns; import is just load.
- **Where the halves live.** `sim/save/` owns the *pure* half — `encode`,
  `decode`, `SAVE_VERSION`, the migrations ladder — and nothing else;
  IndexedDB, the download anchor, the file picker, timestamps and the
  single-instance lock all sit in `app/storage.ts` behind a `SaveStorage`
  interface, because they are precisely the browser APIs the boundary bans.
  When the desktop wrap happens, that one file is replaced and the codec is
  untouched — which is what keeps the swap boring
  (`docs/specs/2026-09-01-persistence.md`).
- **Versioning policy:** the schema version is an integer, and loading an
  old save runs it through append-only migrations tested against fixture
  saves. Pre-1.0 the escape hatch is allowed — breaking saves is fine, but
  it bumps the version and fails loudly, never loads garbage.

## Build order — as it happened

The five planned steps all shipped, each behind a spec in `docs/specs/` and
a changelog entry — in the planned order but for persistence, which came
early (step 4 below, and the plan's own reason for allowing it); the plan
then kept extending the same way. The shipped sequence:

1. **Bootstrap** — world gen in `sim/world`, the renderer on chunked
   meshing (`2026-09-01-bootstrap-world`).
2. **Tick + labour** — fixed tick, store, pool/slot workers, task queue,
   filtered-storage hauling (`2026-09-01-tick-and-labour`).
3. **Walls + enclosure, then stone + terraform** — lifecycle states, the
   batched flood-fill, labour-only levelling
   (`2026-09-02-palisade-walls`, `2026-09-02-stone-and-terraform`).
4. **Persistence** — pulled *earlier* than planned, exactly for the stated
   reason (`2026-09-02-versioned-save-snapshots`).
5. **Threats + knowledge** — notice/attack/flee and a coarse display of when
   danger is due (`2026-09-05-monsters-and-the-hours-they-keep`); the
   watchtowers that sharpen it came as 4b (`2026-09-09-watchtowers`). Both
   were built around **dens with rhythms**; the wilds now arrive by sea
   instead, and a tower reads the coast rather than a schedule
   (`2026-09-17-incursions-from-the-sea`).
6. **Population and food** — housing and sea-borne wanderers (5a), then
   the bread economy with hunger-that-slows and the tightened gate (5b),
   with production ceilings and stockpile filter UI landing between them
   (`2026-09-07-housing-and-wanderers`,
   `2026-09-07-production-limits-and-filters`, `2026-09-08-bread-economy`).
7. **The HUD refit** — slim ribbon, Stores panel, icon rail
   (`2026-09-08-stores-panel-and-icon-rail`).
8. **Incursions from the sea** — dens out, a forecast clock in, boats on one
   coast, and a watchtower that reads the shore
   (`2026-09-17-incursions-from-the-sea`, `2026-09-17-forecast-readouts`,
   `2026-09-17-beached-longships`).

---

## The mockups — a record

Everything below documents the two mockups, kept because the rendering
lessons carry into `render/` unchanged. The mockups predate the concept
rewrite: they demonstrate the retired wall-ring model, so the ring material
below records what the mockups do, not what the game will be.

Both mockups are single self-contained HTML files with no build step. Open in
a browser, or serve the folder (`python3 -m http.server`).

| File | Renderer | Dependencies |
| --- | --- | --- |
| `mockup.html` | painted 2D canvas, one fixed camera angle | none |
| `mockup3d.html` | three.js r160 (UMD, cdnjs), real lights and shadows | three.js only |

Neither is a game. They were built to pin down the look, the HUD, and the
wall-ring mechanic well enough to react to — and the reaction has happened.
The look and the HUD remain the reference; the ring mechanic is a fossil.

### Shared world model

Both files carry their own copy of the same generators. That duplication is
deliberate for now — each file stays independently openable — but it is the
first thing to factor out (build order, step 1).

**Grid.** 34 × 34 tiles, castle centred at (16, 16). Per tile: a height
(`hmap`, 1–8 blocks) and a terrain type (`tmap`). (Mockup-scale — the real
target is much larger; see World model above.)

**Terrain.** Two octaves of hash-based value noise, with an island falloff by
radius. Height decides type: 1 water, 2 sand, 7+ rock, else grass — and grass
outside the ring's neighbourhood becomes "wilds" (a darker moss). The courtyard
inside the current ring is flattened to height 4 so it is cleanly buildable.
Worn dirt paths are stamped along the lines everyone walks.

**The octagon.** The castle footprint is a square with its corners clipped:

```js
inOct(dx, dy, R) = max(|dx|,|dy|) <= R && |dx|+|dy| <= R + cutFor(R)
cutFor(R)        = max(2, round(R * 0.6))
```

The clip **scales with the radius**. A fixed clip constant was the original bug:
at larger radii the "ring" degenerated into four disconnected stubs and enclosed
nothing.

**The wall** is the closed one-tile boundary of that octagon — a cell that is
inside but has at least one neighbour outside. Deriving the boundary this way
(rather than listing cells at exactly `max == R`) is what makes it actually
closed, including around the diagonal corners.

Towers sit where the straight run meets a diagonal (`max == R && sum == R + cut`),
which yields eight of them. The gate is the single cell at `(CX + R, CY)`.

**Rings and cost.** `RINGS = {1: 7, 2: 11, 3: 14}`. Cost is 2 stone + 1 timber
per wall segment, tuned so Ring II is affordable from the starting stock and
Ring III is not — the gate is meant to be visible. Raising a ring re-levels the
interior, pushes the woods back, and appends to `ringsBuilt`, so previous rings
keep standing as inner walls. (All of this is the retired model. The real game
has no defined rings at all — the player chooses where to expand.)

### `mockup.html` — the painted renderer

Isometric projection, hand-rolled:

```js
ex = (x - y) * TW / 2
ey = (x + y) * TH / 2 - z * ZH
```

Each cube is three filled parallelograms — a diamond top plus two skewed side
quads — in three fixed tones of its material. Depth is painter's order, sorted
by `(x + y) * 100 + z`.

Terrain columns are an optimisation: one top face plus side skirts dropped to
whichever neighbour is exposed, instead of stacking real cubes. The static world
bakes once to an offscreen canvas and is blitted each frame; only colonists and
the blueprint overlay redraw.

Known limitation, accepted: colonists are drawn *over* the baked world rather
than interleaved, so one walking behind the near wall would incorrectly appear
in front of it. Their paths are kept inside the courtyard so it never shows.

### `mockup3d.html` — the lit renderer

#### Geometry

One shared `BoxGeometry` reused through instanced meshes:

- `terrainMesh` — one instance per tile, scaled to its height.
- `propMesh` — everything built or grown: walls, buildings, trim, trees,
  clutter. Instances carry separate x/z scale and a y-rotation.
- `waterMesh` — one thin instance per wet tile.
- `glowMesh` — windows and lamps, unlit `MeshBasicMaterial`.
- `smokeMesh` — chimney puffs, matrices rewritten per frame.

Roughly 1,700–2,500 instances and a handful of draw calls for the whole world.

Props are built by two helpers: `cube()` (uniform x/z scale) and `slab()`
(separate x and z, for beams, rails and roofs). Both take an optional
y-rotation, used only on *decorative* props — trees, bushes, crates, sheep,
reeds — never on walls or buildings, so the grid still reads.

#### Lighting

A warm `DirectionalLight` with soft PCF shadows (2048 map), a cool
`HemisphereLight` for sky bounce, and a whisper of warm `AmbientLight`. The sun
slider swings position, colour temperature and intensity from dawn to evening.

#### Shaders

Two small `onBeforeCompile` injections, both into `MeshLambertMaterial` so they
keep three's lighting, fog and colour management for free:

1. **Contact shading** — dims each block toward its base and tints low ground
   warm-dark. One multiply, and it is most of the cosy.
2. **Water** — the wave is folded into `diffuseColor` and displaces the surface,
   driven by *world* position (read off `instanceMatrix`) so each tile ripples on
   its own beat.

`cozify()` also sets `customProgramCacheKey`, so every material sharing the
injection shares one compiled program.

Terrain additionally gets **baked occlusion**: each tile darkens by how much its
neighbours rise above it, folded straight into the instance colour.

#### Camera and interaction

Hand-rolled orbit — azimuth/elevation from pointer drag, wheel adjusts the
orthographic frustum, no `OrbitControls` needed (it lives in `examples/`, which
the CDN allowlist does not reliably cover). A drag under ~6px counts as a click.

Picking raycasts the terrain and prop meshes and maps `instanceId` back to a
tile through parallel `terrainTile` / `propTile` arrays. Prop tiles are stored
**rounded**, since decorative props sit on fractional coordinates.

#### Animals

Livestock and wildlife share one wander state machine: walk to a target inside a
home radius, graze for a random pause, pick another. Legs swing while walking,
heads dip while grazing, and the group turns to face its heading. Every model is
built facing `+z`, so heading is `atan2(dx, dy)`.

Populations: 5 sheep (3 penned, 2 loose), 5 hens, 3 deer in the wilds (one
antlered), 3 birds circling the keep on pivot-group wings. Deer refuse targets
inside the wall and are re-homed outward when a ring goes up.

### Gotchas — all of these cost real time

- **Ortho fog.** With an orthographic camera the eye sits a fixed distance back,
  so fog near/far must be tuned around `CAM_DIST`. The first build put every
  fragment past fog-far and rendered a uniform green haze.
- **Light intensities are π-scaled** since three r155. Values that look right in
  pre-r155 examples are ~3× too dim.
- **Clipping bleaches the palette.** With no tone mapping, pushing intensity past
  ~1.0 of albedo clips lit faces toward white — that is exactly the "clinical"
  look. Fix it with moderate light and a more saturated palette.
- **ACES is the wrong tool here.** `ACESFilmicToneMapping` cures the clipping but
  desaturates and hue-shifts flat stylised colour (pale grass, salmon roofs).
  Shipped with no tone mapping at all.
- **A single water plane overhangs the island**, and when you orbit, its near
  half sits closer to the camera than the far terrain and tints it blue. Per-tile
  water instances fix it, and blocky ripples suit voxels better anyway.
- **Wave displacement must not dip below the seabed**, or the seabed shows
  through as dark patches.
- **Per-cell roofs overlap** and their shaded undersides show through as a dark
  waffle grid. One stepped roof slab per building instead.
- **The scaling octagon cut bites twice.** Once in the wall generator (fixed
  clip → open ring), once in the deer's keep-out test, where `inOct(ringR + 2)`
  reached far past the wall and rejected every roam target, freezing them on
  their home tile. It wants `ringR + 1`.
