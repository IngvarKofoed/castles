# Castles — Architecture

*Last updated 2026-09-01. The game is not yet built: the first half of this
document is the intended architecture of the real thing, the second half is
the record of the two visual mockups that came first.*

## Tech stack

Decided 2026-09-01:

- **TypeScript**, strict, everywhere.
- **three.js** (pinned, currently r160) for rendering. The voxel look, the
  instancing budget, and the two shader injections are already proven in
  `mockup3d.html` — the renderer's job is to port them into modules, not
  reinvent them.
- **Vite** for dev server and build, **Vitest** for tests.
- **Plain DOM for the HUD.** No UI framework until a real need shows up; the
  mockups' HUD is a handful of elements.
- **No backend.** The game ships as static files, browser-first; wrapped with
  Tauri (or Electron) for Steam/desktop later if it earns it. Nothing in the
  architecture may assume a server.

## The one hard boundary

`src/sim/` is the game. It is pure TypeScript with **no DOM and no three.js
imports** — a rule worth enforcing mechanically (ESLint
`no-restricted-imports` per directory). Everything else — renderer, HUD,
persistence plumbing — is a consumer that reads sim state and feeds it
commands.

Three commitments inside that boundary:

- **Fixed tick.** The sim advances at a fixed rate (working target: 10
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

The concept requires the sim to know things the player has not earned:
monsters run exact schedules, but the player sees approximations until
manned watchtowers sharpen them. So the sim keeps two models — **truth** and
**knowledge** — and the renderer and HUD may only read knowledge.

This is the easiest architectural mistake available in this game: draw the
sim's truth once, "temporarily", and information-as-infrastructure quietly
stops being a mechanic. The import boundary should make it structural:
`render/` and `ui/` import from `sim/know`, never from the truth modules.

## Repo layout

```
src/
  sim/            the game — pure TS, no DOM, no three.js
    world/        grid, terrain gen, the enclosure test
    labour/       pool/slot workers, task queue
    economy/      filtered storage, recipes, hauling
    walls/        wall lifecycle: palisade → stone → finished → teardown
    threats/      orcs, trolls, schedules, notice / attack / flee
    know/         the knowledge model — what the player may see
    save/         snapshot, versioning, migrations
  render/         three.js — chunked meshing, materials, shaders
  ui/             HUD, build menus, overlays (plain DOM)
  app/            bootstrap, main loop, sim ↔ render ↔ ui wiring
assets/           content data: buildings, recipes, monster kinds, palettes
mockups/          mockup.html and mockup3d.html move here when src/ appears
docs/             CONCEPT.md, this file, changelog/
```

Content — buildings, recipes, monster kinds — is data in `assets/`, not
code. The mockups' prop system (a building is a footprint plus trim rules)
is already nearly that format.

## World model

- The mockups are 34 × 34; the real game wants **a lot larger** — 256 × 256
  is the working target, with a correspondingly larger starting castle. The
  numbers are tunable; the consequence is not: the world is **chunked**
  (16 × 16 tiles), so terrain rebuilds, render meshing, and dirty-marking
  are per-chunk, never whole-world. The mockups' bake-once-blit-forever
  trick does not survive a map this size; its successor is bake-per-chunk,
  rebuild only what changed.
- Terrain generation gets simpler than the mockups': fairly flat
  (CONCEPT.md: terraforming is labour-only), few height steps, water and
  rock as features rather than topography.
- **Enclosure is computed, not prescribed.** There are no rings — the player
  chooses where to expand. "Inside" is derived from the wall graph:
  flood-fill from the map edge, and anything unreached is enclosed; a closed
  gate counts as wall. This test is the load-bearing primitive — safety,
  buildable ground, and the gap-in-the-wall failure all hang off it — and it
  must be **incremental**: a segment completing or breaking re-floods only
  the affected region, because this runs constantly.
- Wall segments carry construction progress and hit points (palisade and
  unfinished stone are damageable; finished stone is not). The mockups'
  walls are just props.
- Pathfinding is A* on the tile grid with per-chunk locality; hierarchical
  refinement only when a profiler demands it.

## Persistence

- A save is a **versioned snapshot** of the whole sim store —
  `{version, seed, tick, state}` — gzipped via `CompressionStream`.
- Saves live in **IndexedDB**: autosave every few game-days and on tab hide,
  plus named manual slots with metadata (colony name, in-game day,
  population) for the load screen.
- **Export/import:** the same bytes as a downloadable `.castles` file the
  player owns; import is just load. When the desktop wrap happens, IndexedDB
  is swapped for real files behind the same interface — `sim/save/` talks to
  a storage interface precisely so that swap stays boring.
- **Versioning policy:** the schema version is an integer, and loading an
  old save runs it through append-only migrations tested against fixture
  saves. Pre-1.0 the escape hatch is allowed — breaking saves is fine, but
  it bumps the version and fails loudly, never loads garbage.

## Build order

1. **Bootstrap.** Vite + TS + Vitest; port the (currently duplicated) world
   generator into `sim/world` with tests; port the mockup3d renderer into
   `render/` on chunked meshing. Playable result: a large empty world you
   can orbit.
2. **Tick + labour.** The fixed tick, the sim store, pool/slot workers, the
   task queue, filtered-storage hauling. First because every later system
   spends the same currency — people.
3. **Walls + enclosure.** Lifecycle states, the incremental flood-fill,
   terraforming as labour tasks.
4. **Threats + knowledge.** Schedules, notice/attack/flee, then watchtowers
   and the knowledge model.
5. **Persistence** as soon as the store shape settles — earlier than feels
   natural, because the plain-data rule makes it cheap and it enforces state
   discipline.

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
