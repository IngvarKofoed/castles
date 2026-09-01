# Fog anchored to the visible ground, not a frustum fraction

Fog near/far now derive from Δ = frustum / (2·tan(elevation)) — the depth
from focus to the ground at the top of the screen — with far past the
visible ground, so on-screen land never fully fogs at any zoom or elevation.
The camera rig reports every place() (zoom AND orbit) to the fog, replacing
the zoom-only callback. Narrows `2026-09-01-bootstrap-world` / its spec.

## Detail
- The spec's formula (offsets linear in frustum alone, per
  `docs/specs/2026-09-01-bootstrap-world.md`) was verified wrong in the
  browser: it pinned a 100%-fog wall at a fixed screen fraction at every
  zoom, had no elevation term (low angles put most ground past fog-far),
  and — fog colour being the clear colour — fogged land read as sky: a
  false horizon at mid-screen that made WASD panning feel like vertical
  camera motion. The pan itself was verified correct and is untouched.
- Don't reintroduce a fog band that completes on-screen: with
  FOG_FAR_FRAC 1.8 (> 1), ground at the top edge tops out ≈ 38% fogged —
  the "haze kisses the top, never walls off land" rule this entry sets.
- Tuned by eye: FOG_NEAR_FRAC 0.5, FOG_FAR_FRAC 1.8. Still anchored at
  CAM_DIST — the mockups' ortho-fog gotcha (`2026-09-01-voxel-mockups`)
  binds as ever.
- Verified per src/render/CLAUDE.md: Playwright screenshots at the island
  centre default, both zoom clamps, both elevation clamps, and a coast
  view; console clean; 21 tests and lint pass.
