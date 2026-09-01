# Bootstrap: the playable world skeleton

Stand up the real app — Vite + TypeScript + Vitest, the pure `src/sim`
boundary, a seeded 256×256 world generator in `sim/world`, and a three.js
renderer in `src/render` that draws the world as **merged voxel geometry per
chunk** with the mockup's proven look. Result: `npm run dev` opens a large,
empty, generated world you can orbit, pan, and zoom. This is build-order
step 1 from `docs/ARCHITECTURE.md`.

## Outcome

**What you get:**

- `npm run dev` opens a generated 256×256 voxel island in the browser with
  the mockup's look — warm sun, soft shadows, cozy contact shading, rippling
  water — orbitable, pannable, zoomable at interactive framerates.
- A pure, seeded, tested world module: the same seed always produces the
  same world, shareable via `?seed=`.
- The git-describe version baked into the build and visible in the tab title.
- The repo matches the ARCHITECTURE layout: `src/sim|render|app`, mockups
  moved to `mockups/`.

**How to verify:**

- Run `npm run dev`, open the page: a large island renders; left-drag
  orbits, WASD pans across the map, the wheel zooms; water visibly moves,
  and shadows stay sharp wherever you pan.
- Open the page with `?seed=42` twice — the world is identical both times;
  a different seed gives a different world.
- `npm test` and `npm run lint` pass — and adding `import "three"` to any
  file under `src/sim/` makes lint fail.
- The browser tab title contains a version like `v0.1.0-<n>-g<sha>`.

## Key decisions

- **Merged BufferGeometry per chunk** (new). Terrain bakes into one static
  geometry per 16×16 chunk — only exposed faces (a top quad per tile, plus
  side quads down to each lower neighbour), with per-tile vertex colors.
  Chosen over per-chunk `InstancedMesh` for the better performance ceiling;
  the cost is a meshing pass and a shader-path adjustment, both specified
  below. This supersedes ARCHITECTURE.md's "chunked instancing" phrasing —
  updating those words to *chunked meshing* is part of this change.
- **Vertices baked in world coordinates, chunk meshes at origin** (extends).
  The mockup's `cozify()` and water shaders already carry non-instancing
  fallback branches that read `transformed` directly; world-coordinate baking
  makes those branches correct *unchanged*. Per-chunk frustum culling comes
  from each geometry's own bounding sphere.
- **Block dimming rides a vertex attribute, not vertex colors** (extends).
  The mockup dims each column toward its base with `gl_FragColor.rgb *= ao`
  injected *after* colour-space conversion — the multiply happens in sRGB
  space, so folding it into vertex colors (which scale linear-space
  `diffuseColor`) would visibly halve the effect and wash out "most of the
  cosy". Instead the geometry carries a per-vertex `aBlockY` attribute (0 at
  a column's base, 1 at its top; 1.0 on top faces), and `cozify()` keeps its
  fragment multiply reading that varying in place of the unit-cube-derived
  `vBlockY`. Identical output to the mockup, by construction. The world-Y
  warm lift stays in the shader unchanged.
- **Seeded world generation, integer hash** (extends). `vnoise` ports from
  `mockup3d.html` verbatim, but the sin-based `hash` is replaced by an
  integer avalanche hash of `(x, y, seed)` returning [0, 1) — `Math.sin`
  bit-equality across JS engines is de facto, not guaranteed, and the
  shareable-seed promise shouldn't rest on it. A `mulberry32` stream PRNG
  lands in `sim/world/rng.ts` for future non-spatial randomness. No new
  dependency — both are a few lines.
- **`tmap` becomes a `Uint8Array` enum** (diverges from the mockup). Strings
  per tile waste memory at 65,536 tiles and serialize badly; terrain becomes
  a frozen `Terrain` constant object (`as const` — not a `const enum`, which
  Vite's `isolatedModules` transpilation degrades) with a palette lookup
  table in `render/`.
- **Retired content stays behind** (reuses the ARCHITECTURE record). No
  octagon, rings, courtyard flattening, roads, worn paths, props, animals,
  or HUD. Generation is retuned flatter per ARCHITECTURE: most land height
  3–5, rare rock outcrops, water at the low end.
- **Camera: port the hand-rolled orbit, add pan** (extends). Orbit/zoom port
  as-is (ortho frustum zoom, tuned feel); a movable focus point is new,
  because orbiting a fixed centre is useless at 256². `OrbitControls` stays
  rejected even though npm removes the old CDN reason — the ortho-frustum
  zoom and feel are already tuned.
- **Shadow camera follows the focus** (extends). The mockup's ±24-unit
  shadow box cannot cover 256 tiles; it tracks the camera focus so shadows
  stay sharp where you look.
- **three.js pinned at 0.160.x** (reuses). The exact minor the shader
  injections and gotchas were proven on. `vite`, `vitest`, `typescript`,
  `eslint` at current stable.
- **Boundary enforced by lint** (reuses the ARCHITECTURE mandate). ESLint
  flat config: `no-restricted-imports` keeps `three` and `src/render|ui|app`
  out of `src/sim`; `Math.random` and `Date.now` are banned inside `sim/`.

## Goals

- A generated 256×256 world on screen with the mockup's look — lighting,
  contact shading, water waves, fog — at interactive framerates.
- The first real inhabitant of the sim boundary: `sim/world`, pure and
  tested, with chunk math and a dirty-chunk seam future systems will use.
- The version (`git describe`) baked at build time and visible.
- Mockups moved to `mockups/`, per the ARCHITECTURE repo layout.

## Non-goals

- No tick, labour, walls, enclosure, monsters, saves, or HUD — build-order
  steps 2–5.
- No props, trees, buildings, or animals: "empty world" is literal. The
  render path for props (instanced vs merged) is decided when they arrive.
- No greedy meshing (it would merge across tiles and destroy per-tile color
  jitter), no LOD, no pathfinding.
- No port of `mockup.html` — the 2D painted renderer stays a record.

## Design

### Project scaffold

Vite + TypeScript (strict) + Vitest, plain npm. Layout per ARCHITECTURE:
`src/sim/`, `src/render/`, `src/app/` (`src/ui/` stays empty this step),
`index.html` at the root, `mockups/` holding the two mockup files.
`scripts/gen-version.mjs` resolves `git describe --tags --long --always
--dirty` once and writes `src/version.ts`; it runs before `dev` and `build`
(npm `predev`/`prebuild`), and `src/version.ts` is gitignored. `main.ts`
logs the version and puts it in `document.title`.

Scripts: `dev`, `build`, `test`, `lint`. ESLint flat config carries the
boundary rules from Key decisions.

### `sim/world` — data model and generation

```ts
// sim/world/world.ts
interface World {
  readonly size: number;          // 256 (one constant, WORLD_SIZE)
  readonly seed: number;
  readonly hmap: Uint8Array;      // height in blocks, 1..8
  readonly tmap: Uint8Array;      // Terrain values
  readonly chunkVersion: Uint32Array; // bumped by whatever changes a chunk
}
const Terrain = { Water: 0, Sand: 1, Grass: 2, Rock: 3 } as const;
```

Chunk math lives in `sim/world/chunks.ts`: `CHUNK = 16`, index ↔ chunk
conversions, and `chunkOf(x, y)`. Dirty tracking is shaped so the renderer
never writes sim state: the sim bumps `chunkVersion[c]` whenever something
changes chunk `c` (generation leaves every entry at 1), and the renderer
keeps its own last-seen array, rebuilding chunks whose versions moved.
Nothing bumps versions after generation this step — the seam just exists,
and the store stays plain typed arrays for persistence later.

`generate(seed): World` ports the mockup's two-octave value noise, retuned:

- Base height `3 + vnoise(x, y, 0.02)·1.6 + vnoise(x, y, 0.06)·0.5`,
  rounded, clamped 1..8 — most land lands on 3–5 ("fairly flat";
  terraforming is labour, so the ground shouldn't demand much of it). The
  frequencies are the mockup's 0.16/0.42 scaled to the map so landforms
  span tens of tiles instead of repeating every six; treat the exact values
  as tune-by-eye at these amplitudes.
- Island falloff kept: with `r` = distance from centre over half-size,
  `h -= (r - 0.85) * 30` beyond `r > 0.85`, so all edge tiles are water —
  which also suits the future flood-fill-from-the-map-edge enclosure test.
- Rock comes from a separate outcrop pass, not base height (the flat base
  tops out at 5, below the rock threshold): where a third, low-frequency
  noise exceeds a high threshold on land, the tile is raised to 7 — a few
  percent of land, "rock as features rather than topography" per
  ARCHITECTURE.
- Types by height exactly as the mockup: ≤1 water, 2 sand, ≥7 rock, else
  grass. The `wilds` tint is dropped — it was defined relative to the ring.

`hash(x, y, seed)` is the integer avalanche hash from Key decisions;
`vnoise` is otherwise unchanged.

### `render/` — chunk meshing

`render/mesher.ts` is a **pure function** — `meshChunk(world, cx, cy) →
{positions, normals, colors, blockY, indices}` as typed arrays — so Vitest
can test it without a DOM or GL context.

Faces: per tile, one top quad at `h·BH`; for each of the 4 sides, a quad
from the neighbour's height up to own height where own is higher (map edge
counts as height 0, closing the island silhouette). Neighbour lookups read
the world, not the chunk, so chunk-border faces are correct. `BH = 0.5`
ports as-is.

Colors: per tile, `palette[terrain] × jitter(hash) × tileAO(x, y)` — the
mockup's `tint()` and `tileAO()` port with the palette table replacing the
string keys. Side faces carry the `aBlockY` attribute from Key decisions
(top faces carry 1.0). Water tiles get neither jitter nor AO — the mockup's
`JITTER` table has no water key, and a jittered seabed would read as dapple
the mockup doesn't have.

`render/chunks.ts` owns one `Mesh` per chunk (and one water mesh per chunk
that has wet tiles — thin top quads at the water line, `waterMat`). Rebuild
= dispose old geometry, mesh again, set bounding sphere. Water quads bake
world coordinates too, so the wave shader's non-instancing branch (`wpos =
vec4(transformed, 1.0)`) displaces correctly unchanged.

### `render/` — materials, lights, camera

`cozify()` ports with one substitution: `vBlockY` is fed by the geometry's
`aBlockY` attribute instead of the unit-cube position, keeping the
sRGB-space fragment multiply and the world-Y warm lift intact — still on
`MeshLambertMaterial` with `vertexColors: true` and one shared program via
`customProgramCacheKey`. The water material ports verbatim. Lighting ports
verbatim: warm `DirectionalLight` (PCF soft shadows, 2048 map),
`HemisphereLight`, `AmbientLight`, fixed at the mockup's `placeSun(0.35)`
morning. Fog stays tuned around `CAM_DIST` (the ortho-fog gotcha), but its
near/far scale linearly with the zoom frustum — the mockup's 52/96 were
tuned for a 34-tile view, and fixed values at 256² would put mid-map land
in permanent haze.

The shadow camera keeps the mockup's ~±24-unit box but re-targets to the
camera focus every frame (`sun.position` and `sun.target` translate with
it), so shadow sharpness is constant wherever you look.

Camera (`render/camera.ts`): port `az`/`el` drag-orbit, wheel-driven ortho
frustum zoom, and `placeCamera()`, adding a `focus` vector — WASD pans it
across the map (screen-relative, clamped to world bounds), and orbit/zoom
are relative to it. `focus` starts at the world centre, and the zoom clamp
widens (the mockup's 13–46 frustum is a keyhole at this scale — roughly
13–120, tune-by-eye).

### `app/`

`main.ts`: generate world (seed from `?seed=`, parsed as an integer —
missing, non-numeric, or NaN falls back to a fixed default constant, so the
default world is shared and screenshot-comparable), create
renderer, build all chunks, start the render loop (drain `dirtyChunks`,
update `waveTime`, render). `resize()` ports as-is.

### Testing

Vitest, colocated. Determinism: same seed ⇒ byte-identical `hmap`/`tmap`
(hash the buffers), different seed ⇒ different. Bounds: heights within
1..8, all edge tiles water. Distribution sanity: nonzero water, sand,
grass, rock counts at the default seed. Chunk math round-trips. Mesher:
a hand-built 2×2 world yields the exact expected face count and positions;
chunk-border faces match across two adjacent chunks.

## Alternatives considered

- **Per-chunk `InstancedMesh`** — the shortest port (shaders verbatim,
  ~300–500 draw calls, free culling). Rejected by choice for the merged
  approach's higher performance ceiling; the meshing/shader adjustments are
  specified above so the port stays deterministic.
- **Global `InstancedMesh` with per-chunk ranges** — one draw call, but
  fiddly partial buffer updates, no per-chunk culling. Rejected.
- **`OrbitControls` from npm** — the old CDN objection is gone, but the
  hand-rolled orbit already has the ortho-frustum zoom and the tuned feel;
  porting proven code beats re-tuning a generic control.

## Implementation strategy

*Not part of the design — a starting point for whoever builds this.*

- **Single agent, Opus 5.** One coherent thread: scaffold, `sim/world`, the
  mesher, and the materials interlock — the mesher's output arrays are the
  shaders' inputs — so parallel streams would share every file that matters.
  Verify against the Outcome section at the end, browser checks included.
