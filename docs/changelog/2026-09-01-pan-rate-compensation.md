# WASD forward pan compensated for elevation foreshortening

W/S now scale their step by 1/sin(elevation), so all four pan keys scroll
the screen at the same visual rate at any camera angle. Before, W/S screen
motion was foreshortened by sin(el) (~60% at the default angle, ~20% at the
shallowest) and read as the camera drifting toward the horizon rather than
panning. Narrows `2026-09-01-bootstrap-world`'s pan-rate behavior.

## Detail
- The pan stays strictly horizontal in world space — the defect was rate
  asymmetry only; directions and the world-space plane are untouched.
  Elevation is clamped to [0.22, 1.32], bounding the factor (~1.0–4.6).
- Verified quantitatively via screenshot cross-correlation: at default
  elevation W and D both scroll exactly 288 px per 400 ms hold; at the
  0.22 clamp both scroll 144 px per 200 ms (pre-fix W would have been
  ~31 px). W-then-S round trips return the identical view (pixel-perfect
  at default elevation; measured shift 0 at the clamp, residual is water
  animation).
- The fog half of this defect pair was already fixed and recorded in
  `2026-09-01-fog-ground-anchor` — re-verified unchanged in the same
  browser pass (six views: default, both zoom clamps, both elevation
  clamps, coast; haze never walls off land; console clean).
- 21 Vitest tests and lint pass; no test covers pan rates — screen-space
  behavior stays browser-verified only.
