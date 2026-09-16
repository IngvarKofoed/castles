# Crops and canopies lean in the wind, and the water runs on game time

Tree canopies, the Farm's crop furrows and the Flowers' blooms now sway — baked
geometry displaced in place by the `cozify` shader, so trunks, walls, roofs and
ground do not move at all. **All ambient motion runs on the world's clock**: at
×0 the world holds completely still, water included, and at ×4 all of it runs
fast. `prefers-reduced-motion` stills it through an amplitude uniform while
colonists and monsters keep moving. From
`docs/specs/2026-09-15-ambient-life.md` (the sway stage of three).

## Detail

**The sway weight is per vertex, and that is the load-bearing part.** `Box`
gained a `sway` field and `emitBox` writes `aSway` exactly as it writes
`aBlockY` — the box's weight multiplied by the **same top-vertex mask**, so a
box's feet stay put and its head bends. Weighted per box instead, every furrow
ridge and every bloom slides bodily sideways and a bloom head walks off its
stem; masked, a canopy bends within a box as well as between boxes. Pinned by
test: on a Farm, exactly twelve of each furrow box's twenty-four vertices lean,
and a leaning vertex always has `aBlockY` 1.

**Rejected: swaying by world height.** Free, one line, and it waves the tops of
walls and roofs — which is the whole reason a per-box weight exists. The
Pasture is the control the test uses: the Farm's grammar with the furrows taken
out, so a plot that leans nothing proves the plot itself never moves.

**The injection is unconditional on the `cozify` path**, so every cosy material
keeps one compiled program and `customProgramCacheKey` stays `"cosy"`. The
mover layer's shared box carries no `aSway` and the attribute reads 0 there —
the same default an absent colour attribute relies on — so colonists, monsters
and goods are stock still with nothing gating them.

**`uTime` is the water's clock, reused, and it is now *game* seconds.** That is
the real divergence here: the water ran on the wall clock, so a paused world's
only motion would have been the one motion that does not matter — at exactly
the moment a player stops to read the map. `waveTime` is now fed
`Σ dt × speed` off the loop's already-clamped `dt`, and `swayAmp` is the second
shared uniform beside it.

**Reduced motion needs an amplitude, not a frozen clock.** At `uTime = 0` the
two-sine is a fixed *non-zero* number, so holding the clock — which is what
stills the water — would leave a forest permanently leaning. `uSwayAmp` goes to
0 instead, which is the rest pose.

**Two consequences, both accepted.** Chunk rebuilds are unaffected: the
attribute bakes once with the rest of the chunk and the motion is entirely in
the vertex shader, so a swaying chunk costs what a still one costs. And **sway
does not reach the shadow map** — the depth material carries no injection, so a
swaying canopy casts a still shadow. Not visible at this amplitude from this
camera; recorded so nobody hunts it as a bug.

**Numbers, all tune-by-eye firsts.** `SWAY_REACH` 0.13 world units at weight 1
and peak gust — well under a tile, a lean and not a sweep. Weights: canopy
0.8 / 1.0 / 1.2 bottom to top, bush 0.5, crop furrow 0.5, bloom head 0.6. The
small boxes take a fraction because their *tops* carry the whole displacement
and a full weight reads as a shear rather than a lean. Two sines of **world**
position, so a wood leans as one gust and the phase is continuous across a
chunk seam.

**Not covered.** No golden hash moved and nothing in `src/sim/` was touched, so
the whole stage reverts cleanly. The shadow-map gap above is reasoned from the
depth material rather than screenshotted. Nothing exercises a swaying prop at
the edge of a chunk against its neighbour — the world-position phase makes the
seam correct by construction, not by a test.

Verified: 483 tests (7 new, in `mesher.test.ts` — bare terrain leans nowhere, a
leaning vertex is always a box top, a shed leans nothing, and the Farm-against-
Pasture pair), lint, `tsc`, production build. In the browser (seed 20260901,
1280×800, frames diffed pixel by pixel): at ×1 the changed pixels fall on
**canopy edges and the colonists and nowhere else** — open grass, trunks,
paths and dens measure zero change; paused at ×0 two frames 2.5 s apart are
**byte-identical**, at the coast as well as inland, so the water holds with
everything else; back at ×4 both the water and the woods move heavily again.
With `prefers-reduced-motion: reduce` emulated and reloaded, the only moving
pixels in the whole world are five colonists walking to a chop designation.
Console clean (0 errors, 0 warnings).
