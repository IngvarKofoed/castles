# Bees work the hives, the oven smokes, and a flock circles the colony

Three instanced layers of motes now draw beside the colonists: **bees** that
hover and dart around every Active Hive and Flowers, a column of **smoke** off
the Oven's chimney, and a **flock of birds** on one wide breathing circuit over
the colony's centre. Every one of them is a pure function of (anchor, index,
time) — nothing is integrated, nothing is saved — and every one stays within a
tile or two of its anchor, so "something is crossing open ground" still means
colonists and monsters. From `docs/specs/2026-09-15-ambient-life.md` (the motes
stage of three); builds on `2026-09-15-sway-and-the-world-clock`.

## Detail

**`movers.sync` now takes an `Ambient` second**, carrying the four things it
had no access to: the world clock, the frame's game `dt`, the camera focus, and
the `still` flag — which has left `main.ts`, since the renderer is where it now
means more than one thing. It rides **second rather than last** so it cannot be
forgotten behind the optional overlays: the other three arguments are overlays
a caller may not want, and this one is whether the world is alive.

**Closed form, never stateful, and that is the whole reason there is no
particle system here.** A bee's position, a puff's phase and a bird's place on
its circuit are computed from the clock each frame, so a load, a tab-wake or a
renderer rebuild places all of them correctly with no catch-up and nothing to
rebuild. Rejected: a particle system — bigger, with state to restore on load
and drift to accumulate after a suspended tab.

**Closed-form is not the same as simple, and a single frequency is what reads
as machinery.** Smooth orbits for the bees and a fixed-radius circle for the
flock were what the first build shipped, and both paths closed and repeated
exactly — recorded here as **rejected**, so neither is reintroduced as a
simplification. What replaced them keeps the closed-form rule intact:

- **A bee hovers, darts, and hovers again.** Its segment index is
  `floor(time × rate + phase)`, its endpoints are hashed from `s` and `s + 1`
  so consecutive segments chain and it never jumps, and it smoothsteps across
  the first `BEE_DART` of a segment and quivers in place for the rest. Rate and
  phase come off the mote's own index, so four bees on one hive are never in
  step. **The flight has no period at all** — stronger than incommensurable —
  because the endpoint sequence is keyed to an unbounded integer rather than to
  a frequency. Three hash salts for the endpoint draws and a fourth for the
  per-bee constants: `hash(who, s * 2 + 3, …)` and
  `hash(who, (s + 1) * 2 + 1, …)` are the same call, and a bee whose
  destination equals its next origin stands still.
- **The flock's circuit breathes.** Two slow terms swell and shrink its radius,
  a third tips the plane of it and a fourth turns which way it is tipped, with
  a fifth giving each bird a small drift inside the formation. Every rate is
  written as `BIRD_RATE` over a power of **φ** (times √2 where a fifth distinct
  ratio was needed) rather than as a decimal, so "no two terms share a period"
  is inspectable in the source instead of being a coincidence of tuning — the
  water shader's own 1.10 / 0.80 / 0.6 are the in-repo precedent and are in
  fact commensurable, with a period of about a minute. Deliberately far calmer
  than the bees: a circling bird is the one thing here meant to read as
  unhurried.

**Boundedness survives the new motion by construction, not by tuning.** Every
bee endpoint is drawn inside a disc of `BEE_RANGE` about its anchor and every
drawn position is a convex blend of two of them, so no amount of chaos can walk
a bee out of its neighbourhood; the flock's modulations are shared by all five
birds, so the formation stays a formation and the circuit stays centred.

**Smoke shrinks rather than fades**, because a `Layer` carries one opacity for
the whole mesh and `put` exposes a matrix and a tint and nothing else: fading
one instance would mean the first non-`put` material in `movers.ts`, which is
not worth a puff of smoke.

**`CHIMNEY` has exactly one row, and that is the content rather than a stub.**
The Oven is the only building whose model has a chimney at all, and the six
timber workshops that share one silhouette have no fire in their fiction —
smoke off a Weaver would say something untrue about it. A `Partial` record on
purpose, so the next workshop that burns adds a row and nothing else.

**The bee and smoke layers set `castShadow = false`** — `solidLayer` turns it
on, and a shadow is a claim that something solid is standing there. The flock
keeps its shadows: a bird's shadow crossing the ground is the mockup's, and
it is the one mote big enough to cast one worth seeing.

**Population is bounded by the camera focus, not by the map** —
`AMBIENT_RADIUS` is 80 tiles, generous rather than tight, because the number
that matters is the one at which a *flock* would visibly pop in as the player
pans, not the one at which a sub-pixel bee would.

**The flock's centre is cached against the chunk-version total.** It is the
centroid of enclosed land — a scan of a 65,536-tile layer — so it may not run
per frame. Every enclosure change is a wall change and every wall change bumps
a chunk version, so summing the 256 versions is a cheap, conservative and
exact-enough signal; it also fires on a felled tree, which costs one extra
scan. **With nothing enclosed it falls back to the buildings, then to the
folk**, so a colony that has not walled anything yet still has birds over it;
with none of the three there is nothing to circle and the flock does not fly.

**A bird is two boxes and its wings fold rather than hinge.** `put` spins about
+y only, so a wing cannot be pivoted; the wingspan box's *width* beats instead,
which is what reads as flapping at this size. Heading is the tangent of the
circuit, through `atan2` on a +z-facing model, the convention every mover here
already uses.

**Not covered.** No golden hash moved and nothing in `src/sim/` was touched.
`movers.ts` still has no test file, so all of this rests on the browser pass
alone — including the bee neighbourhood bound, which is argued from the
convexity above and measured on screen rather than pinned by a test. Nothing
exercises the bee or smoke layer at its cap, or a colony with more anchors in
view than the caps allow — past the cap `put` silently drops
the instance, which is deliberately **not** `drawReach`'s refuse-whole rule: a
missing bee says nothing false, whereas half a watch square claims less reach
than the tower has. A blueprint hive having no bees is by construction (the
`Active` gate) rather than by a screenshot.

Verified: 490 tests, lint, `tsc`, production build. In the browser (1280×800,
`v11.castles` and `v8.castles` imported through the menu, frames diffed pixel
by pixel): on v11, **forty frames over forty seconds** union to four separate
bee clouds — one over the Hive and one over each of the three Flowers — each a
scatter rather than a ring, each about two tiles across, and **separated by
clean ground**, so no bee ever crosses between anchors; the flock's forty
seconds sweep a wide *band* rather than one line, which is the breathing. On v8
the Oven carries a tapering column of pale puffs off its chimney that shrinks
to nothing as it rises, and the sheds and the Farm beside it carry none. Paused
at ×0 with bees and birds in frame, two frames three and a half seconds apart
are **byte-identical**; the same under `prefers-reduced-motion`. Console clean
(0 errors, 0 warnings).
