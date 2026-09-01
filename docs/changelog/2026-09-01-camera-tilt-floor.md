# Camera tilt floor raised to ~28.6°, ending the edge-on pan illusion

`EL_MIN` goes 0.22 → 0.5 rad. Below roughly this angle the ground is seen
nearly edge-on and vertical terrain structure dominates the image over
forward scroll, so any horizontal pan reads as the image rising or falling —
projection geometry, not a pan bug. This addresses the residual
`2026-09-01-pan-constant-rate` recorded as accepted; colony-builder cameras
conventionally floor at 25–35° for the same reason.

## Detail
- **This takes a lever that entry explicitly declined.** `2026-09-01-pan-constant-rate`
  listed raising EL_MIN among the options offered and not taken ("~13° is a
  screenshot angle"), choosing constant world-rate pan alone. That choice
  stands untouched — the pan logic is not modified here; only the reachable
  tilt range is. The two are complementary, not alternatives: constant rate
  fixed *how fast* the focus moves, the floor fixes *what the projection
  does with that motion*.
- Don't reintroduce screen-rate compensation as a fix for shallow angles —
  still rejected, per that entry. The floor is the sanctioned lever now.
- Nothing else keys off EL_MIN, and no state can be stranded below the new
  floor: elevation is only ever written through the drag clamp, and the
  0.66 default is above it.
- Fog needed no change and got none. `2026-09-01-fog-ground-anchor`'s band
  scales with Δ = frustum / (2·tan(el)), which makes the fog fraction at the
  top-of-screen ground scale-invariant (0.5Δ→1.8Δ puts it at ~38%) — so it
  is elevation- and zoom-independent by construction, and verified so at the
  new floor.
- Verified per src/render/CLAUDE.md, measured by screenshot cross-correlation
  rather than by eye: at the floor a W hold moves the image purely
  vertically (vertical fit SAD 0.38 vs 3.98 for any horizontal fit) at
  ~345 px/s, more than double the old floor's ~157 px/s for the same world
  rate; a symmetric W→S round trip returns a pixel-identical view (shift 0,
  SAD 0). Screenshots: floor default, mid-hold, post-hold, post-return, both
  zoom clamps at the floor, and a coast at the floor. Console clean; 21 tests
  and lint pass.
- Not covered: no test asserts EL_MIN or any projection behaviour — camera
  feel stays browser-verified only, as it was before. The floor value itself
  is a feel judgement, tuned to the 25–35° convention rather than measured.
