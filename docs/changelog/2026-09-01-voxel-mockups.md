# 2026-09-01 — Voxel mockups: painted, then lit, then furnished

First work on Castles. Started from a conversation about how Kubifaktorium
handles logistics and labour, which produced the pool-vs-slot model now in
CONCEPT.md, then built mockups to see whether the idea looks like anything.

## What was built

**`mockup.html` — painted 2D canvas.** Hand-rolled isometric projection, cubes
as three shaded parallelograms, painter's-order depth sort, static world baked
to an offscreen canvas. Full game HUD: resource ribbon, build rail, building
inspector with the pool/slot distinction, the Wilds readout, and the wall-ring
bar. Ring II/III preview as gold blueprints with the ground you would gain
tinted in; raising a ring spends resources, levels and grows the courtyard, and
leaves the old ring standing as an inner wall.

**`mockup3d.html` — three.js r160.** Same world, real lighting. Instanced
geometry off one shared box, warm directional sun with soft shadows, sky bounce,
two `onBeforeCompile` shader injections (contact shading, animated water), baked
terrain occlusion, orbit camera, sun slider.

**Detail pass**, after the first 3D version read as clinical: three-tone
weathered masonry with per-block colour wobble, wall-walk lips, buttresses,
tower banners, one stepped roof per building with ridge beams, doors, lit windows
that warm at dusk, animated chimney smoke, yard clutter that says who works
where (log piles, flour sacks, bread crates, well winch, scarecrows), worn dirt
paths, tufts and flowers, three tree builds, broken surf line.

**Animals.** Shared wander state machine — 5 sheep, 5 hens, 3 deer, 3 circling
birds, with leg swing while walking and head dip while grazing.

## Bugs found and fixed

- Fixed octagon corner-cut constant made the wall ring degenerate into four
  disconnected stubs at larger radii. The cut has to scale with the radius, and
  the wall has to be derived as the closed boundary of the region.
- Orthographic camera + fog range tuned for a perspective distance rendered the
  entire scene as flat green haze.
- Light intensities were ~3× too low for three r155+, then overshot into
  highlight clipping that bleached the palette. ACES fixed the clipping but
  desaturated the flat colour; settled on moderate light plus a saturated
  palette and no tone mapping.
- A single water plane overhung the island and tinted the far terrain blue when
  orbiting; replaced with per-tile water instances.
- Wave displacement dipped below the seabed, showing dark patches through the
  surface.
- Per-cell roof overhangs overlapped, and their shaded undersides read as a dark
  waffle grid; replaced with one stepped roof slab per building.
- The deer's keep-out test reused the scaling-cut trap: `inOct(ringR + 2)`
  covered far more ground than the wall, so every roam target was rejected and
  the deer stood frozen. Verified the fix by screenshotting four seconds apart
  and diffing positions.

## Decisions taken (revisitable)

- Rings stay **nested** — raising Ring II leaves Ring I standing.
- Raising a ring **levels its interior for free**.
- The Wilds are **gentle and telegraphed**; the mockup shows a four-strong probe
  waiting at the treeline, and the copy says the wall holds.

## Still open

See the decisions section of CONCEPT.md.
