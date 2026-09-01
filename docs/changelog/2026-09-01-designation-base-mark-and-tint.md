# Chop designation moves to the tree's base and tints its canopy gold

The gold diamond now sits on the ground tile around the trunk instead of
capping the crown, and a designated tree's canopy bakes ~15% toward `gold`.
Two halves of one answer: the base mark is precise but partly hidden by the
canopy, the tint is imprecise but readable across the map. Marking a tree is
now a geometry change, so designating bumps its chunk version. Refines
`2026-09-01-tick-and-labour`.

## Detail

**The crown cap is removed, not relocated.** `2026-09-01-tick-and-labour` put
the mark above the canopy because a ground plate is hidden by the tree's own
leaves — which fixed the occlusion and introduced a worse problem: a gold box
hanging in mid-air with nothing under it. A partly occluded mark on the ground
reads better than a floating one, and the front half of the diamond is visible
at every camera angle the tilt floor allows (`2026-09-01-camera-tilt-floor`).
`treeTop()` in props.ts existed only to place that cap and is gone.

**The tint is the part that scales.** At the opening zoom a base diamond is a
few pixels; the canopy is the thing you can actually see. 15% is the dial: far
enough to pick a marked wood out of an unmarked one, near enough that the tree
still reads as a tree rather than as an overlay. Only the canopy shifts — the
trunk keeps its wood colour, so it reads as leaves catching the light rather
than a painted post. A bush is all canopy and shifts entirely.

**Do not verify a 15% tint by eye.** The trees already carry three different
greens plus per-tile jitter, so the shift is easy to mistake for ordinary
variation in either direction. The test measures it: identical geometry, and
every changed vertex gets both more red and a higher red-to-green ratio.
Deliberately *not* asserted is "less blue" — the leaf greens are darker in blue
than gold is (`leafA` `#3c7d28` has b=40 against gold's b=60), so shifting
toward gold raises blue. Warmth is the invariant; per-channel direction is not.

**Designation is now baked state**, which is the constraint that binds anything
touching it later: `designate()` calls `markChunkDirty`, and without that the
tint would not appear until something else happened to dirty the chunk. The
overlay half would still have shown, so the bug would have looked like "the
tint doesn't work" rather than "the chunk didn't rebuild".

The overlay tokens moved into `palette.ts` as `OVERLAY`, because the baked
canopy tint and the drawn overlays now both need the same gold and must not
drift apart. `docs/STYLEGUIDE.md`'s "a mark goes on top of what it marks" rule
is rewritten to describe the base-mark + tint grammar, including that tinting a
baked object makes marking it a geometry change.

Verified in the browser: marks sit at the tree bases with nothing floating;
single-click marks a tree (487 px changed in a tight patch) and clicking it
again returns the view pixel-for-pixel (0 px difference). 78 tests, lint, build,
console clean.

Not covered: the tint is measured in the mesher, not on screen, so nothing
proves the 15% survives the lighting and contact shading at a given zoom.
