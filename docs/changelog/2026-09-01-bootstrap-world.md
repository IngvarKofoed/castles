# Bootstrap: the playable world skeleton is real

`npm run dev` now renders a seeded 256×256 voxel island — merged geometry
per chunk, the mockup's lighting/shaders — orbitable, WASD-pannable, zoomable
at 60 FPS. `sim/world` is pure and tested; the sim boundary (no three/DOM,
no Math.random/Date.now) is lint-enforced. Version is baked at build time
into the tab title. Implements `docs/specs/2026-09-01-bootstrap-world.md`.

## Detail
- Rejected alternatives (per-chunk `InstancedMesh`, global instancing,
  `OrbitControls`) are recorded in the spec — don't re-litigate here.
- Contact shading rides an `aBlockY` vertex attribute, not vertex colors:
  the mockup's multiply happens in sRGB space after colour conversion, and
  folding it into linear-space vertex colors would visibly halve it.
- Tune-by-eye values now fixed: rock outcrop threshold 0.9 (≈3.8% of land;
  0.8 gave 13%), base noise 0.02/0.06 kept from the spec, default frustum 90
  (60 opened on featureless grass), zoom clamp 13–120, fog offsets −4/30 and
  +40/30 of frustum around CAM_DIST.
- CAM_DIST raised 56 → 400: at wide zoom + low elevation, near terrain
  crossed the ortho near plane at mockup distance; ortho makes distance free.
- "Chunked instancing" → "chunked meshing" updated in ARCHITECTURE.md per
  the spec, plus the same stale phrase in `src/render/CLAUDE.md` (one line
  beyond the spec's named file, same supersession).
- The dirty-chunk seam exists (`chunkVersion`, renderer last-seen array,
  `markChunkDirty`) but nothing bumps versions after generation yet — that
  arrives with build-order step 2+.
- Verified: 21 Vitest tests; lint proven to fail on `import "three"` under
  `src/sim/`; production build; Playwright checks of orbit/pan/zoom, wave
  motion, focus-following shadows, seed determinism (`?seed=42` twice →
  identical world hash), console clean.
