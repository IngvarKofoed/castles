# WASD pans at a constant world rate, independent of camera tilt

The sin(elevation) screen-rate compensation from
`2026-09-01-pan-rate-compensation` is reversed: W/S and A/D all step the
focus at the same constant world-space rate again. Decided with the player's
model stated explicitly: W follows the camera's forward *projected onto the
ground plane*, and tilting the camera must never change where or how fast
the pan moves.

## Detail
- The compensation was correct for screen-rate parity but wrong for feel: at
  the shallow-elevation clamp it boosted W/S 4.6×, crossing the island in
  under a second, which read as the camera lunging up and down. Don't
  reintroduce screen-rate compensation; if shallow-angle views ever feel bad
  again, the levers considered and *not* taken were: capping the boost,
  raising EL_MIN (~13° is a screenshot angle), and terrain-following focus
  height. All were offered and declined in favour of constant rate.
- Pan directions are unchanged and stay view-azimuth-relative (horizontal
  projection of camera forward) — "world-axis WASD" was considered and not
  chosen.
- The perceived "camera moves up and down" had two other contributors, both
  already fixed: the fog false-horizon (`2026-09-01-fog-ground-anchor`) and
  this rate coupling. The island silhouette still rises/falls on screen when
  panning near coasts at shallow angles — accepted as inherent to a finite
  island viewed edge-on.
